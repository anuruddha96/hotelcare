import { useEffect } from 'react';
import { useTrainingV2, txt } from './TrainingV2Provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Play, RefreshCw, CheckCircle2, BellOff, GraduationCap } from 'lucide-react';

const TXT = {
  title: { en: 'Training Center', hu: 'Képzési központ', es: 'Centro de entrenamiento', vi: 'Trung tâm đào tạo', mn: 'Сургалтын төв' },
  subtitle: {
    en: 'Pick any guide to learn at your own pace. We remember where you left off.',
    hu: 'Válassz bármelyik útmutatót. Onnan folytatod, ahol abbahagytad.',
    es: 'Elige cualquier guía. Recordamos dónde lo dejaste.',
    vi: 'Chọn bất kỳ hướng dẫn nào. Chúng tôi nhớ vị trí bạn dừng.',
    mn: 'Дурын зааварыг сонгоорой. Бид зогссон газрыг чинь санана.',
  },
  start: { en: 'Start', hu: 'Indítás', es: 'Iniciar', vi: 'Bắt đầu', mn: 'Эхлэх' },
  resume: { en: 'Resume', hu: 'Folytatás', es: 'Continuar', vi: 'Tiếp tục', mn: 'Үргэлжлүүлэх' },
  restart: { en: 'Restart', hu: 'Újraindítás', es: 'Reiniciar', vi: 'Khởi động lại', mn: 'Дахин эхлэх' },
  markDone: { en: 'Mark complete', hu: 'Kész', es: 'Completar', vi: 'Hoàn tất', mn: 'Дуусгах' },
  dismiss: { en: 'Mute 30 days', hu: 'Némítás 30 napra', es: 'Silenciar 30 días', vi: 'Tắt 30 ngày', mn: '30 хоног нуух' },
  done: { en: 'Completed', hu: 'Befejezve', es: 'Completado', vi: 'Hoàn thành', mn: 'Дууссан' },
  inProgress: { en: 'In progress', hu: 'Folyamatban', es: 'En progreso', vi: 'Đang làm', mn: 'Үргэлжилж байна' },
  notStarted: { en: 'Not started', hu: 'Nincs elkezdve', es: 'Sin iniciar', vi: 'Chưa bắt đầu', mn: 'Эхлээгүй' },
};

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

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-start gap-3">
        <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <GraduationCap className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{txt(TXT.title, lang)}</h1>
          <p className="text-sm text-muted-foreground mt-1">{txt(TXT.subtitle, lang)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {availableCurricula.map((c) => {
          const st = statuses[c.slug] || {
            slug: c.slug,
            status: 'available' as const,
            currentStep: 0,
            totalSteps: c.steps.length,
          };
          const pct = st.totalSteps ? Math.round((st.currentStep / st.totalSteps) * 100) : 0;
          const isDone = st.status === 'done';
          const isResume = st.status === 'in_progress';
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
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => start(c.slug, { restart: true, manual: true })}
                      className="min-h-11"
                    >
                      <RefreshCw className="h-4 w-4 mr-1" aria-hidden="true" />
                      {txt(TXT.restart, lang)}
                    </Button>
                  )}
                  {!isDone && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => markComplete(c.slug)}
                      className="min-h-11"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" aria-hidden="true" />
                      {txt(TXT.markDone, lang)}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => dismissCurriculum(c.slug)}
                    className="min-h-11"
                  >
                    <BellOff className="h-4 w-4 mr-1" aria-hidden="true" />
                    {txt(TXT.dismiss, lang)}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
