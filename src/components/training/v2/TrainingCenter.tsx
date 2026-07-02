import { useEffect, useMemo } from 'react';
import { useTrainingV2, txt } from './TrainingV2Provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Play, RefreshCw, CheckCircle2, BellOff, GraduationCap, Sparkles } from 'lucide-react';
import type { I18nText, TrainingCurriculum } from './types';

const TXT = {
  title: { en: 'Training Center', hu: 'Képzési központ', es: 'Centro de entrenamiento', vi: 'Trung tâm đào tạo', mn: 'Сургалтын төв' },
  subtitle: {
    en: 'Pick any module to learn at your own pace. We remember where you left off.',
    hu: 'Válassz bármely modult. Onnan folytatod, ahol abbahagytad.',
    es: 'Elige cualquier módulo. Recordamos dónde lo dejaste.',
    vi: 'Chọn bất kỳ mô-đun nào. Chúng tôi nhớ vị trí bạn dừng.',
    mn: 'Дурын модулиа сонго. Бид зогссон газрыг чинь санана.',
  },
  fullWalkthroughTitle: {
    en: 'Start the full guided tour',
    hu: 'Indítsd el a teljes bemutatót',
    es: 'Iniciar el recorrido completo',
    vi: 'Bắt đầu toàn bộ hướng dẫn',
    mn: 'Бүрэн танилцуулгыг эхлүүлэх',
  },
  fullWalkthroughBody: {
    en: 'One continuous flow through every manager module. Pause anytime.',
    hu: 'Egyetlen folyamatos bemutató minden vezetői modulon át.',
    es: 'Un flujo continuo por cada módulo del gerente.',
    vi: 'Một luồng liên tục qua mọi mô-đun quản lý.',
    mn: 'Менежерийн модуль бүрээр тасралтгүй үргэлжилнэ.',
  },
  start: { en: 'Start', hu: 'Indítás', es: 'Iniciar', vi: 'Bắt đầu', mn: 'Эхлэх' },
  resume: { en: 'Resume', hu: 'Folytatás', es: 'Continuar', vi: 'Tiếp tục', mn: 'Үргэлжлүүлэх' },
  restart: { en: 'Restart', hu: 'Újraindítás', es: 'Reiniciar', vi: 'Khởi động lại', mn: 'Дахин эхлэх' },
  markDone: { en: 'Mark complete', hu: 'Kész', es: 'Completar', vi: 'Hoàn tất', mn: 'Дуусгах' },
  dismiss: { en: 'Mute 30 days', hu: 'Némítás 30 napra', es: 'Silenciar 30 días', vi: 'Tắt 30 ngày', mn: '30 хоног нуух' },
  done: { en: 'Completed', hu: 'Befejezve', es: 'Completado', vi: 'Hoàn thành', mn: 'Дууссан' },
  inProgress: { en: 'In progress', hu: 'Folyamatban', es: 'En progreso', vi: 'Đang làm', mn: 'Үргэлжилж байна' },
  notStarted: { en: 'Not started', hu: 'Nincs elkezdve', es: 'Sin iniciar', vi: 'Chưa bắt đầu', mn: 'Эхлээгүй' },
  otherModules: {
    en: 'Other modules',
    hu: 'Egyéb modulok',
    es: 'Otros módulos',
    vi: 'Mô-đun khác',
    mn: 'Бусад модуль',
  },
};

// Map curriculum slugs → module label. Falls back to `curriculum.module` if
// set on the curriculum itself, else "Other modules".
const MODULE_BY_SLUG: Record<string, I18nText> = {
  v2_manager_attendance_and_payroll: { en: 'HR & Attendance', hu: 'HR & Jelenlét', es: 'HR y Asistencia', vi: 'HR & Chấm công', mn: 'HR & Ирц' },
  v2_manager_reception_handover: { en: 'Reception', hu: 'Recepció', es: 'Recepción', vi: 'Lễ tân', mn: 'Ресепшн' },
  v2_manager_team_and_assignments: { en: 'Team & Assignments', hu: 'Csapat', es: 'Equipo', vi: 'Nhóm', mn: 'Баг' },
  v2_manager_tickets_and_sla: { en: 'Tickets & Maintenance', hu: 'Hibajegyek', es: 'Tickets', vi: 'Phiếu', mn: 'Тасалбар' },
  v2_manager_revenue: { en: 'Revenue', hu: 'Bevétel', es: 'Ingresos', vi: 'Doanh thu', mn: 'Орлого' },
  v2_manager_purchase_invoices: { en: 'Invoices', hu: 'Számlák', es: 'Facturas', vi: 'Hóa đơn', mn: 'Нэхэмжлэх' },
  v2_manager_orientation: { en: 'Getting started', hu: 'Első lépések', es: 'Primeros pasos', vi: 'Bắt đầu', mn: 'Эхлэх' },
  v2_housekeeper_first_day: { en: 'Housekeeping', hu: 'Szobaasszony', es: 'Camarera', vi: 'Buồng phòng', mn: 'Өрөө үйлчлэгч' },
};

function moduleLabel(c: TrainingCurriculum): I18nText {
  return MODULE_BY_SLUG[c.slug] || c.module || TXT.otherModules;
}

