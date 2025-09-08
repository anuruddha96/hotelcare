import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  User,
  MapPin,
  BedDouble,
  AlertTriangle
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';
import { useNotifications } from '@/hooks/useNotifications';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';

interface PendingAssignment {
  id: string;
  room_id: string;
  assignment_type: 'daily_cleaning' | 'checkout_cleaning' | 'maintenance' | 'deep_cleaning';
  status: string;
  priority: number;
  estimated_duration: number;
  notes: string;
  completed_at: string;
  supervisor_approved: boolean;
  assigned_to: string;
  assignment_date: string;
  rooms: {
    room_number: string;
    hotel: string;
    status: string;
    room_name: string | null;
    floor_number: number | null;
  } | null;
      profiles: {
        full_name: string;
        nickname: string;
      } | null;
}

export function SupervisorApprovalView() {
  const { t } = useTranslation();
  const { showNotification } = useNotifications();
  const [pendingAssignments, setPendingAssignments] = useState<PendingAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [approvalNote, setApprovalNote] = useState('');
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    fetchPendingAssignments();
    
    // Set up real-time subscription
    const channel = supabase
      .channel('supervisor-assignments')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_assignments',
          filter: 'status=eq.completed'
        },
        (payload) => {
          fetchPendingAssignments();
          if (payload.eventType === 'INSERT' || (payload.eventType === 'UPDATE' && payload.new.status === 'completed' && payload.old.status !== 'completed')) {
            showNotification(t('notifications.newCompletion'), 'info');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedDate, showNotification, t]);

  const fetchPendingAssignments = async () => {
    setLoading(true);
    try {
      const dateStr = selectedDate.toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('room_assignments')
        .select(`
          *,
          rooms!inner (
            room_number,
            hotel,
            status,
            room_name,
            floor_number
          ),
          profiles!room_assignments_assigned_to_fkey (
            full_name,
            nickname
          )
        `)
        .eq('status', 'completed')
        .eq('supervisor_approved', false)
        .eq('assignment_date', dateStr)
        .order('completed_at', { ascending: false });

      if (error) throw error;
      const assignments = (data as any) || [];
      setPendingAssignments(assignments);
      setPendingCount(assignments.length);
    } catch (error) {
      console.error('Error fetching pending assignments:', error);
      toast.error('Failed to fetch pending assignments');
    } finally {
      setLoading(false);
    }
  };

  const handleApproval = async (assignmentId: string, approved: boolean, note?: string) => {
    try {
      const updateData: any = {
        supervisor_approved: approved,
        supervisor_approved_by: (await supabase.auth.getUser()).data.user?.id,
        supervisor_approved_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('room_assignments')
        .update(updateData)
        .eq('id', assignmentId);

      if (error) throw error;

      // Add a note if provided
      if (note && note.trim()) {
        await supabase
          .from('housekeeping_notes')
          .insert({
            room_id: pendingAssignments.find(a => a.id === assignmentId)?.room_id,
            assignment_id: assignmentId,
            content: `Supervisor ${approved ? 'approved' : 'rejected'}: ${note}`,
            note_type: 'supervisor_review',
            created_by: (await supabase.auth.getUser()).data.user?.id
          });
      }

      toast.success(`Assignment ${approved ? 'approved' : 'rejected'} successfully`);
      fetchPendingAssignments();
      setNoteDialogOpen(false);
      setApprovalNote('');
      setSelectedAssignment(null);
    } catch (error) {
      console.error('Error updating assignment approval:', error);
      toast.error('Failed to update approval status');
    }
  };

  const getAssignmentTypeLabel = (type: string) => {
    switch (type) {
      case 'daily_cleaning':
        return t('housekeeping.assignmentType.dailyClean');
      case 'checkout_cleaning':
        return t('housekeeping.assignmentType.checkoutClean');
      case 'deep_cleaning':
        return t('housekeeping.assignmentType.deepClean');
      case 'maintenance':
        return t('housekeeping.assignmentType.maintenance');
      default:
        return type;
    }
  };

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 3:
        return 'bg-destructive/10 text-destructive border-destructive/30';
      case 2:
        return 'bg-primary/10 text-primary border-primary/30';
      default:
        return 'bg-muted text-foreground border-border';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground mb-2">
            {t('supervisor.pendingApprovals')}
          </h2>
          <p className="text-muted-foreground">
            {t('supervisor.reviewCompletedTasks')}
          </p>
        </div>
        
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full sm:w-auto">
              <Clock className="h-4 w-4 mr-2" />
              {format(selectedDate, 'PPP')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => date && setSelectedDate(date)}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      {pendingAssignments.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <CheckCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {t('supervisor.noTasksPending')}
            </h3>
            <p className="text-muted-foreground">
              {t('supervisor.allTasksReviewed')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {pendingAssignments.map((assignment) => (
            <Card key={assignment.id} className="border border-border shadow-sm hover:shadow-md transition-all duration-200">
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-xl font-bold text-foreground">
                      Room {assignment.rooms?.room_number || 'N/A'}
                    </CardTitle>
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      {t('housekeeping.completed')}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {assignment.priority > 1 && (
                      <Badge variant="outline" className={getPriorityColor(assignment.priority)}>
                        {assignment.priority === 3 ? t('housekeeping.priority.high') : t('housekeeping.priority.medium')}
                      </Badge>
                    )}
                    <Badge variant="outline" className="bg-muted text-foreground border-border">
                      {getAssignmentTypeLabel(assignment.assignment_type)}
                    </Badge>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <User className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        {t('supervisor.cleanedBy')}
                      </p>
                      <p className="text-lg font-semibold text-foreground">
                        {assignment.profiles?.full_name || 'Unknown'}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Hotel</p>
                      <p className="text-lg font-semibold text-foreground">
                        {assignment.rooms?.hotel || 'Unknown'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <Clock className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        {t('supervisor.completedAt')}
                      </p>
                      <p className="text-lg font-semibold text-foreground">
                        {new Date(assignment.completed_at).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                </div>

                {assignment.notes && (
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <h4 className="font-semibold text-blue-800 mb-2">
                      {t('housekeeping.assignmentNotes')}
                    </h4>
                    <p className="text-sm text-blue-700">{assignment.notes}</p>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    onClick={() => handleApproval(assignment.id, true)}
                    className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    {t('supervisor.approveTask')}
                  </Button>
                  
                  <Dialog 
                    open={noteDialogOpen && selectedAssignment === assignment.id} 
                    onOpenChange={(open) => {
                      setNoteDialogOpen(open);
                      if (!open) {
                        setSelectedAssignment(null);
                        setApprovalNote('');
                      }
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button
                        variant="destructive"
                        onClick={() => setSelectedAssignment(assignment.id)}
                        className="w-full sm:w-auto"
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        {t('supervisor.rejectTask')}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>
                          {t('supervisor.rejectTaskTitle')} {assignment.rooms?.room_number}
                        </DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <Textarea
                          placeholder={t('supervisor.rejectionReason')}
                          value={approvalNote}
                          onChange={(e) => setApprovalNote(e.target.value)}
                          className="min-h-[100px]"
                        />
                        <div className="flex justify-end gap-3">
                          <Button 
                            variant="outline" 
                            onClick={() => {
                              setNoteDialogOpen(false);
                              setSelectedAssignment(null);
                              setApprovalNote('');
                            }}
                          >
                            {t('common.cancel')}
                          </Button>
                          <Button 
                            variant="destructive"
                            onClick={() => handleApproval(assignment.id, false, approvalNote)}
                            disabled={!approvalNote.trim()}
                          >
                            {t('supervisor.confirmReject')}
                          </Button>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}