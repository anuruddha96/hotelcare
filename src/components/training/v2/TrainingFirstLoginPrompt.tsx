import { GraduationCap, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTrainingV2, txt } from './TrainingV2Provider';
import { words } from './curricula/visualTopics';

const labels = {
  newFeature: words('New feature', 'Új funkció', 'Nueva función', 'Tính năng mới', 'Шинэ боломж', 'Нова функція'),
  basics: words('Start with the basics', 'Kezdd az alapokkal', 'Empieza por lo básico', 'Bắt đầu với thao tác cơ bản', 'Үндсэн үйлдлээс эхэл', 'Почніть з основ'),
  show: words('Show me', 'Mutasd', 'Muéstrame', 'Chỉ cho tôi', 'Харуул', 'Показати'),
  later: words('Later', 'Később', 'Más tarde', 'Để sau', 'Дараа', 'Пізніше'),
};

export function TrainingFirstLoginPrompt() {
  const { pendingAutoStart, isReleasePrompt, acceptAutoStart, snoozeAutoStart, lang } = useTrainingV2();
  if (!pendingAutoStart) return null;
  return (
    <aside className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] z-[150] rounded-xl border border-primary/30 bg-card p-3 shadow-xl sm:left-auto sm:right-6 sm:w-80">
      <div className="flex items-center gap-2 text-xs font-semibold text-primary">
        <GraduationCap className="size-4" aria-hidden="true" />{txt(isReleasePrompt ? labels.newFeature : labels.basics, lang)}
      </div>
      <p className="mt-1 text-sm font-semibold" role="status">{txt(pendingAutoStart.name, lang)}</p>
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" onClick={acceptAutoStart} className="min-h-10">
          <Play className="mr-1 size-4" aria-hidden="true" />{txt(labels.show, lang)}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-10" onClick={() => void snoozeAutoStart()}>{txt(labels.later, lang)}</Button>
      </div>
    </aside>
  );
}
