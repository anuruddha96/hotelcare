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
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useTenant } from '@/contexts/TenantContext';
import { propertyTermsFor } from '@/lib/propertyTerminology';
import type { LangCode, TrainingCurriculum, TrainingStepV2 } from './types';
import { evaluateGuard } from './guards';
import { ALL_CURRICULA, curriculaForRole, findCurriculum } from './curricula';
import { TrainingOverlayV2 } from './TrainingOverlayV2';
import { TrainingFirstLoginPrompt } from './TrainingFirstLoginPrompt';


type CompletionStatus = 'done' | 'in_progress' | 'available';

export interface CurriculumStatus {
  slug: string;
  status: CompletionStatus;
  currentStep: number;
  totalSteps: number;
  completedAt?: string | null;
  updatedAt?: string | null;
}

interface DeferredStep {
  slug: string;
  stepKey: string;
  deferredAt: string;
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
  start: (slug: string, opts?: { restart?: boolean; manual?: boolean; startAtKey?: string }) => Promise<void>;
  next: () => void;
  prev: () => void;
  skip: () => void;
  skipForNow: () => void;
  finish: () => void;
  dismissCurriculum: (slug: string, days?: number) => Promise<void>;
  markComplete: (slug: string) => Promise<void>;
  resetCurriculum: (slug: string) => Promise<void>;
  refreshStatuses: () => Promise<void>;
  availableCurricula: TrainingCurriculum[];
  completion: Record<string, CompletionStatus>;
  statuses: Record<string, CurriculumStatus>;
  registerLauncher: (el: HTMLElement | null) => void;
  /** First-login walkthrough prompt (null when hidden). */
  pendingAutoStart: TrainingCurriculum | null;
  acceptAutoStart: () => void;
  snoozeAutoStart: () => Promise<void>;
  skipAutoStart: () => Promise<void>;
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

const AUTO_START_THROTTLE_MS = 4 * 60 * 60 * 1000; // 4 hours
const SELECTOR_TIMEOUT_MS = 8000; // give up locating after 8s

function tx(text: import('./types').I18nText, lang: LangCode): string {
  return ((text as unknown as Record<string, string | undefined>)[lang]) || text.en;
}

const SKIP_TOAST_LABELS: Record<LangCode, string> = {
  en: 'Skipped — we will show this when it is relevant.',
  hu: 'Kihagyva — akkor mutatjuk, amikor releváns lesz.',
  es: 'Omitido — lo mostraremos cuando sea relevante.',
  vi: 'Đã bỏ qua — sẽ hiển thị khi liên quan.',
  mn: 'Алгасав — холбогдох үед үзүүлнэ.',
};

const RESUME_TOAST_LABELS: Record<LangCode, { title: string; action: string }> = {
  en: { title: 'Ready to continue your training?', action: 'Resume' },
  hu: { title: 'Folytatod a tananyagot?', action: 'Folytatás' },
  es: { title: '¿Listo para continuar tu formación?', action: 'Continuar' },
  vi: { title: 'Tiếp tục đào tạo?', action: 'Tiếp tục' },
  mn: { title: 'Сургалтаа үргэлжлүүлэх үү?', action: 'Үргэлжлүүлэх' },
};

export function TrainingV2Provider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const { language } = useTranslation();
  const { organization } = useTenant();
  const isPropertyOrg = propertyTermsFor(organization?.slug).isProperty;
  const navigate = useNavigate();
  const location = useLocation();
  const lang = (language as LangCode) || 'en';


  // Resolve `:org` and `:orgSlug` placeholders in step routes from the
  // current URL so curricula stay tenant-agnostic.
  const resolveRoute = useCallback(
    (raw?: string): string | undefined => {
      if (!raw) return raw;
      const seg = location.pathname.split('/').filter(Boolean);
      const orgSlug = seg[0] || (profile as any)?.organization_slug || 'rdhotels';
      return raw.replace(/:orgSlug/g, orgSlug).replace(/:org\b/g, orgSlug);
    },
    [location.pathname, profile],
  );

