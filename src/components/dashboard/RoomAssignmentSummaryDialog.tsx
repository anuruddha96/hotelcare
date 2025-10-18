import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RoomAssignmentSummary } from './RoomAssignmentSummary';
import { ClipboardList } from 'lucide-react';

export function RoomAssignmentSummaryDialog() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);

  // Only allow access for managers, admins, and top management
  const canAccess = profile?.role && ['admin', 'manager', 'housekeeping_manager', 'top_management'].includes(profile.role);

  if (!canAccess) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs sm:text-sm gap-1 sm:gap-2">
          <ClipboardList className="h-3 w-3 sm:h-4 sm:w-4" />
          <span className="hidden lg:inline">Assignment Summary</span>
          <span className="lg:hidden">Summary</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Room Assignment Summary</DialogTitle>
        </DialogHeader>
        <RoomAssignmentSummary />
      </DialogContent>
    </Dialog>
  );
}
