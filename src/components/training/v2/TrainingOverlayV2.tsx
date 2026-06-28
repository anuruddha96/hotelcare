import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { X, Clock3, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useTrainingV2, txt } from './TrainingV2Provider';

const LABELS = {
  next: { en: 'Next', hu: 'Tovább', es: 'Siguiente', vi: 'Tiếp', mn: 'Дараах' },
  back: { en: 'Back', hu: 'Vissza', es: 'Atrás', vi: 'Lùi', mn: 'Буцах' },
  skip: { en: 'Skip', hu: 'Kihagyás', es: 'Omitir', vi: 'Bỏ qua', mn: 'Алгасах' },
  skipForNow: {
    en: 'Skip for now',
    hu: 'Most kihagyom',
    es: 'Omitir por ahora',
    vi: 'Bỏ qua hiện tại',
    mn: 'Одоохондоо алгасах',
  },
  done: { en: 'Got it', hu: 'Értem', es: 'Listo', vi: 'Đã hiểu', mn: 'Ойлголоо' },
  waiting: {
    en: 'Waiting for the right screen — we will continue automatically.',
    hu: 'Várjuk a megfelelő képernyőt — automatikusan folytatjuk.',
    es: 'Esperando la pantalla correcta — continuaremos automáticamente.',
    vi: 'Đang chờ màn hình phù hợp — sẽ tự tiếp tục.',
    mn: 'Тохирох дэлгэцийг хүлээж байна — автоматаар үргэлжилнэ.',
  },
  close: { en: 'Close training', hu: 'Bezárás', es: 'Cerrar', vi: 'Đóng', mn: 'Хаах' },
};

