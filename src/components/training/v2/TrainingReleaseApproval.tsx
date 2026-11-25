import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { findCurriculum } from './curricula';
import { words } from './curricula/visualTopics';
import { trainingReleases } from './trainingReleases';
import type { LangCode } from './types';

const UI = {
  title: words('Training releases', 'Új útmutatók', 'Nuevas guías', 'Hướng dẫn mới', 'Шинэ заавар', 'Нові посібники'),
  approve: words('Approve for staff', 'Jóváhagyás a munkatársaknak', 'Aprobar para el personal', 'Duyệt cho nhân viên', 'Ажилтнуудад зөвшөөрөх', 'Схвалити для персоналу'),
  approved: words('Approved', 'Jóváhagyva', 'Aprobada', 'Đã duyệt', 'Зөвшөөрсөн', 'Схвалено'),
  error: words('Approval could not be saved', 'A jóváhagyás mentése sikertelen', 'No se pudo guardar la aprobación', 'Không thể lưu phê duyệt', 'Зөвшөөрлийг хадгалж чадсангүй', 'Не вдалося зберегти схвалення'),
  empty: words('No releases awaiting review', 'Nincs ellenőrzésre váró útmutató', 'No hay guías pendientes', 'Không có hướng dẫn chờ duyệt', 'Хянах заавар алга', 'Немає посібників на перевірці'),
};

export function TrainingReleaseApproval() {
  const { profile } = useAuth();
  const { language } = useTranslation();
  const lang = language as LangCode;
  const org = profile?.organization_slug;
  const [approvals, setApprovals] = useState<{ org: string; ids: string[] }>();
  const [busy, setBusy] = useState(false);
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    if (!isAdmin || !org || !trainingReleases.length) return;
    let current = true;
    void (supabase as any).from('training_release_approvals').select('release_id').eq('organization_slug', org)
      .then(({ data, error }: { data: { release_id: string }[] | null; error: unknown }) => {
        if (current && !error) setApprovals({ org, ids: (data ?? []).map((row: { release_id: string }) => row.release_id) });
      });
    return () => { current = false; };
  }, [isAdmin, org]);

  if (!isAdmin || !org) return null;
  const approve = async (releaseId: string) => {
    setBusy(true);
    const { error } = await (supabase as any).from('training_release_approvals')
      .upsert({ organization_slug: org, release_id: releaseId }, { onConflict: 'organization_slug,release_id', ignoreDuplicates: true });
    if (error) toast.error(UI.error[lang] || UI.error.en);
    else setApprovals((current) => current?.org === org ? { org, ids: [...current.ids, releaseId] } : current);
    setBusy(false);
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{UI.title[lang] || UI.title.en}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {!trainingReleases.length && <p className="text-sm text-muted-foreground">{UI.empty[lang] || UI.empty.en}</p>}
        {trainingReleases.map((release) => {
          const guide = findCurriculum(release.curriculum);
          if (!guide) return null;
          const approved = approvals?.org === org && approvals.ids.includes(release.id);
          return <div key={release.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{guide.name[lang] || guide.name.en}</span>
            <Button size="sm" disabled={busy || approvals?.org !== org || approved} onClick={() => void approve(release.id)}>
              {approved ? UI.approved[lang] || UI.approved.en : UI.approve[lang] || UI.approve.en}
            </Button>
          </div>;
        })}
      </CardContent>
    </Card>
  );
}
