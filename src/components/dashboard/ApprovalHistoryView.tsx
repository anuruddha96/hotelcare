import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle, Clock, User, MapPin, AlertTriangle, Calendar as CalendarIcon, Wrench, Home } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { CompletionDataView } from './CompletionDataView';

interface ApprovedAssignment {
  id: string;
  room_id: string;
  assignment_type: 'daily_cleaning' | 'checkout_cleaning' | 'maintenance' | 'deep_cleaning';
  status: string;
  priority: number;
  estimated_duration: number;
  notes: string;
  completed_at: string;
  started_at: string | null;
  supervisor_approved: boolean;
  supervisor_approved_at: string;
  assigned_to: string;
  assignment_date: string;
  rooms: {
    room_number: string;
    hotel: string;
    status: string;
    room_name: string | null;
    floor_number: number | null;
    towel_change_required?: boolean;
    linen_change_required?: boolean;
    guest_nights_stayed?: number;
  } | null;
  profiles: {
    full_name: string;
    nickname: string;
  } | null;
  approved_by_profile: {
    full_name: string;
  } | null;
}

interface ApprovedMaintenanceTicket {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  room_number: string;
  priority: string;
  hotel: string | null;
  resolution_text: string | null;
  completion_photos: string[] | null;
  supervisor_approved_at: string;
  closed_at: string | null;
  created_by_profile: {
    full_name: string;
  } | null;
  assigned_to_profile: {
    full_name: string;
  } | null;
  approved_by_profile: {
    full_name: string;
  } | null;
}

