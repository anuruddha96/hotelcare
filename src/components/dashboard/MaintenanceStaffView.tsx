import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Wrench, Clock, CheckCircle, Play, MessageSquare, Camera, AlertTriangle, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface MaintenanceTicket {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  room_number: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'completed';
  created_at: string;
  updated_at: string;
  hotel?: string;
  created_by_profile?: {
    full_name: string;
    role: string;
  };
  completion_photos?: string[];
  resolution_text?: string;
}

export function MaintenanceStaffView() {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<MaintenanceTicket | null>(null);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('');

  const fetchAssignedTickets = async () => {
    if (!user?.id) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('tickets')
        .select(`
          *,
          created_by_profile:profiles!tickets_created_by_fkey(full_name, role)
        `)
        .eq('assigned_to', user.id)
        .eq('department', 'maintenance')
        .neq('status', 'completed')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      const parsed = (data || []).map((d: any) => ({
        id: d.id,
        ticket_number: d.ticket_number,
        title: d.title,
        description: d.description,
        room_number: d.room_number,
        priority: d.priority,
        status: d.status,
        created_at: d.created_at,
        updated_at: d.updated_at,
        hotel: d.hotel,
        created_by_profile: d.created_by_profile,
        completion_photos: d.completion_photos,
        resolution_text: d.resolution_text,
      }));
      
      // Sort by priority
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
      parsed.sort((a, b) => (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4));
      
      setTickets(parsed);
    } catch (error) {
      console.error('Error fetching tickets:', error);
      toast.error('Failed to load maintenance tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignedTickets();
    
    // Set up real-time subscription
    const channel = supabase
      .channel('maintenance-tickets')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `assigned_to=eq.${user?.id}`,
        },
        () => {
          fetchAssignedTickets();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const handleStartWork = async (ticket: MaintenanceTicket) => {
    try {
      const { error } = await supabase
        .from('tickets')
        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', ticket.id);

      if (error) throw error;
      toast.success('Work started on ticket');
      fetchAssignedTickets();
    } catch (error) {
      console.error('Error starting work:', error);
      toast.error('Failed to start work');
    }
  };

  const handleAddNote = async () => {
    if (!selectedTicket || !note.trim()) return;
    
    try {
      // Add comment to ticket
      const { error } = await supabase
        .from('comments')
        .insert({
          ticket_id: selectedTicket.id,
          user_id: user?.id,
          content: note,
        });

      if (error) throw error;
      toast.success('Note added successfully');
      setNote('');
      setNoteDialogOpen(false);
    } catch (error) {
      console.error('Error adding note:', error);
      toast.error('Failed to add note');
    }
  };

  const handleCompleteTicket = async () => {
    if (!selectedTicket || !resolution.trim()) {
      toast.error('Please provide a resolution description');
      return;
    }
    
    try {
      const { error } = await supabase
        .from('tickets')
        .update({
          status: 'in_progress', // Keep in progress until supervisor approves
          resolution_text: resolution,
          pending_supervisor_approval: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedTicket.id);

      if (error) throw error;
      toast.success('Task completed! Awaiting supervisor approval.');
      setResolution('');
      setCompleteDialogOpen(false);
      fetchAssignedTickets();
    } catch (error) {
      console.error('Error completing ticket:', error);
      toast.error('Failed to complete task');
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-black';
      case 'low': return 'bg-green-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-800';
      case 'in_progress': return 'bg-amber-100 text-amber-800';
      case 'completed': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const summary = {
    total: tickets.length,
    open: tickets.filter(t => t.status === 'open').length,
    inProgress: tickets.filter(t => t.status === 'in_progress').length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Wrench className="h-6 w-6" />
          My Maintenance Tasks
        </h2>
        <p className="text-muted-foreground">Tasks assigned to you</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-primary/5">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{summary.total}</p>
            <p className="text-sm text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{summary.open}</p>
            <p className="text-sm text-muted-foreground">Open</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-50">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{summary.inProgress}</p>
            <p className="text-sm text-muted-foreground">In Progress</p>
          </CardContent>
        </Card>
      </div>

      {/* Task List */}
      {tickets.length === 0 ? (
        <Card className="p-8 text-center">
          <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
          <h3 className="text-lg font-semibold">All Done!</h3>
          <p className="text-muted-foreground">No maintenance tasks assigned to you</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {tickets.map((ticket) => (
            <Card key={ticket.id} className="overflow-hidden border-l-4" style={{ borderLeftColor: ticket.priority === 'urgent' ? '#ef4444' : ticket.priority === 'high' ? '#f97316' : ticket.priority === 'medium' ? '#eab308' : '#22c55e' }}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="font-mono">
                        Room {ticket.room_number}
                      </Badge>
                      <Badge className={getPriorityColor(ticket.priority)}>
                        {ticket.priority.toUpperCase()}
                      </Badge>
                      <Badge className={getStatusColor(ticket.status)}>
                        {ticket.status === 'in_progress' ? 'In Progress' : ticket.status}
                      </Badge>
                    </div>
                    <CardTitle className="text-lg">{ticket.title}</CardTitle>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    #{ticket.ticket_number}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{ticket.description}</p>
                
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(ticket.created_at), 'MMM d, yyyy HH:mm')}
                  </span>
                  {ticket.created_by_profile && (
                    <span>Reported by: {ticket.created_by_profile.full_name}</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {ticket.status === 'open' && (
                    <Button
                      size="sm"
                      onClick={() => handleStartWork(ticket)}
                      className="flex items-center gap-1"
                    >
                      <Play className="h-4 w-4" />
                      Start Work
                    </Button>
                  )}
                  
                  {ticket.status === 'in_progress' && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedTicket(ticket);
                          setNoteDialogOpen(true);
                        }}
                        className="flex items-center gap-1"
                      >
                        <MessageSquare className="h-4 w-4" />
                        Add Note
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setSelectedTicket(ticket);
                          setCompleteDialogOpen(true);
                        }}
                        className="flex items-center gap-1 bg-green-600 hover:bg-green-700"
                      >
                        <CheckCircle className="h-4 w-4" />
                        Mark Complete
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Note Dialog */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Note - {selectedTicket?.title}</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Enter your note or update..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddNote} disabled={!note.trim()}>
              Save Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Dialog */}
      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Task - {selectedTicket?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Resolution Description *</label>
              <Textarea
                placeholder="Describe what was done to resolve the issue..."
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows={4}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              This will send the task for supervisor approval.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCompleteTicket} disabled={!resolution.trim()} className="bg-green-600 hover:bg-green-700">
              Submit for Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}