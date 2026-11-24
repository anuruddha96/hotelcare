import { HrTrainingAssignment } from '@/components/hr/HrTrainingAssignment';
import { OperationsNavigation } from '@/components/layout/OperationsNavigation';
import { useAccessPolicy } from '@/hooks/useAccessPolicy';
import { Header } from '@/components/layout/Header';
import { TrainingCenter as TrainingCenterView } from '@/components/training/v2/TrainingCenter';

export default function TrainingCenterPage() {
  const { hrWorkspace } = useAccessPolicy();
  return (
    <div className="min-h-dvh bg-background">
      <Header />
      {hrWorkspace && <div className="px-4 pt-4"><OperationsNavigation current="training" /></div>}
      <main>
        <TrainingCenterView />
        {hrWorkspace && <HrTrainingAssignment />}
      </main>
    </div>
  );
}
