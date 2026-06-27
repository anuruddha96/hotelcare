import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import type { LangCode, TrainingCurriculum, TrainingStepV2 } from './types';
import { evaluateGuard } from './guards';
import { ALL_CURRICULA, curriculaForRole, findCurriculum } from './curricula';
import { TrainingOverlayV2 } from './TrainingOverlayV2';

type CompletionStatus = 'done' | 'in_progress' | 'available';

export interface CurriculumStatus {
  slug: string;
  status: CompletionStatus;
  currentStep: number;
  totalSteps: number;
  completedAt?: string | null;
  updatedAt?: string | null;
}

interface TrainingV2ContextValue {
  active: TrainingCurriculum | null;
  step: TrainingStepV2 | null;
  stepIndex: number;
  totalSteps: number;
  rect: DOMRect | null;
  waiting: boolean;
  reducedMotion: boolean;
  lang: LangCode;
  start: (slug: string, opts?: { restart?: boolean; manual?: boolean }) => Promise<void>;
  next: () => void;
  prev: () => void;
  skip: () => void;
  finish: () => void;
  dismissCurriculum: (slug: string, days?: number) => Promise<void>;
  markComplete: (slug: string) => Promise<void>;
  resetCurriculum: (slug: string) => Promise<void>;
  refreshStatuses: () => Promise<void>;
  availableCurricula: TrainingCurriculum[];
  completion: Record<string, CompletionStatus>;
  statuses: Record<string, CurriculumStatus>;
  /** Surfaces a help-button anchor for focus return. */
  registerLauncher: (el: HTMLElement | null) => void;
}

const TrainingV2Context = createContext<TrainingV2ContextValue | null>(null);

const MANAGER_ROLES = [
  'manager',
  'housekeeping_manager',
  'maintenance_manager',
  'reception_manager',
  'admin',
  'top_management',
  'top_management_manager',
];

function tx(text: import('./types').I18nText, lang: LangCode): string {
  return ((text as unknown as Record<string, string | undefined>)[lang]) || text.en;
}

