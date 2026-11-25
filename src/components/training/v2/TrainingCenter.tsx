import { useEffect, useState } from 'react';
import { ArrowLeft, BedDouble, Check, ChevronRight, ClipboardList, ConciergeBell, Play, Receipt, Search, Shield, TrendingUp, Wrench } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useTrainingV2, txt } from './TrainingV2Provider';
import { words } from './curricula/visualTopics';
import { matchesTrainingTopic, trainingSearchTerms } from './topicSearch';
import type { TrainingCurriculum, TrainingModuleKey } from './types';

const UI = {
  title: words('Training Center', 'Képzési központ', 'Centro de formación', 'Trung tâm đào tạo', 'Сургалтын төв', 'Центр навчання'),
  search: words('How to…', 'Hogyan…', 'Cómo…', 'Cách…', 'Хэрхэн…', 'Як…'),
  none: words('No matching topics', 'Nincs ilyen téma', 'No hay temas coincidentes', 'Không có chủ đề phù hợp', 'Тохирох сэдэв алга', 'Відповідних тем немає'),
  unavailable: words('No guides for your role yet', 'Ehhez a szerepkörhöz még nincs útmutató', 'Aún no hay guías para tu rol', 'Chưa có hướng dẫn cho vai trò của bạn', 'Таны үүрэгт зориулсан заавар хараахан алга', 'Для вашої ролі ще немає посібників'),
  modules: words('All modules', 'Összes modul', 'Todos los módulos', 'Tất cả mô-đun', 'Бүх модуль', 'Усі модулі'),
  play: words('Show me', 'Mutasd', 'Muéstrame', 'Chỉ cho tôi', 'Харуул', 'Показати'),
  replay: words('Review again', 'Újranézés', 'Repasar', 'Xem lại', 'Дахин үзэх', 'Переглянути знову'),
  resume: words('Resume', 'Folytatás', 'Continuar', 'Tiếp tục', 'Үргэлжлүүлэх', 'Продовжити'),
  done: words('Completed', 'Befejezve', 'Completado', 'Hoàn thành', 'Дууссан', 'Завершено'),
};

const modules = [
  { key: 'housekeeping', icon: BedDouble, label: words('Housekeeping', 'Takarítás · Housekeeping', 'Limpieza', 'Buồng phòng', 'Өрөө үйлчилгээ', 'Прибирання') },
  { key: 'maintenance', icon: Wrench, label: words('Maintenance', 'Karbantartás', 'Mantenimiento', 'Bảo trì', 'Засвар', 'Технічне обслуговування') },
  { key: 'reception', icon: ConciergeBell, label: words('Reception', 'Recepció', 'Recepción', 'Lễ tân', 'Ресепшн', 'Рецепція') },
  { key: 'revenue', icon: TrendingUp, label: words('Revenue Management', 'Bevételkezelés', 'Gestión de ingresos', 'Quản lý doanh thu', 'Орлогын удирдлага', 'Управління доходами') },
  { key: 'hr_attendance', icon: ClipboardList, label: words('HR & Attendance', 'HR és jelenlét', 'RR. HH. y asistencia', 'Nhân sự và chấm công', 'Хүний нөөц ба ирц', 'Персонал і відвідуваність') },
  { key: 'invoices', icon: Receipt, label: words('Controlling & Invoices', 'Kontrolling és számlák', 'Control y facturas', 'Kiểm soát và hóa đơn', 'Хяналт ба нэхэмжлэх', 'Контролінг і рахунки') },
  { key: 'admin', icon: Shield, label: words('Getting started', 'Első lépések', 'Primeros pasos', 'Bắt đầu', 'Эхний алхам', 'Перші кроки') },
] satisfies { key: TrainingModuleKey; icon: typeof BedDouble; label: ReturnType<typeof words> }[];

export function TrainingCenter() {
  const { availableCurricula, statuses, start, refreshStatuses, lang } = useTrainingV2();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<TrainingModuleKey | null>(null);
  useEffect(() => { void refreshStatuses(); }, [refreshStatuses]);

  const terms = trainingSearchTerms(query);
  const groups = modules.map((module) => ({
    ...module,
    topics: availableCurricula.filter((topic) => (topic.moduleKey || 'admin') === module.key),
  })).filter((group) => group.topics.length > 0);
  const chosen = groups.find((group) => group.key === selected);
  const searching = terms.length > 0;
  const results = searching
    ? groups.flatMap((group) => group.topics.filter((topic) => matchesTrainingTopic(topic, group.label, terms)))
    : chosen?.topics || [];

  const renderTopic = (topic: TrainingCurriculum) => {
    const status = statuses[topic.slug]?.status;
    const label = txt(status === 'done' ? UI.replay : status === 'in_progress' ? UI.resume : UI.play, lang);
    return (
      <li key={topic.slug}>
        <button type="button" className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          onClick={() => void start(topic.slug, { manual: true })}>
          {status === 'done' ? <Check className="size-4 shrink-0 text-primary" aria-label={txt(UI.done, lang)} /> : <Play className="size-4 shrink-0 text-primary" aria-hidden="true" />}
          <span className="flex-1 text-sm font-medium">{txt(topic.name, lang)}</span>
          <span className="text-xs text-muted-foreground">{label}</span>
        </button>
      </li>
    );
  };

  return (
    <section className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{txt(UI.title, lang)}</h1>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={txt(UI.search, lang)}
          aria-label={txt(UI.search, lang)} className="h-12 pl-10 text-base" />
      </div>

      {!searching && !chosen && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {groups.map(({ key, label, icon: Icon }) => (
            <li key={key}>
              <button type="button" onClick={() => setSelected(key)} className="flex min-h-16 w-full items-center gap-3 rounded-xl border bg-card px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary">
                <Icon className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="flex-1 text-sm font-semibold">{txt(label, lang)}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!searching && chosen && (
        <div className="space-y-2">
          <button type="button" onClick={() => setSelected(null)} className="inline-flex min-h-10 items-center gap-2 text-sm text-primary">
            <ArrowLeft className="size-4" aria-hidden="true" />{txt(UI.modules, lang)}
          </button>
          <h2 className="text-lg font-semibold">{txt(chosen.label, lang)}</h2>
        </div>
      )}
      {results.length > 0 && <ul className="divide-y overflow-hidden rounded-xl border bg-card">{results.map(renderTopic)}</ul>}
      {searching && results.length === 0 && <p role="status" className="text-sm text-muted-foreground">{txt(UI.none, lang)}</p>}
      {!searching && groups.length === 0 && <p role="status" className="text-sm text-muted-foreground">{txt(UI.unavailable, lang)}</p>}
    </section>
  );
}