  // Do NOT default role to 'housekeeping'. Wait until profile loads.
  const role = (profile?.role as string) || null;
  const assignedHotel = (profile as any)?.assigned_hotel || null;

  const [active, setActive] = useState<TrainingCurriculum | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [stepReady, setStepReady] = useState(false);
  const [completion, setCompletion] = useState<Record<string, CompletionStatus>>({});
  const [statuses, setStatuses] = useState<Record<string, CurriculumStatus>>({});
  const [switchingHotel, setSwitchingHotel] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pendingAutoStart, setPendingAutoStart] = useState<TrainingCurriculum | null>(null);
  const autoStartedRef = useRef(false);
  const dataReadyRef = useRef<Set<string>>(new Set());
  const launcherRef = useRef<HTMLElement | null>(null);
  const prevHotelRef = useRef<string | null>(assignedHotel);
  const deferredRef = useRef<DeferredStep[]>([]);
  const resumePromptedRef = useRef<Set<string>>(new Set());
  const lastNextAtRef = useRef<number>(0);
  const pendingResumeIdxRef = useRef<number>(0);

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

  // Hotel switch detection — pause active tour
  useEffect(() => {
    if (prevHotelRef.current !== assignedHotel) {
      const wasSwitch = prevHotelRef.current !== null;
      prevHotelRef.current = assignedHotel;
      if (wasSwitch && active) {
        setSwitchingHotel(true);
        dataReadyRef.current = new Set();
        setRect(null);
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

  const persistDeferred = useCallback(
    async (queue: DeferredStep[]) => {
      if (!user) return;
      await supabase.from('user_training_state').upsert(
        {
          user_id: user.id,
          deferred_steps: queue as any,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
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

  // Initial: load + auto-start (core curricula only, throttled to 4h)
  useEffect(() => {
    if (!user || !role || autoStartedRef.current) return;
    // Don't auto-start on transient routes — wait until the user lands on
    // a real screen so the first step's anchor (e.g. hotel-switcher) is
    // actually in the DOM.
    const path = location.pathname;
    if (path === '/' || path === '/index' || path.startsWith('/auth')) return;
    autoStartedRef.current = true;

    (async () => {
      await refreshStatuses();

      const { data: stateRow } = await supabase
        .from('user_training_state')
        .select('dismissed_until, auto_start_pending, deferred_steps, last_auto_start_at')
        .eq('user_id', user.id)
        .maybeSingle();

      // Hydrate deferred queue
      try {
        const ds = (stateRow as any)?.deferred_steps;
        if (Array.isArray(ds)) deferredRef.current = ds as DeferredStep[];
      } catch {
        deferredRef.current = [];
      }

      const dismissed =
        stateRow?.dismissed_until && new Date(stateRow.dismissed_until) > new Date();
      const forced = stateRow?.auto_start_pending === true;
      const lastAuto = (stateRow as any)?.last_auto_start_at as string | null;
      const tooRecent =
        lastAuto && Date.now() - new Date(lastAuto).getTime() < AUTO_START_THROTTLE_MS;

      if ((dismissed || tooRecent) && !forced) return;

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

      const candidates = curriculaForRole(role).filter(
        (c) => c.category === 'core' && c.roles.includes(role as any),
      );
      const target = candidates.find((c) => progressBySlug[c.slug]?.status !== 'completed');
      if (!target) return;

      // Sanity check (catch curriculum config regressions)
      if (!target.roles.includes(role as any)) {
        console.warn('[training] core curriculum auto-start skipped — role mismatch', {
          slug: target.slug,
          role,
        });
        return;
      }

      const resumeIdx = progressBySlug[target.slug]?.idx ?? 0;
      // Show the first-login prompt instead of auto-launching the tour so
      // the user can Start, snooze, or skip. Chain seeding happens when
      // they accept.
      setTimeout(() => {
        pendingResumeIdxRef.current = Math.min(resumeIdx, target.steps.length - 1);
        setPendingAutoStart(target);
      }, 1200);

      await supabase
        .from('user_training_state')
        .upsert(
          {
            user_id: user.id,
            last_auto_start_at: new Date().toISOString(),
            auto_start_pending: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );
    })();
  }, [user, role, location.pathname, refreshStatuses]);

  const guardRole = role || 'unknown';

  // Step lifecycle: navigate, locate selector, gate on precondition
  //
  // CRITICAL: do NOT auto-call next() for optional steps whose precondition
  // fails. Instead, defer the step and advance ONCE per user click. Auto-skip
  // chains were the cause of "Next jumps two steps".
  useEffect(() => {
    if (!active || !step || !user) return;

    let cancelled = false;
    setRect(null);
    setWaiting(false);
    // Hide overlay until this step has resolved.
    setStepReady(false);

    const guardCtx = {
      userId: user.id,
      role: guardRole,
      assignedHotel,
      switchingHotel,
      dataReady: dataReadyRef.current,
    };

    // Silently defer the current step (no toast — user asked for skips to
    // happen in the background). The deferred queue still drives the
    // "Resume" toast when the step's element + precondition later become
    // available.
    const deferCurrent = async () => {
      const entry: DeferredStep = {
        slug: active.slug,
        stepKey: step.key,
        deferredAt: new Date().toISOString(),
      };
      const queue = [
        ...deferredRef.current.filter(
          (d) => !(d.slug === entry.slug && d.stepKey === entry.stepKey),
        ),
        entry,
      ];
      deferredRef.current = queue;
      await persistDeferred(queue);
    };

    const run = async () => {
      const targetRoute = resolveRoute(step.route);
      if (targetRoute && location.pathname !== targetRoute) {
        navigate(targetRoute);
        // Stay hidden while we wait for the route to change — the effect
        // re-runs on location.pathname.
        return;
      }
      if (step.tab) {
        window.dispatchEvent(
          new CustomEvent('tour:navigate', {
            detail: { tab: step.tab, subTab: (step as any).subTab, tourKey: active.slug },
          }),
        );
        window.dispatchEvent(
          new CustomEvent('training-navigate', {
            detail: { mainTab: step.tab, subTab: (step as any).subTab },
          }),
        );
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }

      if (step.precondition) {
        const ok = await evaluateGuard(step.precondition, guardCtx);
        if (!ok) {
          if (step.optional) {
            // Silently defer + advance. Overlay stays hidden the whole time.
            await deferCurrent();
            if (!cancelled) {
              setTimeout(() => {
                if (cancelled) return;
                if (stepIndex < active.steps.length - 1) {
                  setStepIndex(stepIndex + 1);
                } else {
                  finishInternal();
                }
              }, 30);
            }
            return;
          }
          // Non-optional precondition fail ⇒ surface the waiting card.
          if (!cancelled) {
            setWaiting(true);
            setStepReady(true);
          }
          return;
        }
      }

      if (step.selector) {
        const startedAt = Date.now();
        const tryLocate = () => {
          if (cancelled) return;
          const el = document.querySelector(step.selector!) as HTMLElement | null;
          if (el) {
            setWaiting(false);
            try {
              el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
            } catch {}
            setTimeout(() => {
              if (cancelled) return;
              setRect(el.getBoundingClientRect());
              setStepReady(true);
            }, 250);
            return;
          }
          if (Date.now() - startedAt < SELECTOR_TIMEOUT_MS) {
            setTimeout(tryLocate, 250);
          } else if (step.optional) {
            // Element never appeared → silently defer + advance.
            deferCurrent().then(() => {
              if (cancelled) return;
              if (stepIndex < active.steps.length - 1) setStepIndex(stepIndex + 1);
              else finishInternal();
            });
          } else if (!cancelled) {
            setWaiting(true);
            setStepReady(true);
          }
        };
        tryLocate();
      } else {
        // Text-only step: ready immediately.
        if (!cancelled) {
          setWaiting(false);
          setStepReady(true);
        }
      }
    };

    run();
    persist(active.slug, stepIndex, 'in_progress', step.key);

    let waitInterval: ReturnType<typeof setInterval> | null = null;
    if (step.waitFor) {
      waitInterval = setInterval(async () => {
        const ok = await evaluateGuard(step.waitFor!, guardCtx);
        if (ok && !cancelled) {
          if (waitInterval) clearInterval(waitInterval);
          if (stepIndex < active.steps.length - 1) setStepIndex(stepIndex + 1);
          else finishInternal();
        }
      }, 3000);
    }

    return () => {
      cancelled = true;
      if (waitInterval) clearInterval(waitInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.slug, stepIndex, switchingHotel, assignedHotel, location.pathname]);

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

  // Track the remaining chain of curricula to auto-play after the current
  // one finishes. Populated when `start()` opens a curriculum that declares
  // `chain: [...]`. When empty, finish behaves normally.
  const chainQueueRef = useRef<string[]>([]);

  const finishInternal = useCallback(() => {
    const finishedSlug = active?.slug;
    if (active) {
      persist(active.slug, active.steps.length, 'completed', step?.key);
      setCompletion((m) => ({ ...m, [active.slug]: 'done' }));
    }

    // If a chain is queued, auto-advance to the next child curriculum
    // instead of closing the overlay.
    const nextSlug = chainQueueRef.current.shift();
    if (nextSlug) {
      const nextCur = findCurriculum(nextSlug);
      if (nextCur) {
        setActive(nextCur);
        setStepIndex(0);
        setRect(null);
        setWaiting(false);
        setStepReady(false);
        return;
      }
    }

    setActive(null);
    setStepIndex(0);
    setRect(null);
    setWaiting(false);
    setTimeout(() => {
      launcherRef.current?.focus();
    }, 50);
  }, [active, persist, step?.key]);

  const finish = finishInternal;

  const next = useCallback(() => {
    if (!active) return;
    // Debounce against double-click / event bubbling.
    const now = Date.now();
    if (now - lastNextAtRef.current < 220) return;
    lastNextAtRef.current = now;
    if (stepIndex < active.steps.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      finishInternal();
    }
  }, [active, stepIndex, finishInternal]);

  const prev = useCallback(() => {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  }, [stepIndex]);

  // Skip the whole curriculum (dismiss for 30 days)
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

  // Skip this step for now → push to deferred queue, advance once. Silent.
  const skipForNow = useCallback(async () => {
    if (!active || !step) return;
    const entry: DeferredStep = {
      slug: active.slug,
      stepKey: step.key,
      deferredAt: new Date().toISOString(),
    };
    const queue = [
      ...deferredRef.current.filter(
        (d) => !(d.slug === entry.slug && d.stepKey === entry.stepKey),
      ),
      entry,
    ];
    deferredRef.current = queue;
    await persistDeferred(queue);
    next();
  }, [active, step, persistDeferred, next]);

  const start = useCallback(
    async (slug: string, opts?: { restart?: boolean; manual?: boolean; startAtKey?: string }) => {
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
      if (opts?.startAtKey) {
        const idx = c.steps.findIndex((s) => s.key === opts.startAtKey);
        if (idx >= 0) resumeIdx = idx;
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
      // Seed the chain queue from the curriculum definition. Manual restart
      // or explicit start replaces any prior in-flight chain.
      const rawChain = Array.isArray(c.chain) ? c.chain : [];
      chainQueueRef.current = isPropertyOrg
        ? rawChain.filter((s) => s !== 'v2_manager_revenue')
        : [...rawChain];

      setActive(c);
      setStepIndex(Math.min(resumeIdx, c.steps.length - 1));
    },
    [user, isPropertyOrg],
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

  // ── Deferred-step watcher: when a previously-deferred step becomes
  //    relevant (selector visible AND precondition true), surface a one-tap
  //    resume toast. Runs on route changes + body MutationObserver (debounced).
  useEffect(() => {
    if (!user || !role) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const check = async () => {
      if (cancelled || active) return; // don't disrupt an active tour
      const queue = deferredRef.current;
      if (!queue.length) return;

      for (const entry of queue) {
        const key = `${entry.slug}::${entry.stepKey}`;
        if (resumePromptedRef.current.has(key)) continue;
        const cur = findCurriculum(entry.slug);
        if (!cur) continue;
        const s = cur.steps.find((st) => st.key === entry.stepKey);
        if (!s) continue;
        // Selector must resolve right now
        if (s.selector && !document.querySelector(s.selector)) continue;
        // Precondition must pass
        if (s.precondition) {
          const ok = await evaluateGuard(s.precondition, {
            userId: user.id,
            role: guardRole,
            assignedHotel,
            switchingHotel: false,
            dataReady: dataReadyRef.current,
          });
          if (!ok) continue;
        }
        resumePromptedRef.current.add(key);
        const labels = RESUME_TOAST_LABELS[lang] || RESUME_TOAST_LABELS.en;
        toast(`${labels.title} — ${tx(cur.name, lang)}`, {
          duration: 20000,
          action: {
            label: labels.action,
            onClick: () => {
              // remove from queue and start at this step
              const next = deferredRef.current.filter(
                (d) => !(d.slug === entry.slug && d.stepKey === entry.stepKey),
              );
              deferredRef.current = next;
              persistDeferred(next);
              start(entry.slug, { startAtKey: entry.stepKey });
            },
          },
        });
        break; // only one resume toast at a time
      }
    };

    const debouncedCheck = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(check, 400);
    };

    // Initial + route-change check
    debouncedCheck();

    // MutationObserver on body
    let observer: MutationObserver | null = null;
    if (typeof document !== 'undefined') {
      observer = new MutationObserver(debouncedCheck);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      observer?.disconnect();
    };
  }, [user, role, location.pathname, lang, active, assignedHotel, guardRole, start, persistDeferred]);

  // organization/isPropertyOrg computed above

  const isPropertyOrg = propertyTermsFor(organization?.slug).isProperty;
  const availableCurricula = useMemo(() => {
    const base = curriculaForRole(role || '');
    // Property-style orgs (SLNT) don't use Revenue Management — hide its module.
    return isPropertyOrg ? base.filter((c) => c.slug !== 'v2_manager_revenue') : base;
  }, [role, isPropertyOrg]);


  // First-login prompt actions
  const acceptAutoStart = useCallback(() => {
    const target = pendingAutoStart;
    if (!target) return;
    chainQueueRef.current = Array.isArray(target.chain) ? [...target.chain] : [];
    setPendingAutoStart(null);
    setActive(target);
    setStepIndex(pendingResumeIdxRef.current || 0);
  }, [pendingAutoStart]);

  const snoozeAutoStart = useCallback(async () => {
    setPendingAutoStart(null);
    if (!user) return;
    await supabase.from('user_training_state').upsert(
      {
        user_id: user.id,
        dismissed_until: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
  }, [user]);

  const skipAutoStart = useCallback(async () => {
    const target = pendingAutoStart;
    setPendingAutoStart(null);
    if (!user) return;
    await supabase.from('user_training_state').upsert(
      {
        user_id: user.id,
        dismissed_until: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (target) {
      // Mark the walkthrough as completed so we don't re-offer it.
      await supabase.from('user_tour_progress').upsert(
        {
          user_id: user.id,
          tour_key: target.slug,
          current_step: target.steps.length,
          status: 'completed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,tour_key' },
      );
      await refreshStatuses();
    }
  }, [user, pendingAutoStart, refreshStatuses]);


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
    skipForNow,
    finish,
    dismissCurriculum,
    markComplete,
    resetCurriculum,
    refreshStatuses,
    availableCurricula,
    completion,
    statuses,
    registerLauncher,
    pendingAutoStart,
    acceptAutoStart,
    snoozeAutoStart,
    skipAutoStart,
  };

  return (
    <TrainingV2Context.Provider value={value}>
      {children}
      {active && step && stepReady && <TrainingOverlayV2 />}
      {pendingAutoStart && !active && <TrainingFirstLoginPrompt />}
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
