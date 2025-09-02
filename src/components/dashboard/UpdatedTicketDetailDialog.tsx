import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileUpload } from '@/components/ui/file-upload';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Clock, User, MessageCircle, FileText, AlertTriangle } from 'lucide-react';

interface Ticket {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  room_number: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'completed';
  created_at: string;
  updated_at: string;
  hotel: string;
  sla_breach_reason?: string;
  attachment_urls?: string[];
  created_by: string;
  assigned_to?: string;
  closed_at?: string;
  closed_by?: string;
  resolution_text?: string;
  profiles?: {
    full_name: string;
    email: string;
  };
}

interface Comment {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  profiles?: {
    full_name: string;
  };
}

interface Profile {
  id: string;
  full_name: string;
  email?: string; // Made optional since secure function doesn't return this
  role: string;
}

interface TicketDetailDialogProps {
  ticket: Ticket | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTicketUpdated: () => void;
}

export function TicketDetailDialog({ ticket, open, onOpenChange, onTicketUpdated }: TicketDetailDialogProps) {
  const { profile } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [resolutionText, setResolutionText] = useState('');
  const [slaBreachReason, setSlaBreachReason] = useState('');
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [maintenanceStaff, setMaintenanceStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (ticket && open) {
      fetchComments();
      fetchMaintenanceStaff();
      setResolutionText(ticket.resolution_text || '');
      setSlaBreachReason(ticket.sla_breach_reason || '');
    }
  }, [ticket, open]);

  const fetchComments = async () => {
    if (!ticket) return;

    const { data, error } = await supabase
      .from('comments')
      .select(`
        *,
        profiles(full_name)
      `)
      .eq('ticket_id', ticket.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching comments:', error);
    } else {
      setComments(data || []);
    }
  };

  const fetchMaintenanceStaff = async () => {
    // Use secure function that only returns assignable staff based on user role
    const { data, error } = await supabase.rpc('get_assignable_staff', {
      requesting_user_role: profile?.role
    });

    if (error) {
      console.error('Error fetching staff:', error);
    } else {
      setMaintenanceStaff(data || []);
    }
  };

  const getSLAInfo = (priority: string, createdAt: string) => {
    const created = new Date(createdAt);
    const now = new Date();
    const hoursPassed = (now.getTime() - created.getTime()) / (1000 * 60 * 60);

    const slaHours = {
      urgent: 2,
      high: 8,
      medium: 24,
      low: 72
    }[priority] || 24;

    const isBreached = hoursPassed > slaHours;
    const timeRemaining = slaHours - hoursPassed;

    return {
      isBreached,
      timeRemaining: Math.max(0, timeRemaining),
      slaHours,
      hoursPassed
    };
  };

  const handleStatusUpdate = async (newStatus: 'open' | 'in_progress' | 'completed') => {
    if (!ticket || !profile) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('tickets')
        .update({ 
          status: newStatus,
          assigned_to: newStatus === 'in_progress' ? profile.id : ticket.assigned_to
        })
        .eq('id', ticket.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Ticket status updated',
      });

      onTicketUpdated();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAssignment = async (userId: string) => {
    if (!ticket) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('tickets')
        .update({ assigned_to: userId })
        .eq('id', ticket.id);

      if (error) throw error;

      // Send email notification
      const assignedUser = maintenanceStaff.find(staff => staff.id === userId);
      if (assignedUser) {
        await supabase.functions.invoke('send-email-notification', {
          body: {
            to: assignedUser.email,
            ticketNumber: ticket.ticket_number,
            ticketTitle: ticket.title,
            ticketId: ticket.id,
            hotel: ticket.hotel,
            assignedBy: profile?.full_name || 'System'
          }
        });
      }

      toast({
        title: 'Success',
        description: 'Ticket assigned successfully',
      });

      onTicketUpdated();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCloseTicket = async () => {
    if (!ticket || !profile) return;

    const slaInfo = getSLAInfo(ticket.priority, ticket.created_at);
    
    if (!resolutionText.trim()) {
      toast({
        title: 'Error',
        description: 'Resolution text is required to close a ticket',
        variant: 'destructive',
      });
      return;
    }

    if (slaInfo.isBreached && !slaBreachReason.trim()) {
      toast({
        title: 'Error',
        description: 'SLA breach reason is required as the SLA has been exceeded',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const updateData: any = {
        status: 'completed',
        resolution_text: resolutionText,
        closed_at: new Date().toISOString(),
        closed_by: profile.id
      };

      if (slaInfo.isBreached) {
        updateData.sla_breach_reason = slaBreachReason;
      }

      const { error } = await supabase
        .from('tickets')
        .update(updateData)
        .eq('id', ticket.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Ticket closed successfully',
      });

      onTicketUpdated();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddComment = async () => {
    if (!ticket || !profile || !newComment.trim()) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('comments')
        .insert({
          content: newComment,
          ticket_id: ticket.id,
          user_id: profile.id
        });

      if (error) throw error;

      setNewComment('');
      fetchComments();
      
      toast({
        title: 'Success',
        description: 'Comment added',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-red-500';
      case 'in_progress': return 'bg-yellow-500';
      case 'completed': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  if (!ticket) return null;

  const slaInfo = getSLAInfo(ticket.priority, ticket.created_at);
  const canUpdateStatus = profile && ['maintenance', 'manager', 'admin', 'housekeeping', 'reception'].includes(profile.role);
  const canAssign = profile && ['manager', 'admin'].includes(profile.role);
  const canClose = profile && ticket.status !== 'completed';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Ticket {ticket.ticket_number}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Ticket Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{ticket.title}</span>
                  <div className="flex gap-2">
                    <Badge className={`${getPriorityColor(ticket.priority)} text-white`}>
                      {ticket.priority.toUpperCase()}
                    </Badge>
                    <Badge className={`${getStatusColor(ticket.status)} text-white`}>
                      {ticket.status.replace('_', ' ').toUpperCase()}
                    </Badge>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <strong>Hotel:</strong> {ticket.hotel}
                  </div>
                  <div>
                    <strong>Room:</strong> {ticket.room_number}
                  </div>
                  <div>
                    <strong>Created:</strong> {format(new Date(ticket.created_at), 'PPp')}
                  </div>
                  <div>
                    <strong>Created by:</strong> {ticket.profiles?.full_name}
                  </div>
                </div>

                {/* SLA Info */}
                <div className={`p-3 rounded-lg ${slaInfo.isBreached ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    <strong>SLA Status:</strong>
                    {slaInfo.isBreached ? (
                      <span className="text-red-600 font-semibold flex items-center gap-1">
                        <AlertTriangle className="w-4 h-4" />
                        BREACHED ({Math.round(slaInfo.hoursPassed - slaInfo.slaHours)}h overdue)
                      </span>
                    ) : (
                      <span className="text-green-600 font-semibold">
                        {Math.round(slaInfo.timeRemaining)}h remaining
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <strong>Description:</strong>
                  <p className="mt-1 text-muted-foreground">{ticket.description}</p>
                </div>

                {ticket.resolution_text && (
                  <div>
                    <strong>Resolution:</strong>
                    <p className="mt-1 text-muted-foreground">{ticket.resolution_text}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Comments */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="w-5 h-5" />
                  Comments ({comments.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {comments.map((comment) => (
                  <div key={comment.id} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">{comment.profiles?.full_name}</span>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(comment.created_at), 'PPp')}
                      </span>
                    </div>
                    <p className="text-sm">{comment.content}</p>
                  </div>
                ))}

                {/* Add Comment */}
                <div className="space-y-2">
                  <Label>Add Comment</Label>
                  <Textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Add your comment..."
                    rows={3}
                  />
                  <Button onClick={handleAddComment} disabled={loading || !newComment.trim()}>
                    Add Comment
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Actions Sidebar */}
          <div className="space-y-6">
            {/* Status Actions */}
            {canUpdateStatus && ticket.status !== 'completed' && (
              <Card>
                <CardHeader>
                  <CardTitle>Update Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button 
                    onClick={() => handleStatusUpdate('in_progress')} 
                    disabled={loading || ticket.status === 'in_progress'}
                    variant="outline"
                    className="w-full"
                  >
                    Start Working
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Assignment */}
            {canAssign && (
              <Card>
                <CardHeader>
                  <CardTitle>Assign To</CardTitle>
                </CardHeader>
                <CardContent>
                  <Select value={ticket.assigned_to || ''} onValueChange={handleAssignment}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select staff member" />
                    </SelectTrigger>
                    <SelectContent>
                      {maintenanceStaff.map((staff) => (
                        <SelectItem key={staff.id} value={staff.id}>
                          {staff.full_name} ({staff.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>
            )}

            {/* Close Ticket */}
            {canClose && (
              <Card>
                <CardHeader>
                  <CardTitle>Close Ticket</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Resolution Details *</Label>
                    <Textarea
                      value={resolutionText}
                      onChange={(e) => setResolutionText(e.target.value)}
                      placeholder="Describe how the issue was resolved..."
                      rows={3}
                    />
                  </div>

                  {slaInfo.isBreached && (
                    <div>
                      <Label className="text-red-600">SLA Breach Reason *</Label>
                      <Textarea
                        value={slaBreachReason}
                        onChange={(e) => setSlaBreachReason(e.target.value)}
                        placeholder="Explain why the SLA was exceeded..."
                        rows={2}
                      />
                    </div>
                  )}

                  <div>
                    <Label>Attachments</Label>
                    <FileUpload
                      onFileSelect={setAttachmentFiles}
                      maxFiles={3}
                      acceptedTypes="image/*,.pdf,.doc,.docx"
                    />
                  </div>

                  <Button 
                    onClick={handleCloseTicket}
                    disabled={loading || !resolutionText.trim() || (slaInfo.isBreached && !slaBreachReason.trim())}
                    className="w-full"
                  >
                    Close Ticket
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}