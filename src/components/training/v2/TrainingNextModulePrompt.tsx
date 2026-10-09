import { useEffect } from 'react';
import { ArrowRight, BookOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LangCode, TrainingCurriculum } from './types';
import { txt } from './TrainingV2Provider';

const LABELS = {
  title: { en: 'Nice work — one module complete', hu: 'Szép munka — egy modul kész', es: 'Bien — un módulo terminado', vi: 'Tốt lắm — đã xong một phần', mn: 'Сайн байна — нэг модуль дууслаа', uk: 'Чудово — один модуль завершено' },
  next: { en: 'Next optional module', hu: 'Következő választható modul', es: 'Siguiente módulo opcional', vi: 'Phần hướng dẫn tiếp theo', mn: 'Дараагийн сонголттой модуль', uk: 'Наступний необов’язковий модуль' },
  body: { en: 'Learn this part of the real HotelCare interface next. Nothing will be changed just by viewing the guide.', hu: 'Ismerd meg a HotelCare következő részét. Az útmutató megtekintése önmagában semmit sem módosít.', es: 'Conoce esta parte de HotelCare. La guía no modifica nada por sí sola.', vi: 'Tìm hiểu tiếp giao diện HotelCare; chỉ xem hướng dẫn sẽ không thay đổi dữ liệu.', mn: 'HotelCare-ийн дараагийн хэсгийг сураарай. Заавар үзэх нь юу ч өөрчлөхгүй.', uk: 'Дізнайтеся про наступну частину HotelCare. Перегляд підказок нічого не змінює.' },
  continue: { en: 'Continue to this module', hu: 'Tovább erre a modulra', es: 'Continuar este módulo', vi: 'Tiếp tục phần này', mn: 'Энэ модулийг үргэлжлүүлэх', uk: 'Перейти до цього модуля' },
  later: { en: 'Later — back to work', hu: 'Később — vissza a munkához', es: 'Más tarde — volver al trabajo', vi: 'Để sau — quay lại làm việc', mn: 'Дараа — ажилдаа буцах', uk: 'Пізніше — повернутися до роботи' },
};

export function TrainingNextModulePrompt({
  curriculum, lang, onContinue, onLater,
}: {
  curriculum: TrainingCurriculum;
  lang: LangCode;
  onContinue: () => void;
  onLater: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onLater();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onLater]);

  return (
    <div className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center bg-black/40 px-3 py-4 sm:py-8"
      role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="training-next-module-title"
        className="relative w-full max-w-md rounded-2xl border bg-background p-5 shadow-xl space-y-4">
        <button type="button" onClick={onLater} aria-label={txt(LABELS.later, lang)}
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted">
          <X className="h-5 w-5" />
        </button>
        <div className="pr-10 space-y-2">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-primary">
            <BookOpen className="h-4 w-4" /> {txt(LABELS.next, lang)}
          </div>
          <h2 id="training-next-module-title" className="text-lg font-semibold">{txt(LABELS.title, lang)}</h2>
          <p className="font-medium">{txt(curriculum.name, lang)}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{txt(LABELS.body, lang)}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Button onClick={onContinue} className="min-h-11 w-full">
            {txt(LABELS.continue, lang)} <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <Button onClick={onLater} variant="outline" className="min-h-11 w-full">
            {txt(LABELS.later, lang)}
          </Button>
        </div>
      </section>
    </div>
  );
}
