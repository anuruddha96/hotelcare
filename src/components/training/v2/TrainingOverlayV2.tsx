import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  X,
  Clock3,
  ArrowLeft,
  ArrowRight,
  Check,
  MousePointer2,
  Lightbulb,
  ShieldCheck,
} from 'lucide-react';
import { useTrainingV2, txt } from './TrainingV2Provider';

const LABELS = {
  next: { en: 'Next', hu: 'Tovább', es: 'Siguiente', vi: 'Tiếp', mn: 'Дараах', uk: 'Далі' },
  back: { en: 'Back', hu: 'Vissza', es: 'Atrás', vi: 'Lùi', mn: 'Буцах', uk: 'Назад' },
  endTraining: {
    en: 'End training',
    hu: 'Tréning befejezése',
    es: 'Terminar formación',
    vi: 'Kết thúc hướng dẫn',
    mn: 'Сургалт дуусгах',
    uk: 'Завершити навчання',
  },
  skipForNow: {
    en: 'Skip this step for now',
    hu: 'Ezt a lépést most kihagyom',
    es: 'Omitir este paso por ahora',
    vi: 'Tạm bỏ qua bước này',
    mn: 'Энэ алхмыг одоохондоо алгасах',
    uk: 'Пропустити цей крок зараз',
  },
  done: { en: 'Training complete', hu: 'Tréning kész', es: 'Formación completa', vi: 'Hoàn tất hướng dẫn', mn: 'Сургалт дууслаа', uk: 'Навчання завершено' },
  waiting: {
    en: 'This control is not available yet. Hotel Care is waiting for the right screen or work state.',
    hu: 'Ez a funkció még nem elérhető. A Hotel Care a megfelelő képernyőre vagy munkaállapotra vár.',
    es: 'Este control aún no está disponible. Hotel Care espera la pantalla o estado de trabajo correcto.',
    vi: 'Chức năng này chưa sẵn sàng. Hotel Care đang chờ đúng màn hình hoặc trạng thái công việc.',
    mn: 'Энэ удирдлага одоогоор бэлэн биш. Hotel Care зөв дэлгэц эсвэл ажлын төлөвийг хүлээж байна.',
    uk: 'Цей елемент поки недоступний. Hotel Care очікує правильний екран або робочий стан.',
  },
  close: {
    en: 'Close training — progress is saved',
    hu: 'Tréning bezárása — a haladás mentve',
    es: 'Cerrar formación — el progreso se guarda',
    vi: 'Đóng hướng dẫn — tiến độ được lưu',
    mn: 'Сургалтыг хаах — явц хадгалагдана',
    uk: 'Закрити навчання — прогрес збережено',
  },
  why: {
    en: 'Why this matters',
    hu: 'Miért fontos?',
    es: 'Por qué importa',
    vi: 'Vì sao quan trọng',
    mn: 'Яагаад чухал вэ?',
    uk: 'Чому це важливо',
  },
  tip: { en: 'Good practice', hu: 'Jó gyakorlat', es: 'Buena práctica', vi: 'Thực hành tốt', mn: 'Зөв дадал', uk: 'Корисна практика' },
  tryIt: {
    en: 'Do this now',
    hu: 'Csináld meg most',
    es: 'Hazlo ahora',
    vi: 'Thực hiện ngay',
    mn: 'Одоо хийгээрэй',
    uk: 'Зробіть це зараз',
  },
  autoContinue: {
    en: 'Use the highlighted control. The guide will continue automatically when the action is completed.',
    hu: 'Használd a kiemelt funkciót. Az útmutató automatikusan folytatódik, amikor a művelet elkészül.',
    es: 'Usa el control resaltado. La guía continuará automáticamente cuando completes la acción.',
    vi: 'Dùng nút đang được làm nổi bật. Hướng dẫn sẽ tự tiếp tục khi thao tác hoàn tất.',
    mn: 'Онцолсон удирдлагыг ашиглана уу. Үйлдэл дуусахад сургалт автоматаар үргэлжилнэ.',
    uk: 'Скористайтеся підсвіченим елементом. Навчання продовжиться автоматично після виконання дії.',
  },
  tapHere: {
    en: 'Use this control',
    hu: 'Ezt használd',
    es: 'Usa este control',
    vi: 'Dùng nút này',
    mn: 'Энийг ашигла',
    uk: 'Скористайтеся тут',
  },
  exitQuestion: {
    en: 'End this guided training?',
    hu: 'Befejezed ezt a vezetett tréninget?',
    es: '¿Terminar esta formación guiada?',
    vi: 'Kết thúc hướng dẫn này?',
    mn: 'Энэ сургалтыг дуусгах уу?',
    uk: 'Завершити це навчання?',
  },
  exitBody: {
    en: 'Ending marks this training as complete. If you only need to continue later, use the X to close it — your current step will be saved.',
    hu: 'A befejezés késznek jelöli a tréninget. Ha később folytatnád, zárd be az X-szel — az aktuális lépést elmentjük.',
    es: 'Al terminar, la formación se marcará como completada. Si quieres continuar después, ciérrala con la X: guardaremos el paso actual.',
    vi: 'Kết thúc sẽ đánh dấu hướng dẫn là đã hoàn thành. Nếu muốn tiếp tục sau, hãy đóng bằng nút X — bước hiện tại sẽ được lưu.',
    mn: 'Дуусгавал сургалтыг бүрэн дууссан гэж тэмдэглэнэ. Дараа үргэлжлүүлэх бол X-ээр хаана уу — одоогийн алхам хадгалагдана.',
    uk: 'Завершення позначить навчання як виконане. Якщо хочете продовжити пізніше, закрийте через X — поточний крок буде збережено.',
  },
  keepLearning: {
    en: 'Continue training',
    hu: 'Tréning folytatása',
    es: 'Continuar formación',
    vi: 'Tiếp tục hướng dẫn',
    mn: 'Сургалтаа үргэлжлүүлэх',
    uk: 'Продовжити навчання',
  },
  stepOf: {
    en: 'Step {current} of {total}',
    hu: '{current}. lépés / {total}',
    es: 'Paso {current} de {total}',
    vi: 'Bước {current} / {total}',
    mn: '{current}/{total}-р алхам',
    uk: 'Крок {current} з {total}',
  },
};

