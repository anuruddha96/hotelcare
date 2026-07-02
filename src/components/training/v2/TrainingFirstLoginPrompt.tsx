import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
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
  },
  body: {
    en: "We'll walk you through every module one after another: HR, PMS, Team, Tickets, Revenue and Invoices. You can pause anytime — we'll resume where you left off.",
    hu: 'Sorra végigmegyünk minden modulon: HR, PMS, Csapat, Hibajegyek, Bevétel, Számlák. Bármikor szüneteltetheted.',
    es: 'Recorreremos cada módulo: HR, PMS, Equipo, Tickets, Ingresos, Facturas. Puedes pausar cuando quieras.',
    vi: 'Đi qua từng mô-đun: HR, PMS, Nhóm, Phiếu, Doanh thu, Hóa đơn. Có thể tạm dừng bất cứ lúc nào.',
    mn: 'HR, PMS, Баг, Тасалбар, Орлого, Нэхэмжлэх — модуль бүрээр явна. Хүссэн үедээ түр зогсоож болно.',
  },
  start: { en: 'Start tour', hu: 'Indítás', es: 'Comenzar', vi: 'Bắt đầu', mn: 'Эхлэх' },
  later: { en: 'Remind me tomorrow', hu: 'Emlékeztess holnap', es: 'Recuérdame mañana', vi: 'Nhắc lại vào ngày mai', mn: 'Маргааш сануул' },
  skip: { en: 'Skip', hu: 'Kihagyás', es: 'Omitir', vi: 'Bỏ qua', mn: 'Алгасах' },
};

export function TrainingFirstLoginPrompt() {
  const { pendingAutoStart, acceptAutoStart, snoozeAutoStart, skipAutoStart, lang } = useTrainingV2();
  if (!pendingAutoStart) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) void snoozeAutoStart(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 p-3 rounded-full bg-primary/10">
            <GraduationCap className="h-8 w-8 text-primary" aria-hidden="true" />
          </div>
          <DialogTitle className="text-center text-xl">{txt(TXT.title, lang)}</DialogTitle>
          <DialogDescription className="text-center">
            {txt(TXT.body, lang)}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 text-center">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-sm font-medium">
            {txt(pendingAutoStart.name, lang)}
          </span>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={() => void skipAutoStart()} className="flex-1 min-h-11">
            <X className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {txt(TXT.skip, lang)}
          </Button>
          <Button variant="outline" onClick={() => void snoozeAutoStart()} className="flex-1 min-h-11">
            <Clock className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {txt(TXT.later, lang)}
          </Button>
          <Button onClick={acceptAutoStart} className="flex-1 min-h-11">
            <Play className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {txt(TXT.start, lang)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
