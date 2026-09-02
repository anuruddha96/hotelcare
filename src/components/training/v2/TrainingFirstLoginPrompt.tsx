import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GraduationCap, Play, Clock, CheckCircle2, UserRound, Languages } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTrainingV2, txt } from './TrainingV2Provider';
import type { I18nText, LangCode } from './types';

const TXT = {
  greeting: {
    en: 'Hi {name}, your first shift is ready',
    hu: 'Szia {name}, készen áll az első műszakod',
    es: 'Hola {name}, tu primer turno está listo',
    vi: 'Chào {name}, ca làm đầu tiên đã sẵn sàng',
    mn: 'Сайн уу {name}, анхны ээлжийн сургалт бэлэн',
    uk: 'Вітаємо, {name}! Ваша перша зміна готова',
  },
  title: {
    en: 'Your first shift, guided step by step',
    hu: 'Az első műszakod, lépésről lépésre',
    es: 'Tu primer turno, paso a paso',
    vi: 'Ca làm đầu tiên, hướng dẫn từng bước',
    mn: 'Анхны ээлж, алхам алхмаар',
    uk: 'Ваша перша зміна — крок за кроком',
  },
  hkBody: {
    en: 'This training follows the real housekeeping workflow. Hotel Care will move to the right screen, highlight the exact control and explain both what to do and why it matters.',
    hu: 'Ez a tréning a valódi housekeeping munkafolyamatot követi. A Hotel Care a megfelelő képernyőre visz, kiemeli a pontos funkciót, és elmagyarázza, mit kell tenni és miért fontos.',
    es: 'Esta formación sigue el flujo real de housekeeping. Hotel Care abrirá la pantalla correcta, resaltará el control exacto y explicará qué hacer y por qué importa.',
    vi: 'Khóa hướng dẫn đi theo quy trình buồng phòng thực tế. Hotel Care sẽ mở đúng màn hình, làm nổi bật đúng nút và giải thích cần làm gì cũng như vì sao quan trọng.',
    mn: 'Энэ сургалт бодит өрөө үйлчилгээний ажлын дарааллыг дагана. Hotel Care зөв дэлгэц рүү шилжиж, яг хэрэгтэй удирдлагыг онцолж, юу хийх болон яагаад чухал болохыг тайлбарлана.',
    uk: 'Навчання повторює реальний процес housekeeping. Hotel Care відкриє потрібний екран, підсвітить точний елемент і пояснить, що робити та чому це важливо.',
  },
  genericBody: {
    en: 'This guided training opens the relevant screen, highlights the exact control and explains the important actions for your role.',
    hu: 'Ez a vezetett tréning megnyitja a megfelelő képernyőt, kiemeli a pontos funkciót, és elmagyarázza a szerepkörödhöz tartozó fontos műveleteket.',
    es: 'Esta formación abre la pantalla relevante, resalta el control exacto y explica las acciones importantes para tu función.',
    vi: 'Hướng dẫn sẽ mở đúng màn hình, làm nổi bật đúng nút và giải thích các thao tác quan trọng cho vai trò của bạn.',
    mn: 'Энэ сургалт зөв дэлгэцийг нээж, хэрэгтэй удирдлагыг онцолж, таны үүрэгт чухал үйлдлүүдийг тайлбарлана.',
    uk: 'Навчання відкриває потрібний екран, підсвічує точний елемент і пояснює важливі дії для вашої ролі.',
  },
  learnTitle: {
    en: 'You will learn',
    hu: 'Ezt fogod megtanulni',
    es: 'Aprenderás',
    vi: 'Bạn sẽ học',
    mn: 'Та сурах зүйлс',
    uk: 'Ви навчитеся',
  },
  saved: {
    en: 'Your training progress belongs to your account and your preferred language.',
    hu: 'A tréning előrehaladása a saját fiókodhoz és a választott nyelvedhez igazodik.',
    es: 'El progreso de la formación pertenece a tu cuenta y usa tu idioma preferido.',
    vi: 'Tiến độ đào tạo được lưu cho tài khoản của bạn và dùng ngôn ngữ bạn đã chọn.',
    mn: 'Сургалтын явц таны бүртгэлд хадгалагдаж, сонгосон хэлээр харагдана.',
    uk: 'Прогрес навчання зберігається для вашого облікового запису й використовує обрану мову.',
  },
  start: {
    en: 'Start guided training',
    hu: 'Vezetett tréning indítása',
    es: 'Iniciar formación guiada',
    vi: 'Bắt đầu hướng dẫn',
    mn: 'Хөтөлсөн сургалт эхлүүлэх',
    uk: 'Почати навчання',
  },
  later: {
    en: 'Remind me tomorrow',
    hu: 'Emlékeztess holnap',
    es: 'Recuérdame mañana',
    vi: 'Nhắc lại vào ngày mai',
    mn: 'Маргааш сануул',
    uk: 'Нагадати завтра',
  },
  steps: {
    en: 'steps',
    hu: 'lépés',
    es: 'pasos',
    vi: 'bước',
    mn: 'алхам',
    uk: 'кроків',
  },
  minutes: {
    en: 'min',
    hu: 'perc',
    es: 'min',
    vi: 'phút',
    mn: 'мин',
    uk: 'хв',
  },
};

