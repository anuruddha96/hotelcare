import { useEffect, useMemo, useState } from 'react';
import { useTrainingV2, txt } from './TrainingV2Provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  Play, RefreshCw, CheckCircle2, BellOff, GraduationCap, Sparkles,
  BedDouble, ClipboardList, ConciergeBell, Wrench, TrendingUp, Receipt, Shield, Search,
  type LucideIcon,
} from 'lucide-react';
import type { I18nText, TrainingCurriculum, TrainingModuleKey } from './types';

const TXT = {
  title: { en: 'Training Center', hu: 'Képzési központ', es: 'Centro de entrenamiento', vi: 'Trung tâm đào tạo', mn: 'Сургалтын төв', uk: 'Центр навчання' },
  subtitle: {
    en: 'Pick a module, then tap a unit. We navigate you to the right screen and highlight what to do. Progress is saved automatically.',
    hu: 'Válassz modult, majd egy egységet. Odavezetünk és kiemeljük a teendőt. A haladás automatikusan mentődik.',
    es: 'Elige un módulo y luego una unidad. Te llevamos a la pantalla correcta y resaltamos qué hacer. El progreso se guarda solo.',
    vi: 'Chọn mô-đun rồi chọn đơn vị. Chúng tôi sẽ đưa bạn đến đúng màn hình và chỉ rõ việc cần làm. Tiến độ được lưu tự động.',
    mn: 'Модуль, дараа нь нэгжийг сонго. Бид зөв дэлгэц рүү аваачиж, юу хийхийг онцолно. Явц автоматаар хадгалагдана.',
    uk: 'Оберіть модуль, потім розділ. Ми відкриємо потрібний екран і підсвітимо, що робити. Прогрес зберігається автоматично.',
  },
  fullTitle: { en: 'Full guided tour', hu: 'Teljes bemutató', es: 'Recorrido completo', vi: 'Toàn bộ hướng dẫn', mn: 'Бүрэн танилцуулга', uk: 'Повний тур' },
  fullBody: {
    en: 'Learn each module one at a time. You choose when to continue.',
    hu: 'Minden modult külön tanulhatsz meg. Te döntöd el, mikor folytatod.',
    es: 'Un módulo a la vez. Tú decides cuándo continuar.',
    vi: 'Học từng mô-đun. Bạn quyết định khi nào tiếp tục.',
    mn: 'Модуль бүрээр тус тусад нь сур. Хэзээ үргэлжлүүлэхээ өөрөө шийд.',
    uk: 'Вивчайте модулі по одному. Ви самі вирішуєте, коли продовжити.',
  },
  start: { en: 'Start', hu: 'Indítás', es: 'Iniciar', vi: 'Bắt đầu', mn: 'Эхлэх', uk: 'Почати' },
  resume: { en: 'Resume', hu: 'Folytatás', es: 'Continuar', vi: 'Tiếp tục', mn: 'Үргэлжлүүлэх', uk: 'Продовжити' },
  restart: { en: 'Restart', hu: 'Újraindítás', es: 'Reiniciar', vi: 'Khởi động lại', mn: 'Дахин эхлэх', uk: 'Почати заново' },
  markDone: { en: 'Mark complete', hu: 'Kész', es: 'Completar', vi: 'Hoàn tất', mn: 'Дуусгах', uk: 'Позначити виконаним' },
  dismiss: { en: 'Mute 30 days', hu: 'Némítás 30 napra', es: 'Silenciar 30 días', vi: 'Tắt 30 ngày', mn: '30 хоног нуух', uk: 'Вимкнути на 30 днів' },
  done: { en: 'Completed', hu: 'Befejezve', es: 'Completado', vi: 'Hoàn thành', mn: 'Дууссан', uk: 'Завершено' },
  inProgress: { en: 'In progress', hu: 'Folyamatban', es: 'En progreso', vi: 'Đang làm', mn: 'Үргэлжилж байна', uk: 'У процесі' },
  notStarted: { en: 'Not started', hu: 'Nincs elkezdve', es: 'Sin iniciar', vi: 'Chưa bắt đầu', mn: 'Эхлээгүй', uk: 'Не розпочато' },
  search: { en: 'Search modules and units…', hu: 'Modulok és egységek keresése…', es: 'Buscar módulos y unidades…', vi: 'Tìm mô-đun và đơn vị…', mn: 'Модуль, нэгж хайх…', uk: 'Пошук модулів і розділів…' },
  noMatch: { en: 'No units match.', hu: 'Nincs találat.', es: 'Sin resultados.', vi: 'Không có kết quả.', mn: 'Илэрц алга.', uk: 'Нічого не знайдено.' },
  steps: { en: 'steps', hu: 'lépés', es: 'pasos', vi: 'bước', mn: 'алхам', uk: 'кроків' },
  min: { en: 'min', hu: 'perc', es: 'min', vi: 'phút', mn: 'мин', uk: 'хв' },
  units: { en: 'units', hu: 'egység', es: 'unidades', vi: 'đơn vị', mn: 'нэгж', uk: 'розділів' },
  doneCount: { en: 'done', hu: 'kész', es: 'hechas', vi: 'xong', mn: 'дууссан', uk: 'виконано' },
  modules: { en: 'modules', hu: 'modul', es: 'módulos', vi: 'mô-đun', mn: 'модуль', uk: 'модулів' },
};

