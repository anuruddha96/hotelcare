import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarClock, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import {
  getHousekeepingAutomationLanguage,
  housekeepingAutomationText,
  type HousekeepingAutomationLanguage,
} from '@/lib/housekeepingAutomationTranslations';
import {
  DEFAULT_NEXT_DAY_RELEASE_TIME,
  NEXT_DAY_RELEASE_TIME_OPTIONS,
  normalizeNextDayReleaseTime,
  type NextDayReleaseTime,
} from '@/lib/nextDayReleaseTime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AutoRoomAssignment } from './AutoRoomAssignment';

type PlanStatus = 'draft' | 'approved' | 'releasing' | 'released' | 'cancelled' | 'failed';

type PlanRow = {
  id: string;
  plan_date: string;
  status: PlanStatus;
  auto_release: boolean;
  release_time: string;
  release_timezone: string;
  scheduled_release_at: string | null;
  release_attempted_at: string | null;
  release_revalidation_attempted_at: string | null;
};

interface NextDayHousekeepingPlanCardProps {
  hotelName: string;
  selectedDate: string;
}

type ScheduleCopy = {
  approvedAuto: string;
  draft: string;
  releasing: string;
  released: string;
  failed: string;
  release: string;
  editableHint: string;
  lockedHint: string;
  updated: string;
  updateFailed: string;
  futureOnly: string;
  ready: string;
  readyToday: string;
  prepare: string;
};

const COPY: Record<HousekeepingAutomationLanguage, ScheduleCopy> = {
  en: {
    approvedAuto: 'Approved · automatic release',
    draft: 'Draft plan',
    releasing: 'Release in progress',
    released: 'Released',
    failed: 'Release needs attention',
    release: 'Release',
    editableHint: 'You can change the automatic release time until execution starts.',
    lockedHint: 'The release time is locked because execution has started.',
    updated: 'Automatic release time updated.',
    updateFailed: 'Could not update the release time.',
    futureOnly: 'Choose a release time that is still in the future.',
    ready: 'Ready. Hotel Care will refresh Previo again and release safe assignments automatically.',
    readyToday: 'This prepared plan has not executed yet. You can still change its release time.',
    prepare: 'Prepare tomorrow’s plan',
  },
  hu: {
    approvedAuto: 'Jóváhagyva · automatikus kiosztás',
    draft: 'Piszkozat',
    releasing: 'Kiosztás folyamatban',
    released: 'Kiosztva',
    failed: 'A kiosztás ellenőrzést igényel',
    release: 'Kiosztás',
    editableHint: 'Az automatikus kiosztás ideje a végrehajtás kezdetéig módosítható.',
    lockedHint: 'A kiosztás már elkezdődött, ezért az időpont nem módosítható.',
    updated: 'Az automatikus kiosztás időpontja frissítve.',
    updateFailed: 'A kiosztási időpont frissítése nem sikerült.',
    futureOnly: 'Olyan kiosztási időpontot válassz, amely még nem múlt el.',
    ready: 'Kész. A Hotel Care ismét frissíti a Previo adatait, majd automatikusan kiadja a biztonságos beosztást.',
    readyToday: 'Az előkészített terv még nem futott le. A kiosztási időpont még módosítható.',
    prepare: 'Holnapi terv előkészítése',
  },
  es: {
    approvedAuto: 'Aprobado · publicación automática',
    draft: 'Borrador',
    releasing: 'Publicación en curso',
    released: 'Publicado',
    failed: 'La publicación requiere atención',
    release: 'Publicación',
    editableHint: 'Puedes cambiar la hora automática hasta que comience la ejecución.',
    lockedHint: 'La hora está bloqueada porque la ejecución ya ha comenzado.',
    updated: 'Hora de publicación automática actualizada.',
    updateFailed: 'No se pudo actualizar la hora de publicación.',
    futureOnly: 'Elige una hora de publicación que aún esté en el futuro.',
    ready: 'Listo. Hotel Care volverá a actualizar Previo y publicará las asignaciones seguras automáticamente.',
    readyToday: 'Este plan preparado aún no se ha ejecutado. Todavía puedes cambiar la hora.',
    prepare: 'Preparar el plan de mañana',
  },
  vi: {
    approvedAuto: 'Đã duyệt · tự động phát hành',
    draft: 'Bản nháp',
    releasing: 'Đang phát hành',
    released: 'Đã phát hành',
    failed: 'Cần kiểm tra việc phát hành',
    release: 'Phát hành',
    editableHint: 'Có thể đổi giờ tự động cho đến khi việc thực thi bắt đầu.',
    lockedHint: 'Không thể đổi giờ vì việc thực thi đã bắt đầu.',
    updated: 'Đã cập nhật giờ phát hành tự động.',
    updateFailed: 'Không thể cập nhật giờ phát hành.',
    futureOnly: 'Hãy chọn một giờ phát hành vẫn còn ở phía trước.',
    ready: 'Sẵn sàng. Hotel Care sẽ làm mới Previo và tự động phát hành phân công an toàn.',
    readyToday: 'Kế hoạch đã chuẩn bị vẫn chưa chạy. Bạn vẫn có thể đổi giờ phát hành.',
    prepare: 'Chuẩn bị kế hoạch ngày mai',
  },
  mn: {
    approvedAuto: 'Батлагдсан · автоматаар гаргана',
    draft: 'Ноорог',
    releasing: 'Гаргаж байна',
    released: 'Гаргасан',
    failed: 'Гаргалтыг шалгах шаардлагатай',
    release: 'Гаргах',
    editableHint: 'Автомат гаргах цагийг ажиллагаа эхлэх хүртэл өөрчилж болно.',
    lockedHint: 'Ажиллагаа эхэлсэн тул цаг түгжигдсэн.',
    updated: 'Автомат гаргах цаг шинэчлэгдлээ.',
    updateFailed: 'Гаргах цагийг шинэчилж чадсангүй.',
    futureOnly: 'Одоогоос хойших гаргах цаг сонгоно уу.',
    ready: 'Бэлэн. Hotel Care Previo-г дахин шинэчлээд аюулгүй хуваарийг автоматаар гаргана.',
    readyToday: 'Бэлтгэсэн төлөвлөгөө хараахан ажиллаагүй. Гаргах цагийг өөрчилж болно.',
    prepare: 'Маргаашийн төлөвлөгөөг бэлтгэх',
  },
  ru: {
    approvedAuto: 'Утверждено · автоматическая выдача',
    draft: 'Черновик',
    releasing: 'Выдача выполняется',
    released: 'Выдано',
    failed: 'Выдача требует проверки',
    release: 'Выдача',
    editableHint: 'Время автоматической выдачи можно изменить до начала выполнения.',
    lockedHint: 'Время заблокировано, потому что выполнение уже началось.',
    updated: 'Время автоматической выдачи обновлено.',
    updateFailed: 'Не удалось обновить время выдачи.',
    futureOnly: 'Выберите время выдачи, которое еще не наступило.',
    ready: 'Готово. Hotel Care снова обновит Previo и автоматически выдаст безопасные назначения.',
    readyToday: 'Подготовленный план еще не выполнен. Время выдачи все еще можно изменить.',
    prepare: 'Подготовить план на завтра',
  },
  uk: {
    approvedAuto: 'Затверджено · автоматична видача',
    draft: 'Чернетка',
    releasing: 'Видача виконується',
    released: 'Видано',
    failed: 'Видача потребує перевірки',
    release: 'Видача',
    editableHint: 'Час автоматичної видачі можна змінити до початку виконання.',
    lockedHint: 'Час заблоковано, оскільки виконання вже почалося.',
    updated: 'Час автоматичної видачі оновлено.',
    updateFailed: 'Не вдалося оновити час видачі.',
    futureOnly: 'Оберіть час видачі, який ще не настав.',
    ready: 'Готово. Hotel Care ще раз оновить Previo й автоматично видасть безпечні призначення.',
    readyToday: 'Підготовлений план ще не виконано. Час видачі все ще можна змінити.',
    prepare: 'Підготувати план на завтра',
  },
};

