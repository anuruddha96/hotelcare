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
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSlntSimplifiedHousekeeping } from '@/hooks/useSlntSimplifiedHousekeeping';
import { useSlntTeamAEnabled } from '@/hooks/useSlntTeamAEnabled';
import { useTranslation } from '@/hooks/useTranslation';
import type { LangCode, RoleKey, TrainingCurriculum, TrainingScreenContext, TrainingStepV2 } from './types';
import { evaluateGuard } from './guards';
import { ALL_CURRICULA, curriculaForRole, findCurriculum, trainingRoleFor } from './curricula';
import { matchCurriculaToScreen, startKeyForScreenMatch, type ScreenMatch } from './screenContext';
import { claimTrainingPrompt, hasSeenTraining, trainingReleases } from './trainingReleases';
import { visibleTrainingTarget } from './visibleTarget';
import { VisualTrainingCue } from './VisualTrainingCue';
import { TrainingOverlayV2 } from './TrainingOverlayV2';
import { TrainingFirstLoginPrompt } from './TrainingFirstLoginPrompt';
import { TrainingNextModulePrompt } from './TrainingNextModulePrompt';
import { TrainingContextNudge } from './TrainingContextNudge';


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
  pause: () => void;
  dismissCurriculum: (slug: string, days?: number) => Promise<void>;
  markComplete: (slug: string) => Promise<void>;
  resetCurriculum: (slug: string) => Promise<void>;
  refreshStatuses: () => Promise<boolean>;
  availableCurricula: TrainingCurriculum[];
  completion: Record<string, CompletionStatus>;
  statuses: Record<string, CurriculumStatus>;
  registerLauncher: (el: HTMLElement | null) => void;
  /** First-login walkthrough prompt (null when hidden). */
  pendingAutoStart: TrainingCurriculum | null;
  isReleasePrompt: boolean;
  acceptAutoStart: () => void;
  snoozeAutoStart: () => Promise<void>;
  skipAutoStart: () => Promise<void>;
  /** Where the user is right now (router path + dashboard tab/sub-tab). */
  screen: TrainingScreenContext;
  /** Called by the dashboard whenever its active tab / sub-tab changes (null on unmount). */
  reportScreen: (tabs: { tab?: string; subTab?: string } | null) => void;
  /** Guides that have at least one step on the current screen, priority order. */
  onThisScreen: ScreenMatch[];
  /** Open a guide at the step that belongs to the current screen. */
  startForScreen: (slug: string) => Promise<void>;
  /** One-time "there is a guide for this screen" hint (null when hidden). */
  nudge: ScreenMatch | null;
  acceptNudge: () => void;
  declineNudge: () => void;
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

const SELECTOR_TIMEOUT_MS = 8000; // give up locating after 8s

function tx(text: import('./types').I18nText, lang: LangCode): string {
  return ((text as unknown as Record<string, string | undefined>)[lang]) || text.en;
}

