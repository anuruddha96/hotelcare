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

interface TrainingV2ContextValue {
  /** Active curriculum, or null when idle. */
  active: TrainingCurriculum | null;
  step: TrainingStepV2 | null;
  stepIndex: number;
  totalSteps: number;
  rect: DOMRect | null;
  waiting: boolean;
  lang: LangCode;
  start: (slug: string) => void;
  next: () => void;
  prev: () => void;
  skip: () => void;
  finish: () => void;
  availableCurricula: TrainingCurriculum[];
  /** Map of curriculum slug → completion status. */
  completion: Record<string, 'done' | 'in_progress' | 'available'>;
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

function tx(text: { en: string } & Record<string, string | undefined>, lang: LangCode): string {
  return (text[lang] as string) || text.en;
}

export function TrainingV2Provider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const { language } = useTranslation();
  const navigate = useNavigate();
  const lang = (language as LangCode) || 'en';

  const role = (profile?.role as string) || 'housekeeping';

  const [active, setActive] = useState<TrainingCurriculum | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [completion, setCompletion] = useState<Record<string, 'done' | 'in_progress' | 'available'>>({});
  const autoStartedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const step = active ? active.steps[stepIndex] : null;
  const totalSteps = active?.steps.length || 0;

  // Persist progress
  const persist = useCallback(
    async (slug: string, idx: number, status: 'in_progress' | 'completed') => {
      if (!user) return;
      await supabase
        .from('user_tour_progress')
        .upsert(
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
    },
    [user],
  );

  // Initial: load progress map + auto-start once per user
  useEffect(() => {
    if (!user || autoStartedRef.current) return;
    autoStartedRef.current = true;

    (async () => {
      const { data } = await supabase
        .from('user_tour_progress')
        .select('tour_key, current_step, status')
        .eq('user_id', user.id);

      const map: Record<string, 'done' | 'in_progress' | 'available'> = {};
      const progressBySlug: Record<string, { idx: number; status: string }> = {};
      (data || []).forEach((row: any) => {
        progressBySlug[row.tour_key] = { idx: row.current_step ?? 0, status: row.status ?? 'in_progress' };
        map[row.tour_key] = row.status === 'completed' ? 'done' : 'in_progress';
      });
      setCompletion(map);

      // Check dismissal
      const { data: stateRow } = await supabase
        .from('user_training_state')
        .select('dismissed_until')
        .eq('user_id', user.id)
        .maybeSingle();
      const dismissed =
        stateRow?.dismissed_until && new Date(stateRow.dismissed_until) > new Date();
      if (dismissed) return;

      // Choose a curriculum to auto-start: first incomplete for role
      const candidates = curriculaForRole(role);
      const target = candidates.find((c) => map[c.slug] !== 'done');
      if (!target) return;
      const resumeIdx = progressBySlug[target.slug]?.idx ?? 0;
      // Delay a tick so the app shell renders first
      setTimeout(() => {
        setActive(target);
        setStepIndex(Math.min(resumeIdx, target.steps.length - 1));
      }, 1200);
    })();
  }, [user, role]);

  // Cross-page navigation + selector resolution + precondition gating
  useEffect(() => {
    if (!active || !step || !user) return;

    let cancelled = false;
    setRect(null);
    setWaiting(false);

    const run = async () => {
      // 1. Cross-page route
      if (step.route) {
        navigate(step.route);
      }
      // 2. Tab dispatch (page listens for tour:navigate)
      if (step.tab) {
        window.dispatchEvent(
          new CustomEvent('tour:navigate', { detail: { tab: step.tab, tourKey: active.slug } }),
        );
      }

      // 3. Precondition check — if false and step is optional, skip; else show waiting hint
      if (step.precondition) {
        const ok = await evaluateGuard(step.precondition, { userId: user.id, role });
        if (!ok) {
          if (step.optional) {
            // Auto-advance silently
            if (!cancelled) setTimeout(() => next(), 200);
            return;
          }
          if (!cancelled) setWaiting(true);
        }
      }

      // 4. Locate selector by polling (element may appear after route/tab switch)
      if (step.selector) {
        let attempts = 0;
        const tryLocate = () => {
          if (cancelled) return;
          const el = document.querySelector(step.selector!) as HTMLElement | null;
          if (el) {
            try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
            setTimeout(() => {
              if (!cancelled) setRect(el.getBoundingClientRect());
            }, 250);
          } else if (attempts++ < 30) {
            setTimeout(tryLocate, 150);
          }
        };
        tryLocate();
      }
    };
    run();

    // 5. Poll waitFor guard — when satisfied, auto-advance
    if (step.waitFor) {
      pollRef.current = setInterval(async () => {
        const ok = await evaluateGuard(step.waitFor!, { userId: user.id, role });
        if (ok && !cancelled) {
          if (pollRef.current) clearInterval(pollRef.current);
          next();
        }
      }, 4000);
    }
    // Poll precondition while waiting → auto-resume
    let preInterval: ReturnType<typeof setInterval> | null = null;
    if (step.precondition && !step.waitFor) {
      preInterval = setInterval(async () => {
        const ok = await evaluateGuard(step.precondition!, { userId: user.id, role });
        if (ok && !cancelled) {
          if (preInterval) clearInterval(preInterval);
          setWaiting(false);
          // Re-run to relocate selector
          run();
        }
      }, 4000);
    }

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      if (preInterval) clearInterval(preInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.slug, stepIndex]);

  // Reposition on resize / scroll
  useEffect(() => {
    if (!step?.selector) return;
    const reposition = () => {
      const el = document.querySelector(step.selector!) as HTMLElement | null;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [step?.selector, stepIndex]);

  const next = useCallback(() => {
    if (!active) return;
    if (stepIndex < active.steps.length - 1) {
      const ni = stepIndex + 1;
      setStepIndex(ni);
      persist(active.slug, ni, 'in_progress');
    } else {
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex]);

  const prev = useCallback(() => {
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  }, [stepIndex]);

  const finish = useCallback(() => {
    if (active) {
      persist(active.slug, active.steps.length, 'completed');
      setCompletion((m) => ({ ...m, [active.slug]: 'done' }));
    }
    setActive(null);
    setStepIndex(0);
    setRect(null);
    setWaiting(false);
  }, [active, persist]);

  const skip = useCallback(async () => {
    if (active && user) {
      await persist(active.slug, stepIndex, 'completed');
      // 30 day cooldown so we don't bug them again
      await supabase
        .from('user_training_state')
        .upsert(
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
  }, [active, stepIndex, user, persist]);

  const start = useCallback(
    async (slug: string) => {
      const c = findCurriculum(slug);
      if (!c) return;
      let resumeIdx = 0;
      if (user) {
        const { data } = await supabase
          .from('user_tour_progress')
          .select('current_step, status')
          .eq('user_id', user.id)
          .eq('tour_key', slug)
          .maybeSingle();
        if (data && data.status !== 'completed') resumeIdx = data.current_step || 0;
      }
      setActive(c);
      setStepIndex(Math.min(resumeIdx, c.steps.length - 1));
    },
    [user],
  );

  const availableCurricula = useMemo(() => curriculaForRole(role), [role]);

  const value: TrainingV2ContextValue = {
    active,
    step,
    stepIndex,
    totalSteps,
    rect,
    waiting,
    lang,
    start,
    next,
    prev,
    skip,
    finish,
    availableCurricula,
    completion,
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

export function txt<T extends { en: string; [k: string]: string | undefined }>(
  text: T,
  lang: LangCode,
): string {
  return tx(text, lang);
}

export { ALL_CURRICULA, MANAGER_ROLES };
