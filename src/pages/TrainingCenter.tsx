import { useState } from 'react';
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
        {hrWorkspace ? <section className="mx-auto max-w-7xl space-y-5 px-4 py-6">
          <h1 className="text-2xl font-semibold">{language === 'hu' ? 'Képzések kezelése' : 'Training management'}</h1>
          <div className="flex flex-wrap gap-2">{(['overview','assign','personal'] as const).map((key,i) => <Button key={key} variant={tab===key?'default':'outline'} onClick={()=>setTab(key)}>{(language==='hu'?['Áttekintés','Képzés újraindítása','Saját képzéseim']:['Overview','Restart training','My training'])[i]}</Button>)}</div>
          {tab === 'overview' && <HrTrainingAnalytics />}
          {tab === 'assign' && <><p className="text-sm text-muted-foreground">{language === 'hu' ? 'Az újraindítás törli a kiválasztott útmutató korábbi haladását.' : 'Restarting deletes the selected guide’s previous progress. Use only when deliberately repeating training.'}</p><HrTrainingAssignment /></>}
          {tab === 'personal' && <TrainingCenterView />}
        </section> : <TrainingCenterView />}
      </main>
    </div>
  );
}
