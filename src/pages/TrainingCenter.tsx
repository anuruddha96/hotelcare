import { Header } from '@/components/layout/Header';
import { TrainingCenter as TrainingCenterView } from '@/components/training/v2/TrainingCenter';

export default function TrainingCenterPage() {
  return (
    <div className="min-h-dvh bg-background">
      <Header />
      <main>
        <TrainingCenterView />
      </main>
    </div>
  );
}
