import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { X, Clock3, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useTrainingV2, txt } from './TrainingV2Provider';

const LABELS = {
  next: { en: 'Next', hu: 'Tovább', es: 'Siguiente', vi: 'Tiếp', mn: 'Дараах' },
  back: { en: 'Back', hu: 'Vissza', es: 'Atrás', vi: 'Lùi', mn: 'Буцах' },
  skip: { en: 'Skip', hu: 'Kihagyás', es: 'Omitir', vi: 'Bỏ qua', mn: 'Алгасах' },
  done: { en: 'Got it', hu: 'Értem', es: 'Listo', vi: 'Đã hiểu', mn: 'Ойлголоо' },
  waiting: {
    en: 'Waiting for you to complete this action…',
    hu: 'Várjuk, hogy elvégezd ezt a műveletet…',
    es: 'Esperando a que completes esta acción…',
    vi: 'Đang chờ bạn thực hiện…',
    mn: 'Энэ үйлдлийг хийхийг хүлээж байна…',
  },
};

export function TrainingOverlayV2() {
  const { active, step, stepIndex, totalSteps, rect, waiting, next, prev, skip, finish, lang } =
    useTrainingV2();

  if (!active || !step) return null;
  const isLast = stepIndex === totalSteps - 1;
  const progress = Math.round(((stepIndex + 1) / totalSteps) * 100);

  // Tooltip position: prefer below the spotlight; else bottom-center
  const tooltipStyle: React.CSSProperties = rect
    ? (() => {
        const cardW = Math.min(420, window.innerWidth - 32);
        const cardH = 240;
        const spaceBelow = window.innerHeight - (rect.bottom + 16);
        const placeBelow = spaceBelow > cardH;
        const top = placeBelow ? rect.bottom + 16 : Math.max(16, rect.top - cardH - 16);
        let left = rect.left + rect.width / 2 - cardW / 2;
        left = Math.max(16, Math.min(left, window.innerWidth - cardW - 16));
        return { top, left, width: cardW };
      })()
    : {
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(440px, calc(100vw - 32px))',
      };

  return (
    <AnimatePresence>
      <motion.div
        key="tv2-root"
        className="fixed inset-0 z-[200] pointer-events-auto"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Dim + spotlight cutout */}
        <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
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

        {/* Pulsing glow ring */}
        {rect && (
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
          />
        )}

        {/* Tooltip card */}
        <motion.div
          key={`tv2-card-${stepIndex}`}
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8 }}
          className="absolute bg-card/95 backdrop-blur-xl text-card-foreground rounded-2xl shadow-2xl border border-border p-5"
          style={tooltipStyle}
        >
          <button
            onClick={finish}
            aria-label="Close"
            className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Progress */}
          <div className="mb-3">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
              <span className="uppercase tracking-wide font-semibold">
                {txt(active.name, lang)}
              </span>
              <span>
                {stepIndex + 1} / {totalSteps}
              </span>
            </div>
            <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-primary"
                initial={false}
                animate={{ width: `${progress}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 20 }}
              />
            </div>
          </div>

          <h3 className="text-lg font-semibold leading-tight mb-2">{txt(step.title, lang)}</h3>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            {txt(step.body, lang)}
          </p>

          {waiting && (
            <div className="flex items-center gap-2 text-xs text-primary bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 mb-3">
              <Clock3 className="h-3.5 w-3.5 animate-pulse" />
              <span>{txt(LABELS.waiting, lang)}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={skip} className="text-muted-foreground">
              {txt(LABELS.skip, lang)}
            </Button>
            <div className="flex gap-2">
              {stepIndex > 0 && (
                <Button variant="outline" size="sm" onClick={prev}>
                  <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                  {txt(LABELS.back, lang)}
                </Button>
              )}
              {!isLast ? (
                <Button size="sm" onClick={next} disabled={waiting && !!step.waitFor}>
                  {txt(LABELS.next, lang)}
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              ) : (
                <Button size="sm" onClick={finish}>
                  <Check className="h-3.5 w-3.5 mr-1" />
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
