import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ArrowRight, CheckCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface RoomAssignmentChangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
  roomNumber: string;
  currentAssignmentType: string;
  onAssignmentChanged?: () => void;
}

export function RoomAssignmentChangeDialog({
  open,
  onOpenChange,
  roomId,
  roomNumber,
  currentAssignmentType,
  onAssignmentChanged
}: RoomAssignmentChangeDialogProps) {
  const { user, profile } = useAuth();
  const [isChanging, setIsChanging] = useState(false);

  const isAuthorized = profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'housekeeping_manager';

  const handleAssignmentChange = async () => {
    if (!user?.id || !isAuthorized) return;

    setIsChanging(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Update the assignment from daily_cleaning to checkout_cleaning
      const { error: updateError } = await supabase
        .from('room_assignments')
        .update({ 
          assignment_type: 'checkout_cleaning',
          notes: `Assignment changed from daily cleaning to checkout cleaning by ${profile?.full_name || 'Manager'} at ${new Date().toLocaleString()}`
        })
        .eq('room_id', roomId)
        .eq('assignment_date', today)
        .eq('assignment_type', 'daily_cleaning')
        .eq('status', 'assigned');

      if (updateError) throw updateError;

      // Mark the room as checkout room
      const { error: roomError } = await supabase
        .from('rooms')
        .update({ 
          is_checkout_room: true,
          checkout_time: new Date().toISOString()
        })
        .eq('id', roomId);

      if (roomError) throw roomError;

      toast.success(`Room ${roomNumber} assignment changed from daily cleaning to checkout cleaning`);
      onAssignmentChanged?.();
      onOpenChange(false);
      
    } catch (error) {
      console.error('Error changing assignment:', error);
      toast.error('Failed to change room assignment');
    } finally {
      setIsChanging(false);
    }
  };

  if (!isAuthorized) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Change Room Assignment
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <h3 className="font-medium text-orange-800 mb-2">Room {roomNumber}</h3>
            <p className="text-sm text-orange-700">
              This will change the room assignment and notify the housekeeper about the change.
            </p>
          </div>

          <div className="flex items-center justify-center gap-4 py-4">
            <div className="text-center">
              <Badge variant="outline" className="mb-2">Current</Badge>
              <p className="text-sm font-medium">Daily Cleaning</p>
            </div>
            
            <ArrowRight className="h-5 w-5 text-gray-400" />
            
            <div className="text-center">
              <Badge className="mb-2 bg-blue-600">New</Badge>
              <p className="text-sm font-medium">Checkout Cleaning</p>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-blue-600 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-1">What happens next:</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Assignment type changes to checkout cleaning</li>
                  <li>Housekeeper gets notified about the change</li>
                  <li>Room is marked as checkout room</li>
                  <li>Change is logged with your name and timestamp</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
              disabled={isChanging}
            >
              Cancel
            </Button>
            
            <Button
              onClick={handleAssignmentChange}
              className="flex-1"
              disabled={isChanging}
            >
              {isChanging ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Changing...
                </div>
              ) : (
                'Change Assignment'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}