const HOUSEKEEPER_LEARNING: I18nText[] = [
  {
    en: 'Check in correctly and understand why location is requested',
    hu: 'Helyes bejelentkezés és a helyhozzáférés célja',
    es: 'Registrar entrada correctamente y entender por qué se solicita ubicación',
    vi: 'Chấm công đúng và hiểu lý do cần vị trí',
    mn: 'Зөв бүртгүүлж, байршил яагаад хэрэгтэйг ойлгох',
    uk: 'Правильно відмічатися й розуміти, навіщо потрібна геолокація',
  },
  {
    en: 'Read My Tasks, room type, priority, readiness and notes before entering',
    hu: 'A Saját feladatok, szobatípus, prioritás, készültség és megjegyzések értelmezése',
    es: 'Leer Mis Tareas, tipo, prioridad, disponibilidad y notas antes de entrar',
    vi: 'Đọc Nhiệm vụ, loại phòng, ưu tiên, trạng thái sẵn sàng và ghi chú trước khi vào',
    mn: 'Өрөөнд орохоос өмнө даалгавар, төрөл, эрэмбэ, бэлэн байдал, тэмдэглэлийг унших',
    uk: 'Читати Мої завдання, тип, пріоритет, готовність і примітки до входу',
  },
  {
    en: 'Use Photos, DND, Dirty Linen, Maintenance, Lost & Found and Notes correctly',
    hu: 'A Fotók, DND, Szennyes textil, Karbantartás, Talált tárgyak és Jegyzetek helyes használata',
    es: 'Usar correctamente Fotos, DND, Ropa Sucia, Mantenimiento, Objetos Perdidos y Notas',
    vi: 'Dùng đúng Ảnh, DND, Đồ vải bẩn, Bảo trì, Đồ thất lạc và Ghi chú',
    mn: 'Зураг, DND, Бохир даавуу, Засвар, Олдсон эд зүйл, Тэмдэглэлийг зөв ашиглах',
    uk: 'Правильно користуватися Фото, DND, Брудною білизною, Обслуговуванням, Lost & Found і Нотатками',
  },
  {
    en: 'Complete rooms safely, handle breaks and end the shift without leaving work behind',
    hu: 'A szobák biztonságos lezárása, szünetek kezelése és a műszak befejezése elmaradt feladat nélkül',
    es: 'Completar habitaciones, gestionar pausas y terminar el turno sin dejar tareas pendientes',
    vi: 'Hoàn tất phòng, quản lý nghỉ và kết thúc ca không để sót việc',
    mn: 'Өрөөг зөв дуусгаж, завсарлага авч, ажил үлдээлгүй ээлжээ хаах',
    uk: 'Правильно завершувати номери, перерви та зміну без незакритих завдань',
  },
];