export function TrainingV2Provider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const rollout = useSlntSimplifiedHousekeeping();
  const simplifiedEnabled = rollout === true;
  const teamAEnabled = useSlntTeamAEnabled();
  const { language } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const lang = (language as LangCode) || 'en';


  // Resolve `:org` and `:orgSlug` placeholders in step routes from the
  // current URL so curricula stay tenant-agnostic.
  const resolveRoute = useCallback(
    (raw?: string): string | undefined => {
      if (!raw) return raw;
      const seg = location.pathname.split('/').filter(Boolean);
      const firstSegment = seg[0];
      const orgSlug = firstSegment && !['training', 'auth', 'index'].includes(firstSegment)
        ? firstSegment
        : (profile as any)?.organization_slug || 'rdhotels';
      return raw.replace(/:orgSlug/g, orgSlug).replace(/:org\b/g, orgSlug);
    },
    [location.pathname, profile],
  );

  // Do NOT default role to 'housekeeping'. Wait until profile loads.
  const role = trainingRoleFor(profile);
  const isSlntTrainingOrg = ['slnt', 'slnt-group'].includes(profile?.organization_slug || '');
  const [isSlntTeamB, setIsSlntTeamB] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isSlntTrainingOrg || !simplifiedEnabled || role !== 'housekeeping' || !user?.id) {
      setIsSlntTeamB(null); return;
    }
    let current = true;
    void (async () => {
      const { data, error } = await (supabase as any).rpc('slnt_is_team_b_member');
      if (current && !error) setIsSlntTeamB(data === true);
      if (current && error) console.warn('[training] SLNT team membership unavailable:', error.message);
    })();
    return () => { current = false; };
  }, [user?.id, role, isSlntTrainingOrg, simplifiedEnabled]);

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
  const [releasePrompt, setReleasePrompt] = useState<TrainingCurriculum | null>(null);
  const [pendingNextModule, setPendingNextModule] = useState<TrainingCurriculum | null>(null);
  const autoStartedRef = useRef<string>();
  const dataReadyRef = useRef<Set<string>>(new Set());
  const launcherRef = useRef<HTMLElement | null>(null);
  const prevHotelRef = useRef<string | null>(assignedHotel);
  const deferredRef = useRef<DeferredStep[]>([]);
  const lastNextAtRef = useRef<number>(0);
  const pendingResumeIdxRef = useRef<number>(0);
  /** When a tour was last finished, paused or skipped — gates the contextual nudge. */
  const lastTourClosedAtRef = useRef<number>(0);
  /** True once progress has been fetched at least once (nudges wait for it). */
  const [loadedForUser, setLoadedForUser] = useState<string>();
  const latestStatuses = useRef(statuses);
  latestStatuses.current = statuses;
  const replayRef = useRef(false);
  const progressWrites = useRef<Promise<unknown>>(Promise.resolve());
  const latestUser = useRef(user?.id);
  latestUser.current = user?.id;

  useEffect(() => {
    setActive(null);
    setStepIndex(0);
    setPendingAutoStart(null);
    setReleasePrompt(null);
    setPendingNextModule(null);
    setCompletion({});
    setStatuses({});
    replayRef.current = false;
  }, [user?.id, profile?.organization_slug]);

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

  // ── Screen context: the dashboard reports its active tab / sub-tab through
  //    `reportScreen` (and clears it on unmount); the router gives the path.
  const [screenTabs, setScreenTabs] = useState<{ tab?: string; subTab?: string }>({});
  const reportScreen = useCallback((tabs: { tab?: string; subTab?: string } | null) => {
    setScreenTabs((current) => {
      const nextTab = tabs?.tab || undefined;
      const nextSubTab = tabs?.subTab || undefined;
      return current.tab === nextTab && current.subTab === nextSubTab
        ? current
        : { tab: nextTab, subTab: nextSubTab };
    });
  }, []);
  const screen = useMemo<TrainingScreenContext>(
    () => ({ pathname: location.pathname, tab: screenTabs.tab, subTab: screenTabs.subTab }),
    [location.pathname, screenTabs.tab, screenTabs.subTab],
  );

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
    (slug: string, idx: number, status: 'in_progress' | 'completed', stepKey?: string) => {
      if (!user || replayRef.current) return Promise.resolve();
      const { id } = user;
      const write = async () => {
        const now = new Date().toISOString();
        const row = {
          user_id: id,
          tour_key: slug,
          current_step: idx,
          status,
          completed_at: status === 'completed' ? now : null,
          updated_at: now,
        };
        const { error } = await supabase.from('user_tour_progress').upsert(
          row,
          { onConflict: 'user_id,tour_key', ignoreDuplicates: true },
        );
        if (error) return;
        // An older tab or a voluntary replay cannot overwrite completion.
        const updated = await supabase.from('user_tour_progress').update(row)
          .eq('user_id', id).eq('tour_key', slug).neq('status', 'completed');
        if (updated.error || !stepKey || latestUser.current !== id) return;
        await supabase.from('user_training_state').upsert({
          user_id: id,
          last_active_step_key: stepKey,
          last_guide_slug: slug,
          last_step: idx,
          paused_at: null,
          updated_at: now,
        }, { onConflict: 'user_id' });
      };
      const queued = progressWrites.current.then(write, write);
      progressWrites.current = queued;
      return queued;
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
    if (!user) return false;
    const { data, error } = await supabase
      .from('user_tour_progress')
      .select('tour_key, current_step, status, completed_at, updated_at')
      .eq('user_id', user.id);

    if (error || latestUser.current !== user.id) return false;
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
    latestStatuses.current = stMap;
    setCompletion(map);
    setStatuses(stMap);
    setLoadedForUser(user.id);
    return true;
  }, [user]);

  // Offer a single role-specific starter to a new account.
  useEffect(() => {
    if (!user || !role || autoStartedRef.current === user.id) return;
    if (isSlntTrainingOrg && rollout === null) return;
    if (simplifiedEnabled && isSlntTrainingOrg && role === 'housekeeping' && isSlntTeamB === null) return;
    // Don't auto-start on transient routes — wait until the user lands on
    // a real screen so the first step's anchor (e.g. hotel-switcher) is
    // actually in the DOM.
    const path = location.pathname;
    if (path === '/' || path === '/index' || path.endsWith('/auth') || path.includes('/training')) return;
    autoStartedRef.current = user.id;

    (async () => {
      if (!await refreshStatuses()) { if (autoStartedRef.current === user.id) autoStartedRef.current = undefined; return; }

      const { data: stateRow, error: stateError } = await supabase
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

      if (stateError || latestUser.current !== user.id) return;
      const age = Date.now() - Date.parse(user.created_at);
      const isNew = age >= 0 && age < 14 * 24 * 60 * 60 * 1000;
      if (!forced && (!isNew || dismissed || stateRow?.last_auto_start_at)) return;

      const { data: progressData, error: progressError } = await supabase
        .from('user_tour_progress')
        .select('tour_key, current_step, status')
        .eq('user_id', user.id);
      if (progressError || latestUser.current !== user.id) return;
      const progressBySlug = Object.fromEntries((progressData || []).map((row) => [row.tour_key, row]));
      const candidates = curriculaForRole(role).filter((c) => {
        if (!isSlntTrainingOrg || !simplifiedEnabled || c.moduleKey !== 'housekeeping') return c.onboarding && !c.slug.startsWith('slnt_');
        if (c.slug === 'slnt_team_b_cleaner_v3') return role === 'housekeeping' && isSlntTeamB === true;
        if (c.slug === 'slnt_team_a_cleaner_v1') return role === 'housekeeping' && teamAEnabled && isSlntTeamB === false;
        if (c.slug === 'slnt_simple_manager_b_v3') return c.roles.includes(role as RoleKey);
        return c.onboarding && role === 'housekeeping' && !teamAEnabled && isSlntTeamB === false;
      });
      const target = candidates.find((c) => [c.slug, ...(c.replaces || [])].every((slug) => progressBySlug[slug]?.status !== 'completed'));
      if (!target) return;
      if (!forced && !await claimTrainingPrompt(user.id, 'onboarding')) return;
      if (latestUser.current !== user.id) return;
      const resumeIdx = progressBySlug[target.slug]?.current_step ?? 0;
      pendingResumeIdxRef.current = target.shortTopic ? 0 : Math.min(resumeIdx, target.steps.length - 1);
      setPendingAutoStart(target);

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
  }, [user, role, location.pathname, refreshStatuses, isSlntTrainingOrg, isSlntTeamB, simplifiedEnabled, rollout, teamAEnabled]);

  const guardRole = profile?.role || 'unknown';
  const onSchedule = new URLSearchParams(location.search).get('view') === 'staff-schedule';

  // Step lifecycle: navigate, locate selector, gate on precondition
  //
  // CRITICAL: do NOT auto-call next() for optional steps whose precondition
  // fails. Instead, defer the step and advance ONCE per user click. Auto-skip
  // chains were the cause of "Next jumps two steps".
  useEffect(() => {
    if (!active || !step || !user) return;

    let cancelled = false;
    let advanced = false;
    let followTarget: MutationObserver | undefined;
    let detachTargetClick: (() => void) | null = null;
    const advanceOnce = () => {
      if (cancelled || advanced) return;
      advanced = true;
      if (stepIndex < active.steps.length - 1) {
        setStepIndex((current) => current === stepIndex ? current + 1 : current);
      } else {
        finishInternal();
      }
    };
    setRect(null);
    setWaiting(false);
    // Hide overlay until this step has resolved.
    setStepReady(false);

    const managerTraining = MANAGER_ROLES.includes(guardRole);
    const guardCtx = {
      userId: user.id,
      role: guardRole,
      assignedHotel,
      switchingHotel,
      dataReady: dataReadyRef.current,
    };

    // Silently defer the current step (no toast — user asked for skips to
    // happen in the background).
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
      // Check actual work state BEFORE navigating or looking for a hidden control.
      // A checked-in housekeeper must never be asked to check in twice.
      if (step.skipWhen && await evaluateGuard(step.skipWhen, guardCtx)) {
        advanceOnce();
        return;
      }
      // Waiting milestones also need to detect an already assigned room on resume.
      if (!step.selector && step.waitFor && await evaluateGuard(step.waitFor, guardCtx)) {
        advanceOnce();
        return;
      }
      if (cancelled) return;
      const targetRoute = resolveRoute(step.route);
      if (targetRoute && (location.pathname !== targetRoute || (step.tab && onSchedule))) {
        const search = step.tab ? new URLSearchParams({ tab: step.tab }).toString() : '';
        navigate({ pathname: targetRoute, search });
        // Stay hidden while we wait for the route to change — the effect
        // re-runs on location.pathname.
        return;
      }
      if (step.tab) {
        window.dispatchEvent(
          new CustomEvent('tour:navigate', {
            detail: { tab: step.tab, subTab: step.subTab, tourKey: active.slug },
          }),
        );
        window.dispatchEvent(
          new CustomEvent('training-navigate', {
            detail: { mainTab: step.tab, subTab: step.subTab },
          }),
        );
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        // The Housekeeping manager sub-tab mounts after the outer dashboard
        // tab. Re-emit once after that mount so switching Team/Approvals works
        // even when the whole module was not rendered at dispatch time.
        if (step.tab === 'housekeeping' && step.subTab) {
          await new Promise((resolve) => setTimeout(resolve, 180));
          if (cancelled) return;
          window.dispatchEvent(new CustomEvent('tour:navigate', {
            detail: { tab: step.tab, subTab: step.subTab, tourKey: active.slug },
          }));
        }
      }

      // Situational lessons (DND at the door, "No service"…) are explained
      // even when their control is not on screen, like manager lessons.
      const explainAnyway = managerTraining || step.explainWhenUnavailable === true;

      if (step.precondition) {
        const ok = await evaluateGuard(step.precondition, guardCtx);
        if (!ok) {
          if (step.optional) {
            if (explainAnyway) {
              // Explain an unavailable feature instead of silently skipping the module.
              if (!cancelled) { setWaiting(true); setStepReady(true); }
              return;
            }
            // Housekeeper's situational features can still be deferred.
            await deferCurrent();
            if (!cancelled) {
              setTimeout(advanceOnce, 30);
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

      if (step.skipIfTarget && visibleTrainingTarget(step.skipIfTarget)) {
        advanceOnce();
        return;
      }
      if (step.advanceOnTarget) {
        const follow = () => {
          if (visibleTrainingTarget(step.advanceOnTarget)) advanceOnce();
        };
        followTarget = new MutationObserver(follow);
        followTarget.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'class', 'hidden'] });
        follow();
        if (advanced) return;
      }

      if (step.selector) {
        const startedAt = Date.now();
        const tryLocate = () => {
          if (cancelled) return;
          const el = visibleTrainingTarget(step.selector);
          if (el) {
            setWaiting(false);
            if (step.advanceOnClick) {
              const onTargetClick = (event: MouseEvent) => {
                const selected = (event.target as Element | null)?.closest(step.selector!);
                if (selected && !selected.matches(':disabled')) window.setTimeout(advanceOnce, 80);
              };
              document.addEventListener('click', onTargetClick, true);
              detachTargetClick = () => document.removeEventListener('click', onTargetClick, true);
            }
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
          if (Date.now() - startedAt < (active.shortTopic || explainAnyway ? 2500 : SELECTOR_TIMEOUT_MS)) {
            setTimeout(tryLocate, 250);
          } else if (active.shortTopic) {
            setWaiting(true);
            setStepReady(true);
            setTimeout(tryLocate, 500);
          } else if (step.optional) {
            if (explainAnyway) {
              // Managers (and situational housekeeper lessons) need to
              // understand why a control was unavailable and decide to
              // continue; never rush invisibly through a lesson.
              setWaiting(true);
              setStepReady(true);
            } else {
              deferCurrent().then(advanceOnce);
            }
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
          advanceOnce();
        }
      }, 3000);
    }

    return () => {
      cancelled = true;
      detachTargetClick?.();
      followTarget?.disconnect();
      if (waitInterval) clearInterval(waitInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.slug, stepIndex, switchingHotel, assignedHotel, location.pathname, onSchedule, user?.id]);

  // Reposition on resize/scroll/orientation
  useEffect(() => {
    if (!step?.selector) return;
    let raf = 0;
    const reposition = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = visibleTrainingTarget(step.selector);
        setRect(el?.getBoundingClientRect() || null);
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
  const chainRootRef = useRef(false);
  const MANAGER_PATH_SLUG = 'v2_manager_complete_walkthrough';

  const finishInternal = useCallback(() => {
    const nextSlug = chainQueueRef.current.shift();
    const nextCur = nextSlug ? findCurriculum(nextSlug) : undefined;
    const isRoot = active?.slug === MANAGER_PATH_SLUG;

    if (active && !replayRef.current) {
      // The full path only becomes complete when its role-appropriate
      // individual modules have also been completed, not after its welcome.
      const status = isRoot && nextCur ? 'in_progress' : 'completed';
      void persist(active.slug, active.steps.length, status, step?.key);
      setCompletion((m) => ({ ...m, [active.slug]: status === 'completed' ? 'done' : 'in_progress' }));
      setStatuses((m) => ({ ...m, [active.slug]: {
        slug: active.slug,
        status: status === 'completed' ? 'done' : 'in_progress',
        currentStep: active.steps.length,
        totalSteps: active.steps.length,
      } }));
    }

    lastTourClosedAtRef.current = Date.now();
    setActive(null);
    setStepIndex(0);
    setRect(null);
    setWaiting(false);
    setStepReady(false);

    if (nextCur) {
      // Pause BETWEEN modules. The manager, not the tour, decides when
      // to open the next part. No unauthorized module is in the queue.
      setPendingNextModule(nextCur);
      return;
    }

    if (chainRootRef.current && !isRoot) {
      const root = findCurriculum(MANAGER_PATH_SLUG);
      if (root) void persist(MANAGER_PATH_SLUG, root.steps.length, 'completed');
      setCompletion((m) => ({ ...m, [MANAGER_PATH_SLUG]: 'done' }));
      if (root) setStatuses((m) => ({ ...m, [MANAGER_PATH_SLUG]: {
        slug: MANAGER_PATH_SLUG, status: 'done',
        currentStep: root.steps.length, totalSteps: root.steps.length,
      } }));
    }
    chainRootRef.current = false;
    setTimeout(() => launcherRef.current?.focus(), 50);
  }, [active, persist, step?.key]);

  const finish = finishInternal;

  // Close the overlay without completing or dismissing the curriculum.
  // The current step is already persisted by the step lifecycle, so the user
  // can resume from the same place later from Training Center.
  const pause = useCallback(() => {
    chainQueueRef.current = [];
    chainRootRef.current = false;
    lastTourClosedAtRef.current = Date.now();
    setPendingNextModule(null);
    setActive(null);
    setStepIndex(0);
    setRect(null);
    setWaiting(false);
    setStepReady(false);
    setTimeout(() => {
      launcherRef.current?.focus();
    }, 50);
  }, []);

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
    lastTourClosedAtRef.current = Date.now();
    setActive(null);
    setStepIndex(0);
    setRect(null);
    setTimeout(() => launcherRef.current?.focus(), 50);
  }, [active, stepIndex, user, persist]);

  // Skip this step for now → push to deferred queue, advance once. Silent.
  const skipForNow = useCallback(async () => {
    if (!active || !step) return;
    // Housekeeper step-skips are a user choice, not missing work that should
    // generate an unsolicited resume prompt later in the middle of a shift.
    if (active.slug.startsWith('v2_housekeeper_') || MANAGER_ROLES.includes(role || '')) {
      next();
      return;
    }
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
  }, [active, step, persistDeferred, next, role]);

  const start = useCallback(
    async (slug: string, opts?: { restart?: boolean; manual?: boolean; startAtKey?: string }) => {
      const c = findCurriculum(slug);
      if (!c || !c.roles.includes(role as any)) return;
      if (slug.startsWith('slnt_') && (!isSlntTrainingOrg || !simplifiedEnabled)) return;
      if (slug.startsWith('slnt_team_') && (isSlntTeamB === null || (slug === 'slnt_team_b_cleaner_v3' ? !isSlntTeamB : isSlntTeamB || !teamAEnabled))) return;
      if (isSlntTrainingOrg && simplifiedEnabled && c.shortTopic && c.moduleKey === 'housekeeping' &&
          (role !== 'housekeeping' || isSlntTeamB !== false || teamAEnabled)) return;
      setPendingNextModule(null);
      let resumeIdx = 0;
      let alreadyDone = statuses[slug]?.status === 'done';
      if (user && !opts?.restart) {
        const { data } = await supabase
          .from('user_tour_progress')
          .select('current_step, status')
          .eq('user_id', user.id)
          .eq('tour_key', slug)
          .maybeSingle();
        if (data?.status === 'completed') alreadyDone = true;
        else if (data) resumeIdx = data.current_step || 0;
        if (c.shortTopic && c.steps[resumeIdx]?.withinWorkflow) resumeIdx = 0;
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
      if (latestUser.current !== user?.id) return;
      replayRef.current = alreadyDone && !opts?.restart;
      // Seed the chain queue from the curriculum definition. Manual restart
      // or explicit start replaces any prior in-flight chain.
      const rawChain = Array.isArray(c.chain) ? c.chain : [];
      chainQueueRef.current = rawChain.filter((linkedSlug) => {
        const linked = findCurriculum(linkedSlug);
        return !!linked && linked.roles.includes(role as any) &&
          (opts?.restart || statuses[linkedSlug]?.status !== 'done');
      });
      chainRootRef.current = slug === MANAGER_PATH_SLUG && chainQueueRef.current.length > 0;

      // A manager who finished the introduction earlier resumes at the next
      // uncompleted module, not at the last introductory card again.
      if (slug === MANAGER_PATH_SLUG && !opts?.restart && resumeIdx >= c.steps.length - 1 &&
          statuses[slug]?.status === 'in_progress' && chainQueueRef.current.length > 0) {
        const nextSlug = chainQueueRef.current.shift();
        const nextCur = nextSlug ? findCurriculum(nextSlug) : undefined;
        if (nextCur) {
          setActive(null);
          setPendingNextModule(nextCur);
          return;
        }
      }
      setActive(c);
      setStepIndex(Math.min(resumeIdx, c.steps.length - 1));
    },
    [user, role, statuses, isSlntTrainingOrg, simplifiedEnabled, isSlntTeamB, teamAEnabled],
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

  const availableCurricula = useMemo(() => {
    // Revenue Management training applies to every organization, including
    // property-style tenants (SLNT).
    return curriculaForRole(role || '').filter(c => {
      if (!c.slug.startsWith('slnt_')) {
        const slntHousekeeping = isSlntTrainingOrg && simplifiedEnabled && c.shortTopic && c.moduleKey === 'housekeeping';
        if (slntHousekeeping) return role === 'housekeeping' && isSlntTeamB === false && !teamAEnabled;
        return true;
      }
      if (!isSlntTrainingOrg || !simplifiedEnabled) return false;
      if (role !== 'housekeeping') return c.slug === 'slnt_simple_manager_b_v3';
      if (isSlntTeamB === null) return false;
      return c.slug === (isSlntTeamB ? 'slnt_team_b_cleaner_v3' : (teamAEnabled ? 'slnt_team_a_cleaner_v1' : 'none'));
    });
  }, [role, isSlntTrainingOrg, isSlntTeamB, simplifiedEnabled, teamAEnabled]);


  // ── "On this screen": guides with a step on the current tab / page.
  const onThisScreen = useMemo(
    () => matchCurriculaToScreen(availableCurricula, screen, resolveRoute),
    [availableCurricula, screen, resolveRoute],
  );

  const startForScreen = useCallback(
    async (slug: string) => {
      const match = onThisScreen.find((m) => m.curriculum.slug === slug);
      if (!match) return start(slug, { manual: true });
      const startAtKey = match.curriculum.shortTopic ? undefined : startKeyForScreenMatch(match);
      // Open at the step that belongs to this screen (the engine still
      // navigates if needed); very early matches start from the welcome card
      // or the saved resume point instead.
      return start(slug, { manual: true, ...(startAtKey ? { startAtKey } : {}) });
    },
    [onThisScreen, start],
  );

  const [nudge, setNudge] = useState<ScreenMatch | null>(null);
  const visits = useRef(new Map<string, number>());
  const previousScreen = useRef('');
  const screenKey = [user?.id, screen.pathname, screen.tab, screen.subTab].join('|');

  useEffect(() => {
    setNudge(null);
    if (!user || !role || loadedForUser !== user.id || active || pendingAutoStart || releasePrompt || pendingNextModule) return;
    if (Date.now() - lastTourClosedAtRef.current < 60000) return;
    if (previousScreen.current !== screenKey) {
      previousScreen.current = screenKey;
      visits.current.set(screenKey, (visits.current.get(screenKey) || 0) + 1);
    }
    // A single page visit is ordinary work. Offer a guide on a return visit
    // after the user has stayed on the relevant screen for a short interval.
    if ((visits.current.get(screenKey) || 0) < 2) return;
    let current = true;
    const timer = window.setTimeout(async () => {
      if (document.visibilityState !== 'visible' || document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (!await refreshStatuses() || !current || latestUser.current !== user.id) return;
      for (const match of onThisScreen) {
        const { curriculum, stepKey } = match;
        if (!curriculum.shortTopic || hasSeenTraining(curriculum, latestStatuses.current)) continue;
        if (!visibleTrainingTarget(curriculum.steps.find((item) => item.key === stepKey)?.selector)) continue;
        const claimed = await claimTrainingPrompt(user.id, `context:${curriculum.slug}`);
        if (!current) return;
        if (claimed) {
          setNudge(match);
          return;
        }
      }
    }, 12000);
    return () => { current = false; window.clearTimeout(timer); };
  }, [user, role, screenKey, onThisScreen, active, pendingAutoStart, releasePrompt, pendingNextModule, refreshStatuses, loadedForUser]);

  useEffect(() => {
    if (!nudge) return;
    const timer = window.setTimeout(() => setNudge(null), 15000);
    return () => window.clearTimeout(timer);
  }, [nudge]);

  const acceptNudge = useCallback(() => {
    setNudge(null);
    if (nudge) void startForScreen(nudge.curriculum.slug);
  }, [nudge, startForScreen]);
  const declineNudge = useCallback(() => setNudge(null), []);

  useEffect(() => {
    const org = profile?.organization_slug;
    if (!trainingReleases.length || !org || !user || !role || loadedForUser !== user.id) return;
    if (active || pendingAutoStart || releasePrompt || pendingNextModule || nudge || location.pathname.includes('/training')) return;
    const eligible = trainingReleases.filter((release) => availableCurricula.some((guide) => guide.slug === release.curriculum));
    if (!eligible.length) return;
    let current = true;
    const check = async () => {
      if (document.visibilityState !== 'visible' || document.querySelector('[role="dialog"][data-state="open"]')) return;
      const { data, error } = await (supabase as any).from('training_release_approvals').select('release_id').eq('organization_slug', org)
        .in('release_id', eligible.map((release) => release.id));
      if (!current || error || !data?.length) return;
      if (!await refreshStatuses() || !current || latestUser.current !== user.id) return;
      for (const release of eligible) {
        const guide = availableCurricula.find((item) => item.slug === release.curriculum);
        if (!guide || !data.some((row: { release_id: string }) => row.release_id === release.id)) continue;
        if (hasSeenTraining(guide, latestStatuses.current)) continue;
        if (await claimTrainingPrompt(user.id, `release:${org}:${release.id}`)) {
          if (current) { setNudge(null); setReleasePrompt(guide); }
          break;
        }
        if (!current) break;
      }
    };
    const timer = window.setTimeout(check, 5000);
    const interval = window.setInterval(check, 5 * 60 * 1000);
    return () => { current = false; window.clearTimeout(timer); window.clearInterval(interval); };
  }, [user, role, profile?.organization_slug, availableCurricula, active, pendingAutoStart, releasePrompt, pendingNextModule, nudge, location.pathname, refreshStatuses, loadedForUser]);

  // Continue only after the manager explicitly chooses the next module.
  const continueNextModule = useCallback(async () => {
    const cur = pendingNextModule;
    if (!cur || !cur.roles.includes(role as any)) return;
    let idx = 0;
    if (user) {
      const { data } = await supabase.from('user_tour_progress')
        .select('current_step, status').eq('user_id', user.id)
        .eq('tour_key', cur.slug).maybeSingle();
      if (data && data.status !== 'completed') idx = data.current_step || 0;
    }
    setPendingNextModule(null);
    replayRef.current = false;
    setActive(cur);
    setStepIndex(Math.min(idx, cur.steps.length - 1));
  }, [pendingNextModule, role, user]);

  const laterNextModule = useCallback(() => {
    setPendingNextModule(null);
    chainQueueRef.current = [];
    chainRootRef.current = false;
  }, []);

  // First-login prompt actions
  const acceptAutoStart = useCallback(() => {
    if (releasePrompt) {
      setReleasePrompt(null);
      void start(releasePrompt.slug, { manual: true });
      return;
    }
    const target = pendingAutoStart;
    if (!target) return;
    chainQueueRef.current = (target.chain || []).filter((linkedSlug) => {
      const linked = findCurriculum(linkedSlug);
      return !!linked && linked.roles.includes(role as any) && statuses[linkedSlug]?.status !== 'done';
    });
    chainRootRef.current = target.slug === MANAGER_PATH_SLUG && chainQueueRef.current.length > 0;
    setPendingAutoStart(null);
    replayRef.current = false;
    setActive(target);
    setStepIndex(pendingResumeIdxRef.current || 0);
  }, [pendingAutoStart, releasePrompt, role, statuses, start]);

  const snoozeAutoStart = useCallback(async () => {
    setPendingAutoStart(null);
    setReleasePrompt(null);
  }, []);
  const skipAutoStart = snoozeAutoStart;

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
    pause,
    dismissCurriculum,
    markComplete,
    resetCurriculum,
    refreshStatuses,
    availableCurricula,
    completion,
    statuses,
    registerLauncher,
    pendingAutoStart: pendingAutoStart || releasePrompt,
    isReleasePrompt: Boolean(releasePrompt),
    acceptAutoStart,
    snoozeAutoStart,
    skipAutoStart,
    screen,
    reportScreen,
    onThisScreen,
    startForScreen,
    nudge,
    acceptNudge,
    declineNudge,
  };

  return (
    <TrainingV2Context.Provider value={value}>
      {children}
      {active && step && stepReady && (active.shortTopic ? <VisualTrainingCue /> : <TrainingOverlayV2 />)}
      {nudge && !active && !pendingAutoStart && !releasePrompt && !pendingNextModule && <TrainingContextNudge />}
      {(pendingAutoStart || releasePrompt) && !active && !pendingNextModule && <TrainingFirstLoginPrompt />}
      {pendingNextModule && !active && (
        <TrainingNextModulePrompt
          curriculum={pendingNextModule}
          lang={lang}
          onContinue={continueNextModule}
          onLater={laterNextModule}
        />
      )}
    </TrainingV2Context.Provider>
  );
}

export function useTrainingV2() {
  const ctx = useContext(TrainingV2Context);
  if (!ctx) throw new Error('useTrainingV2 outside provider');
  return ctx;
}

export function useTrainingV2Optional() {
  return useContext(TrainingV2Context);
}

export function txt(text: import('./types').I18nText, lang: LangCode): string {
  return tx(text, lang);
}

export { ALL_CURRICULA, MANAGER_ROLES };