const MODULE_META: Record<TrainingModuleKey, { label: I18nText; icon: LucideIcon; order: number }> = {
  housekeeping: { label: { en: 'Housekeeping', hu: 'Housekeeping', es: 'Housekeeping', vi: 'Buồng phòng', mn: 'Өрөө үйлчилгээ', uk: 'Housekeeping' }, icon: BedDouble, order: 1 },
  hr_attendance: { label: { en: 'HR & Attendance', hu: 'HR és Jelenlét', es: 'HR y Asistencia', vi: 'HR & Chấm công', mn: 'HR ба Ирц', uk: 'HR і відвідуваність' }, icon: ClipboardList, order: 2 },
  reception: { label: { en: 'Reception', hu: 'Recepció', es: 'Recepción', vi: 'Lễ tân', mn: 'Ресепшн', uk: 'Рецепція' }, icon: ConciergeBell, order: 3 },
  maintenance: { label: { en: 'Maintenance', hu: 'Karbantartás', es: 'Mantenimiento', vi: 'Bảo trì', mn: 'Засвар', uk: 'Техобслуговування' }, icon: Wrench, order: 4 },
  revenue: { label: { en: 'Revenue Management', hu: 'Bevétel', es: 'Ingresos', vi: 'Doanh thu', mn: 'Орлого', uk: 'Управління доходами' }, icon: TrendingUp, order: 5 },
  invoices: { label: { en: 'Purchase Invoices', hu: 'Számlák', es: 'Facturas', vi: 'Hóa đơn', mn: 'Нэхэмжлэх', uk: 'Рахунки постачальників' }, icon: Receipt, order: 6 },
  admin: { label: { en: 'Getting started', hu: 'Első lépések', es: 'Primeros pasos', vi: 'Bắt đầu', mn: 'Эхлэх', uk: 'Перші кроки' }, icon: Shield, order: 7 },
};

