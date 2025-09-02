import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { FileUpload } from './FileUpload';
import { AttachmentViewer } from './AttachmentViewer';
import { AttachmentUpload } from './AttachmentUpload';
import { Calendar, MapPin, User, Clock, MessageSquare, AlertTriangle, CheckCircle, Paperclip } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '@/hooks/use-toast';

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
  resolution_text?: string;
  closed_at?: string;
  hotel?: string;
  attachment_urls?: string[];
  closed_by?: {
    full_name: string;
  };
  created_by?: {
    full_name: string;
    role: string;
  };
  assigned_to?: {
    full_name: string;
  };
}

interface Comment {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  profiles: {
    full_name: string;
    role: string;
  };
}

interface Profile {
  id: string;
  full_name: string;
  role: string;
}

interface TicketDetailDialogProps {
  ticket: Ticket;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTicketUpdated: () => void;
}

export function TicketDetailDialog({ ticket, open, onOpenChange, onTicketUpdated }: TicketDetailDialogProps) {
  const { profile } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [maintenanceStaff, setMaintenanceStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolutionText, setResolutionText] = useState('');
  const [slaBreachReason, setSlaBreachReason] = useState('');
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [commentAttachments, setCommentAttachments] = useState<string[]>([]);

  const canUpdateStatus = profile?.role === 'maintenance' && ticket.assigned_to?.full_name;
  const canAssign = profile?.role && ['manager', 'admin', 'reception'].includes(profile.role);
  const canClose = !!(profile?.role && ['maintenance', 'housekeeping', 'reception', 'manager', 'admin'].includes(profile.role));

  useEffect(() => {
    if (open) {
      fetchComments();
      if (canAssign) {
        fetchMaintenanceStaff();
      }
    }
  }, [open, ticket.id]);

  const fetchComments = async () => {
    try {
      const { data, error } = await supabase
        .from('comments')
        .select(`
          *,
          profiles:user_id(full_name, role)
        `)
        .eq('ticket_id', ticket.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setComments(data || []);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch comments',
        variant: 'destructive',
      });
    }
  };

  const fetchMaintenanceStaff = async () => {
    try {
      // Use secure function that only returns assignable staff based on user role
      const { data, error } = await supabase.rpc('get_assignable_staff', {
        requesting_user_role: profile?.role
      });

      if (error) throw error;
      setMaintenanceStaff(data || []);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch staff',
        variant: 'destructive',
      });
    }
  };

  const handleStatusUpdate = async (newStatus: 'open' | 'in_progress' | 'completed') => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('tickets')
        .update({ status: newStatus })
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

  const handleAssignment = async (assignedToId: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('tickets')
        .update({ assigned_to: assignedToId })
        .eq('id', ticket.id);

      if (error) throw error;

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
    if (!resolutionText.trim()) {
      toast({
        title: 'Error',
        description: 'Please provide a resolution before closing the ticket',
        variant: 'destructive',
      });
      return;
    }

    // Check if SLA is breached and require breach reason
    const slaInfo = getSLAInfo(ticket.priority, ticket.created_at);
    if (slaInfo.isOverdue && !slaBreachReason.trim()) {
      toast({
        title: 'Error',
        description: 'Please provide an SLA breach reason for overdue tickets',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const updateData = { 
        status: 'completed' as const,
        resolution_text: resolutionText.trim(),
        closed_at: new Date().toISOString(),
        closed_by: profile?.id,
        ...(slaInfo.isOverdue && { sla_breach_reason: slaBreachReason.trim() })
      };

      const { error } = await supabase
        .from('tickets')
        .update(updateData)
        .eq('id', ticket.id);

      if (error) throw error;

      // Send email notification to managers
      try {
        await supabase.functions.invoke('notify-manager-ticket-closed', {
          body: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticket_number,
            title: ticket.title,
            resolutionText: resolutionText.trim(),
            closedBy: profile?.full_name || 'Unknown User',
            hotel: ticket.hotel,
            roomNumber: ticket.room_number
          }
        });
      } catch (emailError) {
        console.error('Failed to send email notification:', emailError);
        // Don't fail the entire operation if email fails
      }

      toast({
        title: 'Success',
        description: 'Ticket closed successfully',
      });

      onTicketUpdated();
      onOpenChange(false); // Close the dialog
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

  const getSLAInfo = (priority: string, createdAt: string) => {
    const created = new Date(createdAt);
    const now = new Date();
    const hoursElapsed = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60));
    
    const slaHours = {
      urgent: 2,
      high: 8,
      medium: 24,
      low: 72
    }[priority] || 24;

    const isOverdue = hoursElapsed > slaHours;
    const remainingHours = Math.max(0, slaHours - hoursElapsed);

    return { slaHours, hoursElapsed, isOverdue, remainingHours };
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !profile) return;

    setLoading(true);
    try {
      const { error } = await supabase.from('comments').insert({
        ticket_id: ticket.id,
        user_id: profile.id,
        content: newComment.trim(),
      });

      if (error) throw error;

      setNewComment('');
      setCommentAttachments([]);
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

  const handleCommentAttachmentsChange = (attachments: string[]) => {
    setCommentAttachments(attachments);
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
      case 'open': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'in_progress': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'completed': return 'bg-green-100 text-green-800 border-green-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{ticket.ticket_number}</span>
            <div className="flex gap-2">
              <Badge className={getPriorityColor(ticket.priority)} variant="secondary">
                {ticket.priority.toUpperCase()}
              </Badge>
              <Badge className={getStatusColor(ticket.status)} variant="outline">
                {ticket.status.replace('_', ' ').toUpperCase()}
              </Badge>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Ticket Info */}
          <div>
            <h3 className="text-lg font-semibold mb-2">{ticket.title}</h3>
            <p className="text-muted-foreground mb-4">{ticket.description}</p>
            
            {/* SLA Information */}
            {(() => {
              const slaInfo = getSLAInfo(ticket.priority, ticket.created_at);
              return (
                <div className={`p-3 rounded-lg mb-4 ${slaInfo.isOverdue ? 'bg-red-50 border border-red-200' : 'bg-blue-50 border border-blue-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    {slaInfo.isOverdue ? (
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                    ) : (
                      <Clock className="h-4 w-4 text-blue-600" />
                    )}
                    <span className={`font-medium ${slaInfo.isOverdue ? 'text-red-700' : 'text-blue-700'}`}>
                      SLA: {slaInfo.slaHours}h ({ticket.priority.toUpperCase()} priority)
                    </span>
                  </div>
                  <div className="text-sm">
                    {slaInfo.isOverdue ? (
                      <span className="text-red-600">
                        ⚠️ OVERDUE by {slaInfo.hoursElapsed - slaInfo.slaHours}h (Total: {slaInfo.hoursElapsed}h elapsed)
                      </span>
                    ) : (
                      <span className="text-blue-600">
                        🕒 {slaInfo.remainingHours}h remaining ({slaInfo.hoursElapsed}h elapsed)
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}
            
            <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Room {ticket.room_number}
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {format(new Date(ticket.created_at), 'MMM dd, yyyy HH:mm')}
              </div>
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Created by {ticket.created_by?.full_name ?? 'Unknown'}
              </div>
              {ticket.assigned_to && (
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Assigned to {ticket.assigned_to.full_name}
                </div>
              )}
            </div>

            {/* Resolution Info */}
            {ticket.status === 'completed' && ticket.resolution_text && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="font-medium text-green-700">Resolution</span>
                </div>
                <p className="text-sm text-green-700">{ticket.resolution_text}</p>
                {ticket.closed_at && ticket.closed_by && (
                  <div className="text-xs text-green-600 mt-2">
                    Closed by {ticket.closed_by.full_name} on {format(new Date(ticket.closed_at), 'MMM dd, yyyy HH:mm')}
                  </div>
                )}
              </div>
            )}

            {/* Attachments */}
            {ticket.attachment_urls && ticket.attachment_urls.length > 0 && (
              <div className="mt-4">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Paperclip className="h-4 w-4" />
                  Attachments
                </h4>
                <AttachmentViewer attachments={ticket.attachment_urls} />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {canUpdateStatus && (
                <Select 
                  value={ticket.status} 
                  onValueChange={(value: 'open' | 'in_progress' | 'completed') => 
                    handleStatusUpdate(value)
                  }
                  disabled={loading}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Update Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              )}

              {canAssign && (
                <Select 
                  value={ticket.assigned_to?.full_name || ''} 
                  onValueChange={handleAssignment}
                  disabled={loading}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Assign to..." />
                  </SelectTrigger>
                  <SelectContent>
                    {maintenanceStaff.map((staff) => (
                      <SelectItem key={staff.id} value={staff.id}>
                        {staff.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Close Ticket Section */}
            {canClose && ticket.status !== 'completed' && (
              <div className="p-4 border rounded-lg bg-slate-50">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Close Ticket
                </h4>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="resolution">Resolution Details *</Label>
                    <Textarea
                      id="resolution"
                      value={resolutionText}
                      onChange={(e) => setResolutionText(e.target.value)}
                      placeholder="Describe how the issue was resolved..."
                      rows={3}
                    />
                  </div>
                  
                  {/* SLA Breach Reason - Show only if ticket is overdue */}
                  {(() => {
                    const slaInfo = getSLAInfo(ticket.priority, ticket.created_at);
                    return slaInfo.isOverdue && (
                      <div>
                        <Label htmlFor="slaBreachReason">SLA Breach Reason *</Label>
                        <Textarea
                          id="slaBreachReason"
                          value={slaBreachReason}
                          onChange={(e) => setSlaBreachReason(e.target.value)}
                          placeholder="Explain why this ticket exceeded the SLA time limit..."
                          rows={3}
                        />
                      </div>
                    );
                  })()}
                  
                  <div>
                    <Label className="flex items-center gap-2">
                      <Paperclip className="h-4 w-4" />
                      Attach Photos (Optional)
                    </Label>
                    <FileUpload 
                      onFilesChange={setAttachmentFiles}
                      maxFiles={3}
                      acceptedFileTypes={['image/*']}
                      className="mt-2"
                    />
                  </div>
                  
                  <Button 
                    onClick={handleCloseTicket}
                    disabled={loading || !resolutionText.trim() || ((() => {
                      const slaInfo = getSLAInfo(ticket.priority, ticket.created_at);
                      return slaInfo.isOverdue && !slaBreachReason.trim();
                    })())}
                    className="w-full"
                  >
                    {loading ? 'Closing...' : 'Close Ticket'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Comments Section */}
          <div>
            <h4 className="font-semibold mb-4 flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Comments ({comments.length})
            </h4>
            
            <div className="space-y-4 mb-4 max-h-60 overflow-y-auto">
              {comments.map((comment) => (
                <div key={comment.id} className="flex gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs">
                      {comment.profiles.full_name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{comment.profiles.full_name}</span>
                      <Badge variant="outline" className="text-xs">
                        {comment.profiles.role}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(comment.created_at), 'MMM dd, HH:mm')}
                      </span>
                    </div>
                    <p className="text-sm">{comment.content}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Comment Form */}
            <form onSubmit={handleAddComment} className="space-y-3">
              <div>
                <Label htmlFor="comment">Add a comment</Label>
                <Textarea
                  id="comment"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Share updates, ask questions, or provide additional information..."
                  rows={3}
                />
              </div>
              
              {/* Attachment Upload for Comments */}
              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <Paperclip className="h-4 w-4" />
                  Attach Files (Optional)
                </Label>
                <AttachmentUpload
                  ticketId={ticket.id}
                  onAttachmentsChange={handleCommentAttachmentsChange}
                  maxFiles={3}
                  className="mb-2"
                />
              </div>
              
              <div className="flex justify-end">
                <Button type="submit" disabled={loading || !newComment.trim()}>
                  {loading ? 'Adding...' : 'Add Comment'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}