export function TrainingOverlayV2() {
  const {
    active,
    step,
    stepIndex,
    totalSteps,
    rect,
    waiting,
    reducedMotion,
    next,
    prev,
    skip,
    skipForNow,
    finish,
    lang,
  } = useTrainingV2();
  const cardRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const titleId = 'tv2-title';
  const descId = 'tv2-desc';

  // Focus + ESC trap
  useEffect(() => {
    if (!active) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    setTimeout(() => cardRef.current?.focus(), 30);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      }
      if (e.key === 'Tab' && cardRef.current) {
        const focusables = cardRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      try {
        prevFocus?.focus();
      } catch {}
    };
  }, [active, finish]);

  if (!active || !step) return null;
  const isLast = stepIndex === totalSteps - 1;
  const progress = Math.round(((stepIndex + 1) / totalSteps) * 100);

  // Position card
  const tooltipStyle: React.CSSProperties = (() => {
    if (isMobile) {
      return {
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        maxWidth: '100%',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      };
    }
    if (!rect) {
      return {
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(440px, calc(100vw - 32px))',
      };
    }
    const cardW = Math.min(420, window.innerWidth - 32);
    const cardH = 240;
    const spaceBelow = window.innerHeight - (rect.bottom + 16);
    const placeBelow = spaceBelow > cardH;
    const top = placeBelow ? rect.bottom + 16 : Math.max(16, rect.top - cardH - 16);
    let left = rect.left + rect.width / 2 - cardW / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - cardW - 16));
    return { top, left, width: cardW };
  })();

  const motionProps = reducedMotion
    ? { initial: false, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 12, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -8 },
      };

  return (
    <AnimatePresence>
      <motion.div
        key="tv2-root"
        className="fixed inset-0 z-[200] pointer-events-auto"
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        aria-hidden="false"
      >
        {/* Dim + spotlight cutout */}
        <svg
          className="absolute inset-0 w-full h-full"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <mask id="tv2-mask">
              <rect width="100%" height="100%" fill="white" />
              {rect && (
                <rect
                  x={rect.left - 10}
                  y={rect.top - 10}
                  width={rect.width + 20}
                  height={rect.height + 20}
                  rx="14"
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.65)" mask="url(#tv2-mask)" />
        </svg>

        {rect && !reducedMotion && (
          <motion.div
            className="absolute rounded-2xl ring-2 ring-primary pointer-events-none"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: [0.6, 1, 0.6], scale: [1, 1.02, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            style={{
              left: rect.left - 6,
              top: rect.top - 6,
              width: rect.width + 12,
              height: rect.height + 12,
              boxShadow: '0 0 0 6px hsl(var(--primary) / 0.15)',
            }}
            aria-hidden="true"
          />
        )}
        {rect && reducedMotion && (
          <div
            className="absolute rounded-2xl ring-2 ring-primary pointer-events-none"
            style={{
              left: rect.left - 6,
              top: rect.top - 6,
              width: rect.width + 12,
              height: rect.height + 12,
            }}
            aria-hidden="true"
          />
        )}

        {/* SR-only live region announces step changes */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {`Step ${stepIndex + 1} of ${totalSteps}: ${txt(step.title, lang)}`}
        </div>

        <motion.div
          key={`tv2-card-${stepIndex}`}
          ref={cardRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          {...motionProps}
          className={`absolute bg-card/95 backdrop-blur-xl text-card-foreground shadow-2xl border border-border p-5 outline-none ${
            isMobile ? 'rounded-t-2xl border-b-0' : 'rounded-2xl'
          }`}
          style={tooltipStyle}
        >
          <button
            onClick={finish}
            aria-label={txt(LABELS.close, lang)}
            aria-keyshortcuts="Escape"
            className="absolute top-3 right-3 min-h-11 min-w-11 inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-md"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="mb-3 pr-10">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
              <span className="uppercase tracking-wide font-semibold truncate">
                {txt(active.name, lang)}
              </span>
              <span aria-label={`Step ${stepIndex + 1} of ${totalSteps}`}>
                {stepIndex + 1} / {totalSteps}
              </span>
            </div>
            <div
              className="h-1 w-full bg-muted rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <motion.div
                className="h-full bg-primary"
                initial={false}
                animate={{ width: `${progress}%` }}
                transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 20 }}
              />
            </div>
          </div>

          <h3 id={titleId} className="text-lg font-semibold leading-tight mb-2">
            {txt(step.title, lang)}
          </h3>
          <p id={descId} className="text-sm text-muted-foreground leading-relaxed mb-4">
            {txt(step.body, lang)}
          </p>

          {waiting && (
            <div className="flex items-start gap-2 text-xs text-primary bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 mb-3">
              <Clock3 className="h-3.5 w-3.5 animate-pulse mt-0.5 shrink-0" aria-hidden="true" />
              <div className="flex-1">
                <p>{txt(LABELS.waiting, lang)}</p>
                <button
                  type="button"
                  onClick={skipForNow}
                  className="mt-1 underline underline-offset-2 hover:no-underline text-primary font-medium"
                >
                  {txt(LABELS.skipForNow, lang)}
                </button>
              </div>
            </div>
          )}

          <div
            className={`flex items-center justify-between gap-2 ${
              isMobile ? 'flex-col-reverse [&>div]:w-full [&>button]:w-full' : ''
            }`}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={skip}
              className="text-muted-foreground min-h-11"
              aria-label={txt(LABELS.skip, lang)}
            >
              {txt(LABELS.skip, lang)}
            </Button>
            <div className="flex gap-2">
              {stepIndex > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={prev}
                  className="min-h-11 flex-1"
                  aria-label={txt(LABELS.back, lang)}
                >
                  <ArrowLeft className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                  {txt(LABELS.back, lang)}
                </Button>
              )}
              {!isLast ? (
                <Button
                  size="sm"
                  onClick={next}
                  disabled={waiting && !!step.waitFor}
                  className="min-h-11 flex-1"
                  aria-label={txt(LABELS.next, lang)}
                >
                  {txt(LABELS.next, lang)}
                  <ArrowRight className="h-3.5 w-3.5 ml-1" aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={finish}
                  className="min-h-11 flex-1"
                  aria-label={txt(LABELS.done, lang)}
                >
                  <Check className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                  {txt(LABELS.done, lang)}
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