export function ApprovalHistoryView() {
  const { t } = useTranslation();
  const [approvedAssignments, setApprovedAssignments] = useState<ApprovedAssignment[]>([]);
  const [approvedMaintenanceTickets, setApprovedMaintenanceTickets] = useState<ApprovedMaintenanceTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [activeTab, setActiveTab] = useState('housekeeping');

  useEffect(() => {
    fetchApprovedAssignments();
    fetchApprovedMaintenanceTickets();
  }, [selectedDate]);

  const fetchApprovedAssignments = async () => {
    setLoading(true);
    try {
      const dateStr = selectedDate.toISOString().split('T')[0];
      
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user) return;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('assigned_hotel')
        .eq('id', currentUser.user.id)
        .single();

      if (profileError) throw profileError;

      const userHotelId = profile?.assigned_hotel;
      let userHotelName = userHotelId;

      if (userHotelId) {
        const { data: hotelName } = await supabase
          .rpc('get_hotel_name_from_id', { hotel_id: userHotelId });
        if (hotelName) {
          userHotelName = hotelName;
        }
      }
      
      const { data, error } = await supabase
        .from('room_assignments')
        .select(`
          *,
          rooms!inner (
            room_number,
            hotel,
            status,
            room_name,
            floor_number,
            towel_change_required,
            linen_change_required,
            guest_nights_stayed
          ),
          profiles!assigned_to (
            full_name,
            nickname
          ),
          approved_by_profile:profiles!supervisor_approved_by (
            full_name
          )
        `)
        .eq('status', 'completed')
        .eq('supervisor_approved', true)
        .eq('assignment_date', dateStr)
        .order('supervisor_approved_at', { ascending: false });

      if (error) throw error;
      
      let assignments = (data as any) || [];
      if (userHotelName) {
        assignments = assignments.filter((assignment: any) => 
          assignment.rooms?.hotel === userHotelName || 
          assignment.rooms?.hotel === userHotelId
        );
      }
      
      setApprovedAssignments(assignments);
    } catch (error) {
      console.error('Error fetching approved assignments:', error);
      toast.error(t('approvalHistory.fetchError'));
    } finally {
      setLoading(false);
    }
  };

  const fetchApprovedMaintenanceTickets = async () => {
    try {
      const dateStr = selectedDate.toISOString().split('T')[0];
      
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('assigned_hotel')
        .eq('id', currentUser.user.id)
        .single();

      const userHotelId = profile?.assigned_hotel;
      let userHotelName = userHotelId;

      if (userHotelId) {
        const { data: hotelName } = await supabase
          .rpc('get_hotel_name_from_id', { hotel_id: userHotelId });
        if (hotelName) {
          userHotelName = hotelName;
        }
      }
      
      const { data, error } = await supabase
        .from('tickets')
        .select(`
          id,
          ticket_number,
          title,
          description,
          room_number,
          priority,
          hotel,
          resolution_text,
          completion_photos,
          supervisor_approved_at,
          closed_at,
          created_by_profile:profiles!tickets_created_by_fkey(full_name),
          assigned_to_profile:profiles!tickets_assigned_to_fkey(full_name),
          approved_by_profile:profiles!tickets_supervisor_approved_by_fkey(full_name)
        `)
        .eq('department', 'maintenance')
        .eq('status', 'completed')
        .eq('supervisor_approved', true)
        .gte('supervisor_approved_at', `${dateStr}T00:00:00`)
        .lte('supervisor_approved_at', `${dateStr}T23:59:59`)
        .order('supervisor_approved_at', { ascending: false });

      if (error) throw error;
      
      let tickets = (data as any) || [];
      if (userHotelName) {
        tickets = tickets.filter((ticket: any) => 
          ticket.hotel === userHotelName || 
          ticket.hotel === userHotelId ||
          !ticket.hotel
        );
      }
      
      setApprovedMaintenanceTickets(tickets);
    } catch (error) {
      console.error('Error fetching approved maintenance tickets:', error);
    }
  };

  const calculateDuration = (startTime: string, endTime: string) => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diffMs = end.getTime() - start.getTime();
    const diffMins = Math.round(diffMs / (1000 * 60));
    
    const hours = Math.floor(diffMins / 60);
    const minutes = diffMins % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
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

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-black';
      case 'low': return 'bg-green-500 text-white';
      default: return 'bg-gray-500 text-white';
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
            {t('approvalHistory.title')}
          </h2>
          <p className="text-muted-foreground">
            {t('approvalHistory.description')}
          </p>
        </div>
        
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full sm:w-auto">
              <CalendarIcon className="h-4 w-4 mr-2" />
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="housekeeping" className="flex items-center gap-2">
            <Home className="h-4 w-4" />
            {t('approvalHistory.housekeepingTab') || 'Housekeeping'} ({approvedAssignments.length})
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            {t('approvalHistory.maintenanceTab') || 'Maintenance'} ({approvedMaintenanceTickets.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="housekeeping" className="mt-4">
          {approvedAssignments.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <CheckCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {t('approvalHistory.noApprovals')}
                </h3>
                <p className="text-muted-foreground">
                  {t('approvalHistory.noApprovalsDescription')}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {approvedAssignments.map((assignment) => (
                <Card key={assignment.id} className="border border-border shadow-sm hover:shadow-md transition-all duration-200">
                  <CardHeader>
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                      <div className="flex items-center gap-3">
                        <CardTitle className="text-xl font-bold text-foreground">
                          {t('common.room')} {assignment.rooms?.room_number || 'N/A'}
                        </CardTitle>
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          {t('approvalHistory.approved')}
                        </Badge>
                      </div>
                      <Badge variant="outline" className="bg-muted text-foreground border-border">
                        {getAssignmentTypeLabel(assignment.assignment_type)}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                          <p className="text-sm font-medium text-muted-foreground">{t('supervisor.hotel')}</p>
                          <p className="text-lg font-semibold text-foreground">
                            {assignment.rooms?.hotel || 'Unknown'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                        <CheckCircle className="h-5 w-5 text-green-600" />
                        <div>
                          <p className="text-sm font-medium text-green-700">{t('approvalHistory.approvedAt')}</p>
                          <p className="text-lg font-semibold text-green-800">
                            {new Date(assignment.supervisor_approved_at).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                        <User className="h-5 w-5 text-blue-600" />
                        <div>
                          <p className="text-sm font-medium text-blue-700">{t('approvalHistory.approvedBy')}</p>
                          <p className="text-lg font-semibold text-blue-800">
                            {assignment.approved_by_profile?.full_name || 'Unknown'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {assignment.started_at && (
                      <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                        <div className="flex items-center gap-2 mb-2">
                          <Clock className="h-5 w-5 text-amber-600" />
                          <h4 className="font-semibold text-amber-800">{t('supervisor.duration')}</h4>
                        </div>
                        <p className="text-2xl font-bold text-amber-900">
                          {calculateDuration(assignment.started_at, assignment.completed_at)}
                        </p>
                        <p className="text-sm text-amber-700 mt-1">
                          {t('supervisor.totalTimeTaken')}
                        </p>
                      </div>
                    )}

                    {assignment.notes && (
                      <div className="relative p-5 bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 rounded-xl border-2 border-amber-300 shadow-lg mb-4">
                        <div className="absolute -top-3 -left-3 bg-amber-400 text-white rounded-full p-2 shadow-md">
                          <AlertTriangle className="h-5 w-5" />
                        </div>
                        <div className="ml-6">
                          <h4 className="font-bold text-amber-900 mb-2 text-lg flex items-center gap-2">
                            📝 {t('housekeeping.assignmentNotes')}
                          </h4>
                          <p className="text-base text-amber-800 leading-relaxed font-semibold bg-white/60 p-3 rounded-lg border border-amber-200">
                            {assignment.notes}
                          </p>
                        </div>
                      </div>
                    )}

                    {(assignment.rooms?.towel_change_required || assignment.rooms?.linen_change_required) && (
                      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border-2 border-blue-200">
                        <h4 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4" />
                          {t('supervisor.specialRequirements')}
                        </h4>
                        <div className="space-y-1 text-sm">
                          {assignment.rooms?.towel_change_required && (
                            <p className="text-blue-800">
                              ✓ {t('supervisor.towelChangeRequired')} {assignment.rooms?.guest_nights_stayed ? `(${assignment.rooms.guest_nights_stayed} nights)` : ''}
                            </p>
                          )}
                          {assignment.rooms?.linen_change_required && (
                            <p className="text-blue-800">
                              ✓ {t('supervisor.linenChangeRequired')} {assignment.rooms?.guest_nights_stayed ? `(${assignment.rooms.guest_nights_stayed} nights)` : ''}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    <CompletionDataView
                      assignmentId={assignment.id}
                      roomId={assignment.room_id}
                      assignmentDate={assignment.assignment_date}
                      housekeeperId={assignment.assigned_to}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="maintenance" className="mt-4">
          {approvedMaintenanceTickets.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <Wrench className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {t('maintenance.noApprovedTickets')}
                </h3>
                <p className="text-muted-foreground">
                  {t('approvalHistory.noApprovalsDescription')}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {approvedMaintenanceTickets.map((ticket) => (
                <Card key={ticket.id} className="border border-border shadow-sm hover:shadow-md transition-all duration-200">
                  <CardHeader>
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                      <div className="flex items-center gap-3">
                        <CardTitle className="text-xl font-bold text-foreground">
                          #{ticket.ticket_number}
                        </CardTitle>
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          {t('approvalHistory.approved')}
                        </Badge>
                      </div>
                      <Badge className={getPriorityColor(ticket.priority)}>
                        {ticket.priority.toUpperCase()}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <div>
                      <h4 className="font-semibold text-foreground">{ticket.title}</h4>
                      <p className="text-muted-foreground text-sm mt-1">{ticket.description}</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                        <MapPin className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">
                            {t('maintenance.ticketRoomNumber')}
                          </p>
                          <p className="text-lg font-semibold text-foreground">
                            {ticket.room_number}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                        <User className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">{t('tickets.reportedBy')}</p>
                          <p className="text-lg font-semibold text-foreground">
                            {ticket.created_by_profile?.full_name || 'Unknown'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg">
                        <Wrench className="h-5 w-5 text-amber-600" />
                        <div>
                          <p className="text-sm font-medium text-amber-700">{t('tickets.fixedBy')}</p>
                          <p className="text-lg font-semibold text-amber-800">
                            {ticket.assigned_to_profile?.full_name || 'Unknown'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                        <CheckCircle className="h-5 w-5 text-green-600" />
                        <div>
                          <p className="text-sm font-medium text-green-700">{t('approvalHistory.approvedBy')}</p>
                          <p className="text-lg font-semibold text-green-800">
                            {ticket.approved_by_profile?.full_name || 'Unknown'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {ticket.resolution_text && (
                      <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                        <h4 className="font-semibold text-blue-800 mb-2">{t('maintenance.ticketResolution')}</h4>
                        <p className="text-blue-700">{ticket.resolution_text}</p>
                      </div>
                    )}

                    {ticket.completion_photos && ticket.completion_photos.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="font-semibold text-foreground">{t('maintenance.completionPhotos')}</h4>
                        <div className="flex flex-wrap gap-2">
                          {ticket.completion_photos.map((photo, index) => (
                            <a
                              key={index}
                              href={photo}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                            >
                              <img
                                src={photo}
                                alt={`Completion ${index + 1}`}
                                className="h-20 w-20 object-cover rounded-lg border border-border hover:opacity-80 transition-opacity"
                              />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {ticket.supervisor_approved_at && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>{t('approvalHistory.approvedAt')}: {new Date(ticket.supervisor_approved_at).toLocaleString()}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}