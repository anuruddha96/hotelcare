import { useEffect, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { GraduationCap, Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTrainingV2, txt } from './TrainingV2Provider';

const TXT = {
  title: {
    en: 'There is a short guide for this screen',
    hu: 'Ehhez a képernyőhöz van egy rövid útmutató',
    es: 'Hay una guía corta para esta pantalla',
    vi: 'Có hướng dẫn ngắn cho màn hình này',
    mn: 'Энэ дэлгэцэд зориулсан богино заавар байна',
    uk: 'Для цього екрана є короткий посібник',
  },
  continueTitle: {
    en: 'Continue your guide for this screen',
    hu: 'Folytasd az útmutatót ehhez a képernyőhöz',
    es: 'Continúa la guía de esta pantalla',
    vi: 'Tiếp tục hướng dẫn cho màn hình này',
    mn: 'Энэ дэлгэцийн зааврыг үргэлжлүүлээрэй',
    uk: 'Продовжте посібник для цього екрана',
  },
  showMe: { en: 'Show me', hu: 'Mutasd', es: 'Muéstrame', vi: 'Hướng dẫn tôi', mn: 'Харуул', uk: 'Показати' },
  notNow: { en: 'Not now', hu: 'Most nem', es: 'Ahora no', vi: 'Để sau', mn: 'Одоохондоо үгүй', uk: 'Не зараз' },
  close: { en: 'Dismiss', hu: 'Elvetés', es: 'Cerrar', vi: 'Đóng', mn: 'Хаах', uk: 'Закрити' },
  min: { en: 'min', hu: 'perc', es: 'min', vi: 'phút', mn: 'мин', uk: 'хв' },
  steps: { en: 'steps', hu: 'lépés', es: 'pasos', vi: 'bước', mn: 'алхам', uk: 'кроків' },
};

/**
 * Small, self-dismissing hint that a guide exists for the screen in front of
 * the user. Anchored under the Help button on desktop; a compact bar at the
 * bottom on phones. Never blocks the page — one tap starts the guide, one tap
 * snoozes it.
 */
export function TrainingContextNudge() {
  const { nudge, acceptNudge, declineNudge, statuses, lang, reducedMotion } = useTrainingV2();
  const isMobile = useIsMobile();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!nudge) return;
    const measure = () => {
      const el = document.querySelector<HTMLElement>('[data-training="help-button"]');
      setAnchor(el && el.getClientRects().length > 0 ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [nudge]);

  if (!nudge) return null;
  const { curriculum } = nudge;
  const status = statuses[curriculum.slug]?.status;
  const inProgress = status === 'in_progress';
  const minutes = curriculum.estMinutes ?? Math.max(1, Math.round(curriculum.steps.length * 0.35));
  const width = 340;

  // Keep clear of the floating "Ask Mira" launcher (bottom-right, 56px tall).
  const style: CSSProperties = isMobile
    ? { left: 12, right: 12, bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))' }
    : anchor
      ? {
          top: anchor.bottom + 10,
          left: Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12)),
          width,
        }
      : { right: 16, bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))', width };

  const motionProps = reducedMotion
    ? { initial: false as const, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: isMobile ? 12 : -8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 } };

  return (
    <motion.div
      {...motionProps}
      role="status"
      aria-live="polite"
      data-training-nudge={curriculum.slug}
      className="fixed z-[150] rounded-2xl border border-primary/30 bg-card/98 text-card-foreground shadow-xl backdrop-blur-xl p-3.5"
      style={style}
    >
      <button
        type="button"
        onClick={declineNudge}
        aria-label={txt(TXT.close, lang)}
        className="absolute top-1.5 right-1.5 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-8">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <GraduationCap className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
            {txt(inProgress ? TXT.continueTitle : TXT.title, lang)}
          </p>
          <p className="mt-0.5 text-sm font-semibold leading-snug">{txt(curriculum.name, lang)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {curriculum.steps.length} {txt(TXT.steps, lang)} · ~{minutes} {txt(TXT.min, lang)}
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={acceptNudge} className="min-h-10 flex-1">
          <Play className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
          {txt(TXT.showMe, lang)}
        </Button>
        <Button size="sm" variant="ghost" onClick={declineNudge} className="min-h-10 flex-1 text-muted-foreground">
          {txt(TXT.notNow, lang)}
        </Button>
      </div>
    </motion.div>
  );
}
