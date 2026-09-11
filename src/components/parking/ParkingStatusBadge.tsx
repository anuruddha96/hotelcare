import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ParkingDisplayStatus } from '@/lib/parking';

const labels: Record<ParkingDisplayStatus, string> = {
  available: 'Available',
  issued: 'Active',
  expired: 'Expired',
  void: 'Voided',
};

const styles: Record<ParkingDisplayStatus, string> = {
  available: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  issued: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
  expired: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  void: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
};

export function ParkingStatusBadge({ status, className }: { status: ParkingDisplayStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn('font-medium', styles[status], className)}>
      {labels[status]}
    </Badge>
  );
}
