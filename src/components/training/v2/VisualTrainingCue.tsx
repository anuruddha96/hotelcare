import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, MousePointer2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTrainingV2, txt } from './TrainingV2Provider';
import { visibleTrainingTarget } from './visibleTarget';
import { words } from './curricula/visualTopics';

const labels = {
  close: words('Close guide', 'Útmutató bezárása', 'Cerrar guía', 'Đóng hướng dẫn', 'Зааврыг хаах', 'Закрити посібник'),
  next: words('Next', 'Tovább', 'Siguiente', 'Tiếp', 'Дараах', 'Далі'),
  done: words('Done', 'Kész', 'Listo', 'Xong', 'Дуусгах', 'Готово'),
  unavailable: words('This control is unavailable right now.', 'Ez a funkció most nem érhető el.', 'Este control no está disponible ahora.', 'Tính năng này hiện chưa khả dụng.', 'Энэ үйлдэл одоогоор боломжгүй.', 'Ця дія зараз недоступна.'),
};

export function VisualTrainingCue() {
  const { step, rect, stepIndex, totalSteps, next, pause, finish, lang, waiting } = useTrainingV2();
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="listbox"][data-state="open"]')) return;
      pause();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [pause]);

  if (!step) return null;
  const anchor = visibleTrainingTarget(step.selector);
  const dialog = anchor?.closest('[role="dialog"]') || Array.from(document.querySelectorAll('[role="dialog"][data-state="open"]')).at(-1);
  const last = stepIndex + 1 === totalSteps;
  const interactive = step.advanceOnClick || step.advanceOnTarget;
  const placeAbove = rect && rect.bottom + 130 > window.innerHeight;
  const cue = (
    <aside aria-label={txt(step.title, lang)} data-training-cue
      className={`${dialog ? 'sticky bottom-0 z-20 my-1' : 'fixed z-[201] w-[min(24rem,calc(100%-1.5rem))]'} flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-primary/40 bg-card p-2.5 text-card-foreground shadow-lg`}
      style={dialog ? undefined : {
        left: rect ? Math.max(12, Math.min(rect.left, window.innerWidth - Math.min(384, window.innerWidth - 24) - 12)) : 12,
        ...(placeAbove && rect ? { bottom: Math.max(12, window.innerHeight - rect.top + 10) } : rect ? { top: Math.max(12, rect.bottom + 10) } : { bottom: 16 }),
      }}>
      <div className="flex min-w-0 flex-1 items-center gap-2" role="status">
        <MousePointer2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="text-sm font-semibold leading-snug">{txt(step.title, lang)}</span>
      </div>
      <span className="text-xs tabular-nums text-muted-foreground" aria-label={`${stepIndex + 1} / ${totalSteps}`}>{stepIndex + 1}/{totalSteps}</span>
      <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0" onClick={pause} aria-label={txt(labels.close, lang)}>
        <X className="size-4" aria-hidden="true" />
      </Button>
      {waiting && <p className="basis-full text-xs text-muted-foreground">{txt(labels.unavailable, lang)}</p>}
      {(!waiting && !interactive || waiting && step.optional && !last) && (
        <Button type="button" size="sm" className="ml-auto min-h-10" onClick={last ? finish : next}>
          {txt(last ? labels.done : labels.next, lang)}
          {last ? <Check className="ml-1 size-4" aria-hidden="true" /> : <ArrowRight className="ml-1 size-4" aria-hidden="true" />}
        </Button>
      )}
    </aside>
  );

  return <>
    {rect && rect.bottom > 0 && rect.top < window.innerHeight && createPortal(
      <div aria-hidden="true" className="pointer-events-none fixed z-[200] rounded-lg border-2 border-primary shadow-[0_0_0_3px_hsl(var(--background))]"
        style={{ left: rect.left - 3, top: rect.top - 3, width: rect.width + 6, height: rect.height + 6 }} />,
      document.body,
    )}
    {createPortal(cue, dialog || document.body)}
  </>;
}