function localeName(code: LangCode): string {
  const labels: Record<LangCode, string> = {
    en: 'English',
    hu: 'Magyar',
    es: 'Español',
    vi: 'Tiếng Việt',
    mn: 'Монгол',
    uk: 'Українська',
  };
  return labels[code] || labels.en;
}

export function TrainingFirstLoginPrompt() {
  const { profile } = useAuth();
  const { pendingAutoStart, acceptAutoStart, snoozeAutoStart, lang } = useTrainingV2();
  if (!pendingAutoStart) return null;

  const stepCount = pendingAutoStart.steps?.length ?? 0;
  const minutes = pendingAutoStart.estMinutes ?? Math.max(1, Math.round(stepCount * 0.35));
  const isHousekeeper = profile?.role === 'housekeeping' && pendingAutoStart.moduleKey === 'housekeeping';
  const fullName = profile?.full_name?.trim();
  const firstName = fullName?.split(/\s+/)[0];
  const title = firstName
    ? txt(TXT.greeting, lang).replace('{name}', firstName)
    : txt(TXT.title, lang);
  const learningItems = isHousekeeper
    ? HOUSEKEEPER_LEARNING
    : pendingAutoStart.steps.slice(0, 4).map((step) => step.title);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) void snoozeAutoStart(); }}>
      <DialogContent className="sm:max-w-[520px] p-0 overflow-hidden gap-0 max-h-[92vh] overflow-y-auto">
        <div className="bg-gradient-to-b from-primary/12 via-primary/5 to-transparent px-5 sm:px-7 pt-7 pb-5">
          <DialogHeader className="space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 ring-1 ring-primary/20">
              <GraduationCap className="h-6 w-6 text-primary" aria-hidden="true" />
            </div>
            <DialogTitle className="text-center text-xl font-semibold tracking-tight">
              {title}
            </DialogTitle>
            <DialogDescription className="text-center text-sm leading-relaxed text-muted-foreground max-w-[48ch] mx-auto">
              {txt(isHousekeeper ? TXT.hkBody : TXT.genericBody, lang)}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Badge variant="secondary" className="gap-1.5 font-normal">
              <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
              {profile?.role === 'housekeeping' ? 'Housekeeping' : profile?.role || 'Staff'}
            </Badge>
            <Badge variant="secondary" className="gap-1.5 font-normal">
              <Languages className="h-3.5 w-3.5" aria-hidden="true" />
              {localeName(lang)}
            </Badge>
          </div>
        </div>

        <div className="px-5 sm:px-7 pb-2">
          <div className="rounded-xl border bg-card px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug">{txt(pendingAutoStart.name, lang)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {stepCount} {txt(TXT.steps, lang)} · ~{minutes} {txt(TXT.minutes, lang)}
                </p>
              </div>
              <GraduationCap className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">
              {txt(TXT.learnTitle, lang)}
            </p>
            <div className="space-y-2.5">
              {learningItems.map((item, index) => (
                <div key={index} className="flex items-start gap-2.5 text-sm leading-snug">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{txt(item, lang)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-muted/60 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
            {txt(TXT.saved, lang)}
          </div>
        </div>

        <div className="flex flex-col gap-2 px-5 sm:px-7 pb-6 pt-4">
          <Button onClick={acceptAutoStart} className="w-full min-h-12 text-sm font-semibold">
            <Play className="h-4 w-4 mr-2" aria-hidden="true" />
            {txt(TXT.start, lang)}
          </Button>
          <Button variant="outline" onClick={() => void snoozeAutoStart()} className="w-full min-h-11 text-sm">
            <Clock className="h-4 w-4 mr-2 shrink-0" aria-hidden="true" />
            {txt(TXT.later, lang)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