const MANAGER_ROLES = new Set([
  'admin',
  'top_management',
  'top_management_manager',
  'manager',
  'housekeeping_manager',
  'supervisor',
  'reception_manager',
]);

function addCalendarDay(date: string, days = 1) {
  const [year, month, day] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return utc.toISOString().slice(0, 10);
}

function pickRelevantPlan(rows: PlanRow[], today: string, tomorrow: string): PlanRow | null {
  const todayPending = rows.find((row) =>
    row.plan_date === today && ['draft', 'approved', 'releasing'].includes(row.status),
  );
  if (todayPending) return todayPending;
  return rows.find((row) => row.plan_date === tomorrow) || null;
}

function statusText(plan: PlanRow, copy: ScheduleCopy) {
  if (plan.status === 'approved' && plan.auto_release) return copy.approvedAuto;
  if (plan.status === 'draft') return copy.draft;
  if (plan.status === 'releasing') return copy.releasing;
  if (plan.status === 'released') return copy.released;
  if (plan.status === 'failed') return copy.failed;
  return plan.status;
}

export function NextDayHousekeepingPlanCard({ hotelName, selectedDate }: NextDayHousekeepingPlanCardProps) {
  const { profile } = useAuth();
  const language = getHousekeepingAutomationLanguage();
  const copy = COPY[language];
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingTime, setUpdatingTime] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);

  const tomorrow = useMemo(() => addCalendarDay(selectedDate, 1), [selectedDate]);
  const canManage = !!profile && (profile.is_super_admin === true || MANAGER_ROLES.has(profile.role));

  const loadPlan = useCallback(async () => {
    if (!canManage || !profile?.organization_slug || !hotelName) {
      setPlan(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const keys = await resolveHotelKeys(hotelName);
      const hotelKeys = keys.length ? keys : [hotelName];
      const { data, error } = await (supabase as any)
        .from('next_day_housekeeping_plans')
        .select('id,plan_date,status,auto_release,release_time,release_timezone,scheduled_release_at,release_attempted_at,release_revalidation_attempted_at')
        .eq('organization_slug', profile.organization_slug)
        .in('hotel_id', hotelKeys)
        .in('plan_date', [selectedDate, tomorrow]);
      if (error) throw error;
      setPlan(pickRelevantPlan((data || []) as PlanRow[], selectedDate, tomorrow));
    } catch (error) {
      console.error('Could not load prepared housekeeping plan card', error);
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }, [canManage, hotelName, profile?.organization_slug, selectedDate, tomorrow]);

  useEffect(() => {
    void loadPlan();
    const refresh = () => void loadPlan();
    window.addEventListener('hk-next-day-plan-changed', refresh);
    return () => window.removeEventListener('hk-next-day-plan-changed', refresh);
  }, [loadPlan]);

  if (!canManage) return null;

  const releaseTime = normalizeNextDayReleaseTime(plan?.release_time || DEFAULT_NEXT_DAY_RELEASE_TIME);
  const scheduleEditable = !!plan
    && plan.auto_release
    && ['draft', 'approved'].includes(plan.status)
    && !plan.release_attempted_at
    && !plan.release_revalidation_attempted_at;
  const canOpenTomorrowPlanner = !plan || plan.plan_date === tomorrow;

  const changeReleaseTime = async (nextValue: string) => {
    if (!plan || !scheduleEditable || nextValue === releaseTime) return;
    const nextTime = nextValue as NextDayReleaseTime;
    setUpdatingTime(true);
    try {
      const { error } = await (supabase as any).rpc('set_next_day_housekeeping_release_time', {
        p_plan_id: plan.id,
        p_release_time: `${nextTime}:00`,
      });
      if (error) throw error;
      await loadPlan();
      window.dispatchEvent(new CustomEvent('hk-next-day-plan-changed'));
      toast.success(copy.updated);
    } catch (error: any) {
      console.error('Failed to update next-day release time', error);
      const message = String(error?.message || '');
      toast.error(message.toLowerCase().includes('future') ? copy.futureOnly : copy.updateFailed);
      await loadPlan();
    } finally {
      setUpdatingTime(false);
    }
  };

  return (
    <>
      <section className="mb-5 rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-500">
            <CalendarClock className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold leading-tight text-foreground">
              {housekeepingAutomationText('title', language)}
            </h3>

            {loading ? (
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {housekeepingAutomationText('arrangingRooms', language)}
              </div>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {plan ? (
                    <Badge className="border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                      {statusText(plan, copy)}
                    </Badge>
                  ) : (
                    <Badge variant="outline">{copy.draft}</Badge>
                  )}

                  <div className="flex items-center gap-1.5 rounded-lg border bg-white px-2 py-1">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-semibold">{copy.release}:</span>
                    {plan ? (
                      <Select value={releaseTime} onValueChange={changeReleaseTime} disabled={!scheduleEditable || updatingTime}>
                        <SelectTrigger className="h-7 w-[92px] border-0 bg-transparent px-1 py-0 font-bold shadow-none focus:ring-0" aria-label={`${copy.release} time`}>
                          {updatingTime ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SelectValue />}
                        </SelectTrigger>
                        <SelectContent>
                          {NEXT_DAY_RELEASE_TIME_OPTIONS.map((time) => (
                            <SelectItem key={time} value={time}>{time}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="px-1 text-sm font-bold">{DEFAULT_NEXT_DAY_RELEASE_TIME}</span>
                    )}
                  </div>

                  <Badge variant="secondary" className="font-semibold">
                    {plan?.plan_date || tomorrow}
                  </Badge>
                </div>

                <p className="mt-3 text-sm font-medium text-slate-600">
                  {plan
                    ? (plan.plan_date === selectedDate ? copy.readyToday : copy.ready)
                    : housekeepingAutomationText('subtitle', language)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {plan && !scheduleEditable && ['releasing', 'released'].includes(plan.status)
                    ? copy.lockedHint
                    : copy.editableHint}
                </p>

                {canOpenTomorrowPlanner && (
                  <Button
                    type="button"
                    className="mt-4 h-11 w-full bg-sky-500 text-white hover:bg-sky-600"
                    onClick={() => setPlannerOpen(true)}
                  >
                    {plan ? housekeepingAutomationText('review', language) : copy.prepare}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {canOpenTomorrowPlanner && (
        <AutoRoomAssignment
          open={plannerOpen}
          onOpenChange={setPlannerOpen}
          selectedDate={tomorrow}
          onAssignmentCreated={() => {
            void loadPlan();
            window.dispatchEvent(new CustomEvent('hk-next-day-plan-changed'));
          }}
        />
      )}
    </>
  );
}
