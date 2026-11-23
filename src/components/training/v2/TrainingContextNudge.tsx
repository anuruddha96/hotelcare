import { GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTrainingV2, txt } from './TrainingV2Provider';
import { words } from './curricula/visualTopics';

const labels = {
  show: words('Show me', 'Mutasd', 'Muéstrame', 'Chỉ cho tôi', 'Харуул', 'Показати'),
  resume: words('Resume', 'Folytatás', 'Continuar', 'Tiếp tục', 'Үргэлжлүүлэх', 'Продовжити'),
  later: words('Not now', 'Most nem', 'Ahora no', 'Để sau', 'Одоохондоо үгүй', 'Не зараз'),
};

export function TrainingContextNudge() {
  const { nudge, acceptNudge, declineNudge, lang, statuses } = useTrainingV2();
  if (!nudge) return null;
  return (
    <aside data-training-nudge={nudge.curriculum.slug}
      className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] z-[150] rounded-xl border border-primary/30 bg-card p-3 shadow-xl sm:left-auto sm:right-6 sm:w-80">
      <p className="flex items-center gap-2 text-sm font-semibold" role="status">
        <GraduationCap className="size-4 shrink-0 text-primary" aria-hidden="true" />{txt(nudge.curriculum.name, lang)}
      </p>
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" onClick={acceptNudge} className="min-h-10">{txt(statuses[nudge.curriculum.slug]?.status === 'in_progress' ? labels.resume : labels.show, lang)}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={declineNudge} className="min-h-10">{txt(labels.later, lang)}</Button>
      </div>
    </aside>
  );
}