function stepOf(lang: Parameters<typeof txt>[1], current: number, total: number) {
  return txt(LABELS.stepOf, lang)
    .replace('{current}', String(current))
    .replace('{total}', String(total));
}

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
    pause,
    lang,
  } = useTrainingV2();
  const cardRef = useRef<HTMLDivElement>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const isMobile = useIsMobile();
  const titleId = 'tv2-title';
  const descId = 'tv2-desc';

  useEffect(() => {
    setConfirmExit(false);
  }, [active?.slug, stepIndex]);

  // The overlay intentionally does NOT consume pointer events outside the
  // coaching card. Housekeepers must be able to tap/swipe the highlighted
  // real control during hands-on steps such as check-in and Start Cleaning.
  useEffect(() => {
    if (!active) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    setTimeout(() => cardRef.current?.focus(), 30);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        pause();
        return;
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
  }, [active, pause]);

  if (!active || !step) return null;
  const isLast = stepIndex === totalSteps - 1;
  const progress = Math.round(((stepIndex + 1) / totalSteps) * 100);
  const requiresAction = Boolean(step.waitFor);
  const mobileAtTop = Boolean(isMobile && rect && rect.top > window.innerHeight * 0.56);

  const tooltipStyle: CSSProperties = (() => {
    if (isMobile) {
      return {
        left: 0,
        right: 0,
        ...(mobileAtTop ? { top: 0 } : { bottom: 0 }),
        width: '100%',
        maxWidth: '100%',
        maxHeight: 'min(58dvh, calc(100dvh - 72px))',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
        paddingBottom: mobileAtTop
          ? '20px'
          : 'calc(96px + env(safe-area-inset-bottom, 0px))',
      };
    }
    if (!rect) {
      return {
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(460px, calc(100vw - 32px))',
      };
    }
    const cardW = Math.min(450, window.innerWidth - 32);
    const cardH = 380;
    const spaceBelow = window.innerHeight - (rect.bottom + 16);
    const placeBelow = spaceBelow > cardH;
    const top = placeBelow ? rect.bottom + 16 : Math.max(16, rect.top - cardH - 16);
    let left = rect.left + rect.width / 2 - cardW / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - cardW - 16));
    return { top, left, width: cardW, maxHeight: 'calc(100% - 32px)', overflowY: 'auto' };
  })();

  const pointerStyle: CSSProperties | undefined = rect
    ? {
        left: Math.max(12, Math.min(rect.left + rect.width / 2, window.innerWidth - 150)),
        top:
          rect.bottom + 52 < window.innerHeight
            ? rect.bottom + 10
            : Math.max(8, rect.top - 42),
      }
    : undefined;

  const motionProps = reducedMotion
    ? { initial: false as const, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 14, scale: 0.985 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -8, scale: 0.99 },
      };

  return (
    <AnimatePresence>
      <motion.div
        key="tv2-root"
        className="fixed inset-0 z-[200] pointer-events-none"
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        aria-hidden="false"
      >
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
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
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.64)" mask="url(#tv2-mask)" />
        </svg>

        {rect && !reducedMotion && (
          <motion.div
            className="absolute rounded-2xl ring-2 ring-primary pointer-events-none"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: [0.62, 1, 0.62], scale: [1, 1.015, 1] }}
            transition={{ duration: 1.7, repeat: Infinity }}
            style={{
              left: rect.left - 6,
              top: rect.top - 6,
              width: rect.width + 12,
              height: rect.height + 12,
              boxShadow: '0 0 0 7px hsl(var(--primary) / 0.14)',
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

        {rect && (
          <motion.div
            className="absolute z-[201] pointer-events-none inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground shadow-lg"
            style={pointerStyle}
            initial={reducedMotion ? false : { opacity: 0, y: 4 }}
            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: [0, -4, 0] }}
            transition={reducedMotion ? { duration: 0 } : { y: { duration: 1.2, repeat: Infinity }, opacity: { duration: 0.2 } }}
            aria-hidden="true"
          >
            <MousePointer2 className="h-3.5 w-3.5" />
            {txt(LABELS.tapHere, lang)}
          </motion.div>
        )}

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {`${stepOf(lang, stepIndex + 1, totalSteps)}: ${txt(step.title, lang)}`}
        </div>

        <motion.div
          key={`tv2-card-${stepIndex}`}
          ref={cardRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          aria-describedby={descId}
          {...motionProps}
          className={`absolute pointer-events-auto bg-card/98 backdrop-blur-xl text-card-foreground shadow-2xl border border-border p-5 outline-none ${
            isMobile
              ? mobileAtTop
                ? 'rounded-b-2xl border-t-0'
                : 'rounded-t-2xl border-b-0'
              : 'rounded-2xl'
          }`}
          style={tooltipStyle}
        >
          <button
            type="button"
            onClick={pause}
            aria-label={txt(LABELS.close, lang)}
            aria-keyshortcuts="Escape"
            className="absolute top-3 right-3 z-20 min-h-11 min-w-11 inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-md bg-card/90 active:scale-95 touch-manipulation"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="mb-3 pr-10">
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground mb-2">
              <div className="min-w-0 flex items-center gap-2">
                {step.phase && (
                  <Badge variant="secondary" className="max-w-[230px] truncate font-medium text-[10px]">
                    {txt(step.phase, lang)}
                  </Badge>
                )}
              </div>
              <span className="shrink-0" aria-label={stepOf(lang, stepIndex + 1, totalSteps)}>
                {stepIndex + 1} / {totalSteps}
              </span>
            </div>
            <div
              className="h-1.5 w-full bg-muted rounded-full overflow-hidden"
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

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${active.slug}-${step.key}`}
              initial={reducedMotion ? false : { opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, x: -8 }}
              transition={{ duration: reducedMotion ? 0 : 0.2 }}
            >
              <h3 id={titleId} className="text-lg font-semibold leading-tight mb-2">
                {txt(step.title, lang)}
              </h3>
              <p id={descId} className="text-sm text-muted-foreground leading-relaxed">
                {txt(step.body, lang)}
              </p>

              {step.purpose && (
                <div className="mt-3 flex items-start gap-2.5 rounded-lg border bg-muted/45 px-3 py-2.5">
                  <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/75">
                      {txt(LABELS.why, lang)}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {txt(step.purpose, lang)}
                    </p>
                  </div>
                </div>
              )}

              {step.tip && (
                <div className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                  <Lightbulb className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
                  <span><strong className="font-semibold text-foreground/80">{txt(LABELS.tip, lang)}:</strong> {txt(step.tip, lang)}</span>
                </div>
              )}

              {requiresAction && !waiting && (
                <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2.5 text-xs text-primary">
                  <MousePointer2 className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">{txt(LABELS.tryIt, lang)}</p>
                    <p className="mt-0.5 leading-relaxed text-primary/90">{txt(LABELS.autoContinue, lang)}</p>
                    {step.optional && (
                      <button
                        type="button"
                        onClick={skipForNow}
                        className="mt-1.5 min-h-9 underline underline-offset-2 hover:no-underline font-semibold"
                      >
                        {txt(LABELS.skipForNow, lang)}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {waiting && (
                <div className="mt-3 flex items-start gap-2 text-xs text-primary bg-primary/10 border border-primary/20 rounded-lg px-3 py-2.5">
                  <Clock3 className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${reducedMotion ? '' : 'animate-pulse'}`} aria-hidden="true" />
                  <div className="flex-1">
                    <p className="leading-relaxed">{txt(LABELS.waiting, lang)}</p>
                    <button
                      type="button"
                      onClick={skipForNow}
                      className="mt-1.5 underline underline-offset-2 hover:no-underline text-primary font-semibold"
                    >
                      {txt(LABELS.skipForNow, lang)}
                    </button>
                  </div>
                </div>
              )}

              {confirmExit && (
                <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-3">
                  <p className="text-sm font-semibold">{txt(LABELS.exitQuestion, lang)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{txt(LABELS.exitBody, lang)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setConfirmExit(false)} className="min-h-10 flex-1">
                      {txt(LABELS.keepLearning, lang)}
                    </Button>
                    <Button type="button" size="sm" variant="destructive" onClick={skip} className="min-h-10 flex-1">
                      {txt(LABELS.endTraining, lang)}
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {!confirmExit && (
            <div
              className={`mt-4 flex items-center justify-between gap-2 ${
                isMobile ? 'flex-col-reverse [&>div]:w-full [&>button]:w-full' : ''
              }`}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmExit(true)}
                className="text-muted-foreground min-h-11"
                aria-label={txt(LABELS.endTraining, lang)}
              >
                {txt(LABELS.endTraining, lang)}
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
                    disabled={waiting || requiresAction}
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
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