export function TrainingV2Provider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const { language } = useTranslation();
  const navigate = useNavigate();
  const lang = (language as LangCode) || 'en';

  // IMPORTANT: do NOT default role to 'housekeeping'. If profile hasn't loaded
  // yet, role is null and auto-start is gated below — otherwise managers would
  // briefly receive the housekeeper tour during the first render.
  const role = (profile?.role as string) || null;
  const assignedHotel = (profile as any)?.assigned_hotel || null;

  const [active, setActive] = useState<TrainingCurriculum | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [completion, setCompletion] = useState<Record<string, CompletionStatus>>({});
  const [statuses, setStatuses] = useState<Record<string, CurriculumStatus>>({});
  const [switchingHotel, setSwitchingHotel] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const autoStartedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dataReadyRef = useRef<Set<string>>(new Set());
  const launcherRef = useRef<HTMLElement | null>(null);
  const prevHotelRef = useRef<string | null>(assignedHotel);

  const step = active ? active.steps[stepIndex] : null;
  const totalSteps = active?.steps.length || 0;

  const registerLauncher = useCallback((el: HTMLElement | null) => {
    launcherRef.current = el;
  }, []);

  // Reduced motion preference
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Listen for data-ready events from feature pages
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.key) dataReadyRef.current.add(String(detail.key));
    };
    window.addEventListener('training:data-ready', handler as EventListener);
    return () =>
      window.removeEventListener('training:data-ready', handler as EventListener);
  }, []);

  // Online / offline
  useEffect(() => {
    const onOff = () => setWaiting((w) => (active && step?.precondition === 'is_online' ? true : w));
    window.addEventListener('offline', onOff);
    return () => window.removeEventListener('offline', onOff);
  }, [active, step?.precondition]);

  // Hotel switch detection — pause active tour, re-resolve
  useEffect(() => {
    if (prevHotelRef.current !== assignedHotel) {
      const wasSwitch = prevHotelRef.current !== null;
      prevHotelRef.current = assignedHotel;
      if (wasSwitch && active) {
        setSwitchingHotel(true);
        // Clear data-ready cache: new hotel may not have those data points loaded yet
        dataReadyRef.current = new Set();
        setRect(null);
        // Mark paused
        if (user) {
          supabase
            .from('user_training_state')
            .upsert(
              {
                user_id: user.id,
                paused_at: new Date().toISOString(),
                last_active_step_key: step?.key || null,
                last_guide_slug: active.slug,
                last_step: stepIndex,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'user_id' },
            )
            .then(() => undefined);
        }
        setTimeout(() => setSwitchingHotel(false), 1500);
      }
    }
  }, [assignedHotel, active, step?.key, stepIndex, user]);

  const persist = useCallback(
    async (slug: string, idx: number, status: 'in_progress' | 'completed', stepKey?: string) => {
      if (!user) return;
      await supabase.from('user_tour_progress').upsert(
        {
          user_id: user.id,
          tour_key: slug,
          current_step: idx,
          status,
          completed_at: status === 'completed' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,tour_key' },
      );
      if (stepKey) {
        await supabase.from('user_training_state').upsert(
          {
            user_id: user.id,
            last_active_step_key: stepKey,
            last_guide_slug: slug,
            last_step: idx,
            paused_at: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );
      }
    },
    [user],
  );

  const refreshStatuses = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('user_tour_progress')
      .select('tour_key, current_step, status, completed_at, updated_at')
      .eq('user_id', user.id);

    const map: Record<string, CompletionStatus> = {};
    const stMap: Record<string, CurriculumStatus> = {};
    ALL_CURRICULA.forEach((c) => {
      stMap[c.slug] = {
        slug: c.slug,
        status: 'available',
        currentStep: 0,
        totalSteps: c.steps.length,
      };
    });
    (data || []).forEach((row: any) => {
      const cur = ALL_CURRICULA.find((c) => c.slug === row.tour_key);
      map[row.tour_key] = row.status === 'completed' ? 'done' : 'in_progress';
      stMap[row.tour_key] = {
        slug: row.tour_key,
        status: row.status === 'completed' ? 'done' : 'in_progress',
        currentStep: row.current_step ?? 0,
        totalSteps: cur?.steps.length ?? 0,
        completedAt: row.completed_at,
        updatedAt: row.updated_at,
      };
    });
    setCompletion(map);
    setStatuses(stMap);
  }, [user]);

  // Initial: load + auto-start
  useEffect(() => {
    // Wait until profile (and therefore role) is loaded — otherwise the
    // housekeeper curriculum would auto-start for every role.
    if (!user || !role || autoStartedRef.current) return;
    autoStartedRef.current = true;

    (async () => {
      await refreshStatuses();

      const { data: stateRow } = await supabase
        .from('user_training_state')
        .select('dismissed_until, auto_start_pending')
        .eq('user_id', user.id)
        .maybeSingle();

      const dismissed =
        stateRow?.dismissed_until && new Date(stateRow.dismissed_until) > new Date();
      const forced = stateRow?.auto_start_pending === true;
      if (dismissed && !forced) return;

      const { data: progressData } = await supabase
        .from('user_tour_progress')
        .select('tour_key, current_step, status')
        .eq('user_id', user.id);
      const progressBySlug: Record<string, { idx: number; status: string }> = {};
      (progressData || []).forEach((row: any) => {
        progressBySlug[row.tour_key] = {
          idx: row.current_step ?? 0,
          status: row.status ?? 'in_progress',
        };
      });

      // Only auto-start curricula in the 'core' category. Manager
      // feature-promo modules (team, tickets, revenue, …) appear in the
      // Training Center as recommended next steps but never auto-fire.
      const candidates = curriculaForRole(role).filter((c) => c.category === 'core');
      const target = candidates.find((c) => progressBySlug[c.slug]?.status !== 'completed');
      if (!target) return;
      const resumeIdx = progressBySlug[target.slug]?.idx ?? 0;
      setTimeout(() => {
        setActive(target);
        setStepIndex(Math.min(resumeIdx, target.steps.length - 1));
      }, 1200);

      if (forced) {
        await supabase
          .from('user_training_state')
          .update({ auto_start_pending: false, updated_at: new Date().toISOString() })
          .eq('user_id', user.id);
      }
    })();
  }, [user, role, refreshStatuses]);

  // Guard-context role: when profile hasn't loaded yet, fall back to a neutral
  // value so guards like `is_manager` don't accidentally evaluate true/false
  // based on the old housekeeping default.
  const guardRole = role || 'unknown';

  // Step lifecycle: navigate, locate selector, gate on precondition, poll waitFor
  useEffect(() => {
    if (!active || !step || !user) return;

    let cancelled = false;
    setRect(null);
    setWaiting(false);

    const guardCtx = {
      userId: user.id,
      role: guardRole,
      assignedHotel,
      switchingHotel,
      dataReady: dataReadyRef.current,
    };

    const run = async () => {
      if (step.route) navigate(step.route);
      if (step.tab) {
        window.dispatchEvent(
          new CustomEvent('tour:navigate', { detail: { tab: step.tab, tourKey: active.slug } }),
        );
      }

      if (step.precondition) {
        const ok = await evaluateGuard(step.precondition, guardCtx);
        if (!ok) {
          if (step.optional) {
            if (!cancelled) setTimeout(() => next(), 200);
            return;
          }
          if (!cancelled) setWaiting(true);
        }
      }

      if (step.selector) {
        let attempts = 0;
        const tryLocate = () => {
          if (cancelled) return;
          const el = document.querySelector(step.selector!) as HTMLElement | null;
          if (el) {
            try {
              el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
            } catch {}
            setTimeout(() => {
              if (!cancelled) setRect(el.getBoundingClientRect());
            }, 250);
          } else if (attempts++ < 40) {
            setTimeout(tryLocate, 200);
          }
        };
        tryLocate();
      }
    };
    run();

    // Persist current step key for resume
    persist(active.slug, stepIndex, 'in_progress', step.key);

    if (step.waitFor) {
      pollRef.current = setInterval(async () => {
        const ok = await evaluateGuard(step.waitFor!, guardCtx);
        if (ok && !cancelled) {
          if (pollRef.current) clearInterval(pollRef.current);
          next();
        }
      }, 3000);
    }

    let preInterval: ReturnType<typeof setInterval> | null = null;
    if (step.precondition && !step.waitFor) {
      preInterval = setInterval(async () => {
        const ok = await evaluateGuard(step.precondition!, guardCtx);
        if (ok && !cancelled) {
          if (preInterval) clearInterval(preInterval);
          setWaiting(false);
          run();
        }
      }, 3000);
    }

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      if (preInterval) clearInterval(preInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.slug, stepIndex, switchingHotel, assignedHotel]);

  // Reposition on resize/scroll/orientation
  useEffect(() => {
    if (!step?.selector) return;
    let raf = 0;
    const reposition = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = document.querySelector(step.selector!) as HTMLElement | null;
        if (el) setRect(el.getBoundingClientRect());
      });
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('orientationchange', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('orientationchange', reposition);
      window.removeEventListener('scroll', reposition, true);
      cancelAnimationFrame(raf);
    };
  }, [step?.selector, stepIndex]);

  const finish = useCallback(() => {
    if (active) {
      persist(active.slug, active.steps.length, 'completed', step?.key);
      setCompletion((m) => ({ ...m, [active.slug]: 'done' }));
    }
    setActive(null);
    setStepIndex(0);
    setRect(null);
    setWaiting(false);
    // Restore focus
    setTimeout(() => {
      launcherRef.current?.focus();
    }, 50);
  }, [active, persist, step?.key]);

  const next = useCallback(() => {
    if (!active) return;
    if (stepIndex < active.steps.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex, finish]);

  const prev = useCallback(() => {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  }, [stepIndex]);

  const skip = useCallback(async () => {
    if (active && user) {
      await persist(active.slug, stepIndex, 'completed');
      await supabase.from('user_training_state').upsert(
        {
          user_id: user.id,
          dismissed_until: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
      setCompletion((m) => ({ ...m, [active.slug]: 'done' }));
    }
    setActive(null);
    setStepIndex(0);
    setRect(null);
    setTimeout(() => launcherRef.current?.focus(), 50);
  }, [active, stepIndex, user, persist]);

  const start = useCallback(
    async (slug: string, opts?: { restart?: boolean; manual?: boolean }) => {
      const c = findCurriculum(slug);
      if (!c) return;
      let resumeIdx = 0;
      if (user && !opts?.restart) {
        const { data } = await supabase
          .from('user_tour_progress')
          .select('current_step, status')
          .eq('user_id', user.id)
          .eq('tour_key', slug)
          .maybeSingle();
        if (data && data.status !== 'completed') resumeIdx = data.current_step || 0;
      }
      if (opts?.restart && user) {
        await supabase
          .from('user_tour_progress')
          .upsert(
            {
              user_id: user.id,
              tour_key: slug,
              current_step: 0,
              status: 'in_progress',
              completed_at: null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,tour_key' },
          );
      }
      setActive(c);
      setStepIndex(Math.min(resumeIdx, c.steps.length - 1));
    },
    [user],
  );

  const dismissCurriculum = useCallback(
    async (_slug: string, days = 30) => {
      if (!user) return;
      await supabase.from('user_training_state').upsert(
        {
          user_id: user.id,
          dismissed_until: new Date(Date.now() + days * 24 * 3600 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
      await refreshStatuses();
    },
    [user, refreshStatuses],
  );

  const markComplete = useCallback(
    async (slug: string) => {
      const c = findCurriculum(slug);
      if (!user || !c) return;
      await supabase.from('user_tour_progress').upsert(
        {
          user_id: user.id,
          tour_key: slug,
          current_step: c.steps.length,
          status: 'completed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,tour_key' },
      );
      await refreshStatuses();
    },
    [user, refreshStatuses],
  );

  const resetCurriculum = useCallback(
    async (slug: string) => {
      if (!user) return;
      await supabase
        .from('user_tour_progress')
        .delete()
        .eq('user_id', user.id)
        .eq('tour_key', slug);
      await refreshStatuses();
    },
    [user, refreshStatuses],
  );

  const availableCurricula = useMemo(() => curriculaForRole(role), [role]);

  const value: TrainingV2ContextValue = {
    active,
    step,
    stepIndex,
    totalSteps,
    rect,
    waiting,
    reducedMotion,
    lang,
    start,
    next,
    prev,
    skip,
    finish,
    dismissCurriculum,
    markComplete,
    resetCurriculum,
    refreshStatuses,
    availableCurricula,
    completion,
    statuses,
    registerLauncher,
  };

  return (
    <TrainingV2Context.Provider value={value}>
      {children}
      {active && step && <TrainingOverlayV2 />}
    </TrainingV2Context.Provider>
  );
}

export function useTrainingV2() {
  const ctx = useContext(TrainingV2Context);
  if (!ctx) throw new Error('useTrainingV2 outside provider');
  return ctx;
}

export function txt(text: import('./types').I18nText, lang: LangCode): string {
  return tx(text, lang);
}

export { ALL_CURRICULA, MANAGER_ROLES };