export function TrainingCenter() {
  const {
    availableCurricula,
    statuses,
    start,
    markComplete,
    dismissCurriculum,
    refreshStatuses,
    lang,
  } = useTrainingV2();

  useEffect(() => {
    refreshStatuses();
  }, [refreshStatuses]);

  // Split full walkthrough (featured) from module curricula.
  const { fullWalkthroughs, modules } = useMemo(() => {
    const full: TrainingCurriculum[] = [];
    // Group by module label (JSON stringified `en` as key).
    const buckets = new Map<string, { label: I18nText; items: TrainingCurriculum[] }>();
    for (const c of availableCurricula) {
      if (c.isFullWalkthrough) {
        full.push(c);
        continue;
      }
      const label = moduleLabel(c);
      const key = label.en;
      if (!buckets.has(key)) buckets.set(key, { label, items: [] });
      buckets.get(key)!.items.push(c);
    }
    return { fullWalkthroughs: full, modules: Array.from(buckets.values()) };
  }, [availableCurricula]);

  const renderStatus = (c: TrainingCurriculum) => {
    const st = statuses[c.slug] || { slug: c.slug, status: 'available' as const, currentStep: 0, totalSteps: c.steps.length };
    const isDone = st.status === 'done';
    const isResume = st.status === 'in_progress';
    return { st, isDone, isResume };
  };

  const renderCurriculumCard = (c: TrainingCurriculum) => {
    const { st, isDone, isResume } = renderStatus(c);
    const pct = st.totalSteps ? Math.round((st.currentStep / st.totalSteps) * 100) : 0;
    return (
      <Card key={c.slug} className="flex flex-col">
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-tight">{txt(c.name, lang)}</CardTitle>
            <Badge variant={isDone ? 'default' : isResume ? 'secondary' : 'outline'}>
              {isDone
                ? txt(TXT.done, lang)
                : isResume
                  ? `${txt(TXT.inProgress, lang)} ${st.currentStep}/${st.totalSteps}`
                  : txt(TXT.notStarted, lang)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground line-clamp-3">{txt(c.description, lang)}</p>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-3">
          <Progress value={pct} aria-label={`Progress ${pct}%`} />
          <div className="text-xs text-muted-foreground">
            {c.steps.length} steps · {c.category === 'feature_promo' ? 'Feature highlight' : 'Core training'}
          </div>
          <div className="mt-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => start(c.slug, { manual: true })}
              className="min-h-11"
              aria-label={`${isResume ? 'Resume' : 'Start'} ${txt(c.name, lang)}`}
            >
              <Play className="h-4 w-4 mr-1" aria-hidden="true" />
              {isResume ? txt(TXT.resume, lang) : txt(TXT.start, lang)}
            </Button>
            {(isResume || isDone) && (
              <Button size="sm" variant="outline" onClick={() => start(c.slug, { restart: true, manual: true })} className="min-h-11">
                <RefreshCw className="h-4 w-4 mr-1" aria-hidden="true" />
                {txt(TXT.restart, lang)}
              </Button>
            )}
            {!isDone && (
              <Button size="sm" variant="ghost" onClick={() => markComplete(c.slug)} className="min-h-11">
                <CheckCircle2 className="h-4 w-4 mr-1" aria-hidden="true" />
                {txt(TXT.markDone, lang)}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => dismissCurriculum(c.slug)} className="min-h-11">
              <BellOff className="h-4 w-4 mr-1" aria-hidden="true" />
              {txt(TXT.dismiss, lang)}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-start gap-3">
        <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <GraduationCap className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{txt(TXT.title, lang)}</h1>
          <p className="text-sm text-muted-foreground mt-1">{txt(TXT.subtitle, lang)}</p>
        </div>
      </div>

      {/* Featured: full walkthrough */}
      {fullWalkthroughs.map((c) => {
        const { st, isDone, isResume } = renderStatus(c);
        return (
          <Card key={c.slug} className="border-primary/40 bg-primary/5">
            <CardHeader className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <Sparkles className="h-5 w-5 text-primary mt-0.5" aria-hidden="true" />
                  <div>
                    <CardTitle className="text-lg leading-tight">{txt(TXT.fullWalkthroughTitle, lang)}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">{txt(TXT.fullWalkthroughBody, lang)}</p>
                  </div>
                </div>
                <Badge variant={isDone ? 'default' : isResume ? 'secondary' : 'outline'}>
                  {isDone ? txt(TXT.done, lang) : isResume ? `${st.currentStep}/${st.totalSteps}` : txt(TXT.notStarted, lang)}
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

      {/* Modules grouped in accordion */}
      <Accordion type="multiple" defaultValue={modules.map((m) => m.label.en)} className="space-y-3">
        {modules.map((mod) => (
          <AccordionItem key={mod.label.en} value={mod.label.en} className="border rounded-lg bg-card">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <span className="text-base font-semibold">{txt(mod.label, lang)}</span>
              <span className="text-xs text-muted-foreground font-normal ml-2">{mod.items.length}</span>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {mod.items.map(renderCurriculumCard)}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
