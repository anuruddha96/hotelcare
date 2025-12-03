import React, { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, ClipboardList, Send, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';

interface PendingRoom {
  id: string;
  room_number: string;
  hotel: string;
  status: string;
  assignment_type: string;
}

interface PendingRoomsSignoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingRooms: PendingRoom[];
  userId: string;
  attendanceId: string;
  organizationSlug: string;
  onApprovalRequested: () => void;
}

export function PendingRoomsSignoutDialog({
  open,
  onOpenChange,
  pendingRooms,
  userId,
  attendanceId,
  organizationSlug,
  onApprovalRequested,
}: PendingRoomsSignoutDialogProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showReasonForm, setShowReasonForm] = useState(false);

  const handleRequestApproval = async () => {
    if (!reason.trim()) {
      toast({
        title: 'Reason required',
        description: 'Please provide a reason for early sign-out with pending rooms.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Create early signout request with pending rooms info and reason
      const pendingRoomsInfo = pendingRooms.map(r => ({
        room_number: r.room_number,
        hotel: r.hotel,
        status: r.status,
        assignment_type: r.assignment_type
      }));

      const { error } = await supabase.from('early_signout_requests').insert({
        user_id: userId,
        attendance_id: attendanceId,
        organization_slug: organizationSlug,
        status: 'pending',
        request_reason: reason.trim(),
        pending_rooms_info: pendingRoomsInfo,
      });

      if (error) throw error;

      // Also add a note about pending rooms in housekeeping_notes or a comment
      // This helps managers understand why approval is needed
      const pendingRoomsList = pendingRooms.map(r => `${r.room_number} (${r.hotel})`).join(', ');
      
      toast({
        title: 'Approval Request Sent',
        description: `Your supervisor will review your request. Pending rooms: ${pendingRoomsList}`,
      });

      onApprovalRequested();
      onOpenChange(false);
    } catch (error) {
      console.error('Error requesting approval:', error);
      toast({
        title: 'Error',
        description: 'Failed to submit approval request. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'assigned':
        return 'Pending';
      case 'in_progress':
        return 'In Progress';
      default:
        return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'assigned':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            Cannot Sign Out Yet
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p className="text-sm">
              You have <strong>{pendingRooms.length}</strong> room{pendingRooms.length > 1 ? 's' : ''} that still need{pendingRooms.length === 1 ? 's' : ''} to be completed:
            </p>
            
            <div className="max-h-40 overflow-y-auto space-y-2 p-2 bg-muted/50 rounded-lg">
              {pendingRooms.map((room) => (
                <div
                  key={room.id}
                  className="flex items-center justify-between p-2 bg-background rounded border"
                >
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{room.room_number}</span>
                    <span className="text-xs text-muted-foreground">({room.hotel})</span>
                  </div>
                  <Badge variant="outline" className={`text-xs ${getStatusColor(room.status)}`}>
                    {getStatusLabel(room.status)}
                  </Badge>
                </div>
              ))}
            </div>

            {!showReasonForm ? (
              <p className="text-sm text-muted-foreground">
                Please complete your assigned rooms before signing out, or request supervisor approval if you need to leave early.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium">Why do you need to sign out early?</p>
                <Textarea
                  placeholder="Please provide a reason for early sign-out..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="text-sm"
                />
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <AlertDialogCancel className="mt-0">
            Go Back to Work
          </AlertDialogCancel>
          
          {!showReasonForm ? (
            <Button
              variant="outline"
              className="border-amber-300 text-amber-700 hover:bg-amber-50"
              onClick={() => setShowReasonForm(true)}
            >
              <Send className="h-4 w-4 mr-2" />
              Request Supervisor Approval
            </Button>
          ) : (
            <Button
              onClick={handleRequestApproval}
              disabled={isSubmitting || !reason.trim()}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Request
                </>
              )}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
