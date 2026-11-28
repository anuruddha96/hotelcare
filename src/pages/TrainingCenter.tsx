import { useState } from 'react';
import { BarChart3, History, GraduationCap } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { HrTrainingAnalytics } from '@/components/hr/HrTrainingAnalytics';
import { Button } from '@/components/ui/button';
import { HrTrainingAssignment } from '@/components/hr/HrTrainingAssignment';
import { OperationsNavigation } from '@/components/layout/OperationsNavigation';
import { useAccessPolicy } from '@/hooks/useAccessPolicy';
import { Header } from '@/components/layout/Header';
import { TrainingCenter as TrainingCenterView } from '@/components/training/v2/TrainingCenter';

export default function TrainingCenterPage() {
  const { hrWorkspace } = useAccessPolicy();
  const { language } = useTranslation();
  const [tab, setTab] = useState<'overview'|'assign'|'personal'>('overview');
  return (
    <div className="min-h-dvh bg-background">
      <Header />
      {hrWorkspace && <div className="px-4 pt-4"><OperationsNavigation current="training" /></div>}
      <main>
        {hrWorkspace ? <section className="w-full min-w-0 space-y-5 px-4 py-6 sm:px-6">
          <h1 className="text-2xl font-semibold">{language === 'hu' ? 'Képzések kezelése' : 'Training management'}</h1>
          <div className="flex flex-wrap gap-1.5 rounded-xl border bg-muted/40 p-1.5" role="group" aria-label={language==='hu'?'Képzési nézet':'Training view'}>{(['overview','assign','personal'] as const).map((key,i) => {const Icon=[BarChart3,History,GraduationCap][i];return <Button key={key} size="sm" className="gap-2" variant={tab===key?'default':'ghost'} aria-pressed={tab===key} onClick={()=>setTab(key)}><Icon className="h-4 w-4" aria-hidden="true"/>{(language==='hu'?['Áttekintés','Korábbi útmutató újraindítása','Saját képzéseim']:['Overview','Legacy guide restart','My training'])[i]}</Button>;})}</div>
          {tab === 'overview' && <HrTrainingAnalytics />}
          {tab === 'assign' && <><p role="note" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">{language === 'hu' ? 'Az újraindítás törli a kiválasztott útmutató korábbi haladását.' : 'Restarting deletes the selected guide’s previous progress. Use only when deliberately repeating training.'}</p><HrTrainingAssignment /></>}
          {tab === 'personal' && <TrainingCenterView />}
        </section> : <TrainingCenterView />}
      </main>
    </div>
  );
}
