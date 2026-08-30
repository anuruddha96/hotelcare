import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { GraduationCap, Play, Clock, X } from 'lucide-react';
import { useTrainingV2, txt } from './TrainingV2Provider';

const TXT = {
  title: {
    en: 'Ready for a quick guided tour?',
    hu: 'Készen állsz egy gyors bemutatóra?',
    es: '¿Listo para un recorrido guiado?',
    vi: 'Sẵn sàng cho hướng dẫn nhanh?',
    mn: 'Богино танилцуулгад бэлэн үү?',
    uk: 'Готові до швидкого туру?',
  },
  body: {
    en: "We'll walk you through every module one after another: HR, PMS, Team, Tickets, Revenue and Invoices. You can pause anytime — we'll resume where you left off.",
    hu: 'Sorra végigmegyünk minden modulon: HR, PMS, Csapat, Hibajegyek, Bevétel, Számlák. Bármikor szüneteltetheted.',
    es: 'Recorreremos cada módulo: HR, PMS, Equipo, Tickets, Ingresos, Facturas. Puedes pausar cuando quieras.',
    vi: 'Đi qua từng mô-đun: HR, PMS, Nhóm, Phiếu, Doanh thu, Hóa đơn. Có thể tạm dừng bất cứ lúc nào.',
    mn: 'HR, PMS, Баг, Тасалбар, Орлого, Нэхэмжлэх — модуль бүрээр явна. Хүссэн үедээ түр зогсоож болно.',
    uk: 'Ми проведемо вас через кожен модуль по черзі. Можна призупинити будь-коли — ми продовжимо з того ж місця.',
  },
  start: { en: 'Start tour', hu: 'Indítás', es: 'Comenzar', vi: 'Bắt đầu', mn: 'Эхлэх', uk: 'Розпочати тур' },
  later: { en: 'Remind me tomorrow', hu: 'Emlékeztess holnap', es: 'Recuérdame mañana', vi: 'Nhắc lại vào ngày mai', mn: 'Маргааш сануул', uk: 'Нагадати завтра' },
  skip: { en: 'Skip', hu: 'Kihagyás', es: 'Omitir', vi: 'Bỏ qua', mn: 'Алгасах', uk: 'Пропустити' },
};

export function TrainingFirstLoginPrompt() {
  const { pendingAutoStart, acceptAutoStart, snoozeAutoStart, skipAutoStart, lang } = useTrainingV2();
  if (!pendingAutoStart) return null;

  const stepCount = pendingAutoStart.steps?.length ?? 0;
  const minutes = Math.max(1, Math.round(stepCount * 0.25));

  return (
    <Dialog open onOpenChange={(open) => { if (!open) void snoozeAutoStart(); }}>
      <DialogContent className="sm:max-w-[440px] p-0 overflow-hidden gap-0">
        <div className="bg-gradient-to-b from-primary/10 to-transparent px-6 pt-7 pb-5">
          <DialogHeader className="space-y-2.5">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/20">
              <GraduationCap className="h-6 w-6 text-primary" aria-hidden="true" />
            </div>
            <DialogTitle className="text-center text-lg font-semibold tracking-tight">
              {txt(TXT.title, lang)}
            </DialogTitle>
            <DialogDescription className="text-center text-sm leading-relaxed text-muted-foreground max-w-[36ch] mx-auto">
              {txt(TXT.body, lang)}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="mx-6 rounded-lg border bg-muted/40 px-4 py-3">
          <p className="text-sm font-medium leading-snug">{txt(pendingAutoStart.name, lang)}</p>
          {stepCount > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {stepCount} steps · ~{minutes} min
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 px-6 pb-6 pt-4">
          <Button onClick={acceptAutoStart} className="w-full min-h-11">
            <Play className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {txt(TXT.start, lang)}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void snoozeAutoStart()} className="flex-1 min-h-10 text-xs sm:text-sm">
              <Clock className="h-4 w-4 mr-1.5 shrink-0" aria-hidden="true" />
              {txt(TXT.later, lang)}
            </Button>
            <Button variant="ghost" onClick={() => void skipAutoStart()} className="flex-1 min-h-10 text-xs sm:text-sm text-muted-foreground">
              <X className="h-4 w-4 mr-1.5 shrink-0" aria-hidden="true" />
              {txt(TXT.skip, lang)}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

