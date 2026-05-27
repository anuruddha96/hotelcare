import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { X, HelpCircle } from 'lucide-react';

export interface TourStep {
  selector?: string; // css selector to spotlight; if omitted, centers
  titleKey: string;
  bodyKey: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Optional tab key. GuidedTour dispatches a `tour:navigate` CustomEvent with this
   *  before locating the selector, so pages can switch tabs to reveal the target. */
  tab?: string;
}

interface TourContextValue {
  start: (key: string, steps: TourStep[]) => void;
}
const TourContext = createContext<TourContextValue | null>(null);

export function GuidedTourProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [active, setActive] = useState<{ key: string; steps: TourStep[] } | null>(null);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!active) return;
    const step = active.steps[index];
    if (!step?.selector) { setRect(null); return; }
    const el = document.querySelector(step.selector) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => setRect(el.getBoundingClientRect()), 250);
    } else setRect(null);
  }, [active, index]);

  const finish = async () => {
    if (active && user) {
      await supabase.from('user_tour_progress')
        .upsert({ user_id: user.id, tour_key: active.key }, { onConflict: 'user_id,tour_key' });
    }
    setActive(null); setIndex(0); setRect(null);
  };

  const start = (key: string, steps: TourStep[]) => {
    setActive({ key, steps }); setIndex(0);
  };

  return (
    <TourContext.Provider value={{ start }}>
      {children}
      <AnimatePresence>
        {active && (
          <motion.div
            className="fixed inset-0 z-[100] pointer-events-auto"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            {/* dimmed backdrop with spotlight cutout */}
            <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
              <defs>
                <mask id="tour-mask">
                  <rect width="100%" height="100%" fill="white" />
                  {rect && (
                    <rect x={rect.left - 8} y={rect.top - 8}
                      width={rect.width + 16} height={rect.height + 16}
                      rx="12" fill="black" />
                  )}
                </mask>
              </defs>
              <rect width="100%" height="100%" fill="rgba(0,0,0,0.7)" mask="url(#tour-mask)" />
            </svg>
            {rect && (
              <motion.div
                className="absolute rounded-xl ring-2 ring-primary pointer-events-none"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
              />
            )}
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-md bg-card text-card-foreground rounded-2xl shadow-2xl border border-border p-5"
            >
              <button
                onClick={finish}
                className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
                aria-label="Close"
              ><X className="h-4 w-4" /></button>
              <div className="text-xs text-muted-foreground mb-1">
                {index + 1} / {active.steps.length}
              </div>
              <h3 className="text-lg font-semibold mb-2">{t(active.steps[index].titleKey)}</h3>
              <p className="text-sm text-muted-foreground mb-4">{t(active.steps[index].bodyKey)}</p>
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" size="sm" onClick={finish}>{t('tour.skip')}</Button>
                <div className="flex gap-2">
                  {index > 0 && (
                    <Button variant="outline" size="sm" onClick={() => setIndex(i => i - 1)}>
                      {t('tour.back')}
                    </Button>
                  )}
                  {index < active.steps.length - 1 ? (
                    <Button size="sm" onClick={() => setIndex(i => i + 1)}>{t('tour.next')}</Button>
                  ) : (
                    <Button size="sm" onClick={finish}>{t('tour.done')}</Button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </TourContext.Provider>
  );
}

export function useGuidedTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useGuidedTour outside provider');
  return ctx;
}

/** Auto-run a tour the first time the user visits a screen. */
export function useFirstRunTour(key: string, steps: TourStep[]) {
  const { user } = useAuth();
  const { start } = useGuidedTour();
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('user_tour_progress').select('tour_key')
        .eq('user_id', user.id).eq('tour_key', key).maybeSingle();
      if (!cancelled && !data) {
        setTimeout(() => start(key, steps), 600);
      }
    })();
    return () => { cancelled = true; };
  }, [user, key]);
}

export function TourReplayButton({ tourKey, steps }: { tourKey: string; steps: TourStep[] }) {
  const { start } = useGuidedTour();
  const { t } = useTranslation();
  return (
    <Button variant="ghost" size="sm" onClick={() => start(tourKey, steps)}>
      <HelpCircle className="h-4 w-4 mr-1" /> {t('tour.replay')}
    </Button>
  );
}