export function TrainingCenter() {
  const {
    availableCurricula, statuses, start, markComplete, dismissCurriculum, refreshStatuses, lang,
  } = useTrainingV2();
  const [query, setQuery] = useState('');

  useEffect(() => { refreshStatuses(); }, [refreshStatuses]);

  const { featured, modules } = useMemo(() => {
    const featured: TrainingCurriculum[] = [];
    const bucketMap = new Map<TrainingModuleKey, TrainingCurriculum[]>();
    for (const c of availableCurricula) {
      if (c.isFullWalkthrough) { featured.push(c); continue; }
      const key = (c.moduleKey || 'admin') as TrainingModuleKey;
      if (!bucketMap.has(key)) bucketMap.set(key, []);
      bucketMap.get(key)!.push(c);
    }
    const modules = Array.from(bucketMap.entries())
      .map(([key, items]) => ({ key, meta: MODULE_META[key], items: items.sort((a, b) => a.priority - b.priority) }))
      .sort((a, b) => a.meta.order - b.meta.order);
    return { featured, modules };
  }, [availableCurricula]);

  const q = query.trim().toLowerCase();
  const matches = (c: TrainingCurriculum) => {
    if (!q) return true;
    return (
      txt(c.name, lang).toLowerCase().includes(q) ||
      txt(c.description, lang).toLowerCase().includes(q)
    );
  };

  const renderStatus = (c: TrainingCurriculum) => {
    const st = statuses[c.slug] || { slug: c.slug, status: 'available' as const, currentStep: 0, totalSteps: c.steps.length };
    return { st, isDone: st.status === 'done', isResume: st.status === 'in_progress' };
  };

  const renderUnit = (c: TrainingCurriculum) => {
    const { st, isDone, isResume } = renderStatus(c);
    const pct = st.totalSteps ? Math.round((st.currentStep / st.totalSteps) * 100) : 0;
    return (
      <Card key={c.slug} className="flex flex-col">
        <CardHeader className="space-y-1.5 pb-3">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm font-semibold leading-snug">{txt(c.name, lang)}</CardTitle>
            <Badge variant={isDone ? 'default' : isResume ? 'secondary' : 'outline'} className="shrink-0 text-[10px]">
              {isDone ? txt(TXT.done, lang) : isResume ? `${st.currentStep}/${st.totalSteps}` : txt(TXT.notStarted, lang)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{txt(c.description, lang)}</p>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-2 pt-0">
          <Progress value={pct} className="h-1.5" aria-label={`Progress ${pct}%`} />
          <div className="text-[11px] text-muted-foreground">
            {c.steps.length} {txt(TXT.steps, lang)}{c.estMinutes ? ` · ~${c.estMinutes} ${txt(TXT.min, lang)}` : ''}
          </div>
          <div className="mt-auto flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => start(c.slug, { manual: true })} className="min-h-9 h-9 text-xs">
              <Play className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              {isResume ? txt(TXT.resume, lang) : txt(TXT.start, lang)}
            </Button>
            {(isResume || isDone) && (
              <Button size="sm" variant="outline" onClick={() => start(c.slug, { restart: true, manual: true })} className="min-h-9 h-9 text-xs">
                <RefreshCw className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                {txt(TXT.restart, lang)}
              </Button>
            )}
            {!isDone && (
              <Button size="sm" variant="ghost" onClick={() => markComplete(c.slug)} className="min-h-9 h-9 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                {txt(TXT.markDone, lang)}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => dismissCurriculum(c.slug)} className="min-h-9 h-9 text-xs">
              <BellOff className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              {txt(TXT.dismiss, lang)}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  const visibleModules = modules
    .map((m) => ({ ...m, items: m.items.filter(matches) }))
    .filter((m) => m.items.length > 0);

  const totalVisible = visibleModules.reduce((n, m) => n + m.items.length, 0);

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <GraduationCap className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{txt(TXT.title, lang)}</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">{txt(TXT.subtitle, lang)}</p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={txt(TXT.search, lang)}
          className="pl-9 h-11"
          aria-label={txt(TXT.search, lang)}
        />
      </div>

      {!q && featured.map((c) => {
        const { st, isDone, isResume } = renderStatus(c);
        const eligibleUnits = (c.chain || []).filter((slug) => availableCurricula.some((unit) => unit.slug === slug));
        const doneUnits = eligibleUnits.filter((slug) => statuses[slug]?.status === 'done').length;
        const guidedProgress = eligibleUnits.length > 0 ? `${doneUnits}/${eligibleUnits.length}` : `${st.currentStep}/${st.totalSteps}`;
        return (
          <Card key={c.slug} className="border-primary/40 bg-primary/5">
            <CardHeader className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <CardTitle className="text-base sm:text-lg leading-tight">{txt(TXT.fullTitle, lang)}</CardTitle>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-1">{txt(TXT.fullBody, lang)}</p>
                  </div>
                </div>
                <Badge variant={isDone ? 'default' : isResume ? 'secondary' : 'outline'} className="shrink-0">
                  {isDone ? txt(TXT.done, lang) : eligibleUnits.length > 0 ? `${guidedProgress} ${txt(TXT.modules, lang)}` : isResume ? guidedProgress : txt(TXT.notStarted, lang)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button onClick={() => start(c.slug, { manual: true })} className="min-h-11">
                <Play className="h-4 w-4 mr-1.5" aria-hidden="true" />
                {isResume ? txt(TXT.resume, lang) : txt(TXT.start, lang)}
              </Button>
              {(isResume || isDone) && (
                <Button variant="outline" onClick={() => start(c.slug, { restart: true, manual: true })} className="min-h-11">
                  <RefreshCw className="h-4 w-4 mr-1.5" aria-hidden="true" />
                  {txt(TXT.restart, lang)}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}

      {totalVisible === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">{txt(TXT.noMatch, lang)}</p>
      ) : (
        <Accordion type="multiple" defaultValue={visibleModules.map((m) => m.key)} className="space-y-2">
          {visibleModules.map((mod) => {
            const Icon = mod.meta.icon;
            const doneCount = mod.items.filter((c) => statuses[c.slug]?.status === 'done').length;
            return (
              <AccordionItem key={mod.key} value={mod.key} className="border rounded-lg bg-card">
                <AccordionTrigger className="px-3 sm:px-4 py-3 hover:no-underline">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className="h-8 w-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="text-sm sm:text-base font-semibold truncate">{txt(mod.meta.label, lang)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {mod.items.length} {txt(TXT.units, lang)} · {doneCount} {txt(TXT.doneCount, lang)}
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-3 sm:px-4 pb-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {mod.items.map(renderUnit)}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
