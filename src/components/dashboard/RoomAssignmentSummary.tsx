import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Home, User, Calendar as CalendarIcon, RefreshCw, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

interface RoomAssignment {
  room_number: string;
  room_id: string;
  hotel: string;
  assignment_type: string;
  status: string;
  housekeeper_name: string | null;
  housekeeper_id: string | null;
  priority: number;
  estimated_duration: number | null;
}

export function RoomAssignmentSummary() {
  const { profile } = useAuth();
  const [date, setDate] = useState<Date>(new Date());
  const [assignments, setAssignments] = useState<RoomAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [hotelFilter, setHotelFilter] = useState<string>('all');

  useEffect(() => {
    fetchAssignments();
  }, [date]);

  const fetchAssignments = async () => {
    setLoading(true);
    try {
      const targetDate = format(date, 'yyyy-MM-dd');

      // Fetch all room assignments for the selected date
      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('room_assignments')
        .select(`
          id,
          room_id,
          assigned_to,
          assignment_type,
          status,
          priority,
          estimated_duration,
          rooms (
            room_number,
            hotel
          ),
          profiles:assigned_to (
            full_name,
            nickname
          )
        `)
        .eq('assignment_date', targetDate)
        .order('rooms(room_number)', { ascending: true });

      if (assignmentsError) throw assignmentsError;

      // Fetch all rooms (including unassigned ones)
      const { data: roomsData, error: roomsError } = await supabase
        .from('rooms')
        .select('id, room_number, hotel')
        .order('room_number', { ascending: true });

      if (roomsError) throw roomsError;

      // Create a map of room_id to assignment
      const assignmentMap = new Map();
      assignmentsData?.forEach((assignment: any) => {
        assignmentMap.set(assignment.room_id, {
          room_number: assignment.rooms.room_number,
          room_id: assignment.room_id,
          hotel: assignment.rooms.hotel,
          assignment_type: assignment.assignment_type,
          status: assignment.status,
          housekeeper_name: assignment.profiles?.nickname || assignment.profiles?.full_name,
          housekeeper_id: assignment.assigned_to,
          priority: assignment.priority,
          estimated_duration: assignment.estimated_duration,
        });
      });

      // Merge rooms with assignments
      const allRooms: RoomAssignment[] = roomsData?.map((room: any) => {
        const assignment = assignmentMap.get(room.id);
        if (assignment) {
          return assignment;
        } else {
          // Room with no assignment
          return {
            room_number: room.room_number,
            room_id: room.id,
            hotel: room.hotel,
            assignment_type: '',
            status: 'unassigned',
            housekeeper_name: null,
            housekeeper_id: null,
            priority: 0,
            estimated_duration: null,
          };
        }
      }) || [];

      setAssignments(allRooms);
    } catch (error) {
      console.error('Error fetching assignments:', error);
      toast.error('Failed to load room assignments');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-600 text-white"><CheckCircle2 className="h-3 w-3 mr-1" />Completed</Badge>;
      case 'in_progress':
        return <Badge className="bg-blue-600 text-white"><Clock className="h-3 w-3 mr-1" />In Progress</Badge>;
      case 'assigned':
        return <Badge className="bg-yellow-600 text-white"><AlertCircle className="h-3 w-3 mr-1" />Assigned</Badge>;
      case 'unassigned':
        return <Badge variant="outline" className="text-gray-600">Unassigned</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getAssignmentTypeLabel = (type: string) => {
    switch (type) {
      case 'checkout_cleaning':
        return 'Checkout';
      case 'daily_cleaning':
        return 'Daily';
      case 'deep_cleaning':
        return 'Deep Clean';
      default:
        return type || 'N/A';
    }
  };

  const filteredAssignments = hotelFilter === 'all' 
    ? assignments 
    : assignments.filter(a => a.hotel === hotelFilter);

  // Group by hotel
  const groupedByHotel = filteredAssignments.reduce((acc, assignment) => {
    if (!acc[assignment.hotel]) {
      acc[assignment.hotel] = [];
    }
    acc[assignment.hotel].push(assignment);
    return acc;
  }, {} as Record<string, RoomAssignment[]>);

  const uniqueHotels = Array.from(new Set(assignments.map(a => a.hotel)));

  // Only allow access for managers, admins, and super admins
  if (!profile || !['admin', 'manager', 'housekeeping_manager', 'top_management'].includes(profile.role)) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p className="text-sm">Access restricted to managers and administrators</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Home className="h-5 w-5" />
              Room Assignment Summary
            </div>
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {format(date, 'MMM dd, yyyy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(newDate) => newDate && setDate(newDate)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <Button variant="outline" size="sm" onClick={fetchAssignments} disabled={loading}>
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Hotel Filter */}
          {uniqueHotels.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant={hotelFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setHotelFilter('all')}
              >
                All Hotels ({assignments.length})
              </Button>
              {uniqueHotels.map(hotel => (
                <Button
                  key={hotel}
                  size="sm"
                  variant={hotelFilter === hotel ? 'default' : 'outline'}
                  onClick={() => setHotelFilter(hotel)}
                >
                  {hotel} ({assignments.filter(a => a.hotel === hotel).length})
                </Button>
              ))}
            </div>
          )}

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-3">
                <div className="text-xs text-blue-600 font-medium">Total Rooms</div>
                <div className="text-2xl font-bold text-blue-900">{filteredAssignments.length}</div>
              </CardContent>
            </Card>
            <Card className="bg-green-50 border-green-200">
              <CardContent className="p-3">
                <div className="text-xs text-green-600 font-medium">Completed</div>
                <div className="text-2xl font-bold text-green-900">
                  {filteredAssignments.filter(a => a.status === 'completed').length}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-yellow-50 border-yellow-200">
              <CardContent className="p-3">
                <div className="text-xs text-yellow-600 font-medium">In Progress</div>
                <div className="text-2xl font-bold text-yellow-900">
                  {filteredAssignments.filter(a => a.status === 'in_progress').length}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-50 border-gray-200">
              <CardContent className="p-3">
                <div className="text-xs text-gray-600 font-medium">Unassigned</div>
                <div className="text-2xl font-bold text-gray-900">
                  {filteredAssignments.filter(a => a.status === 'unassigned').length}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Room List */}
          <ScrollArea className="h-[500px] w-full rounded-md border p-4">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedByHotel).map(([hotel, hotelAssignments]) => (
                  <div key={hotel} className="space-y-2">
                    <h3 className="font-semibold text-lg sticky top-0 bg-background py-2 border-b">
                      {hotel}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {hotelAssignments.map((assignment) => (
                        <Card
                          key={assignment.room_id}
                          className={cn(
                            "border-2 transition-all",
                            assignment.status === 'completed' && "border-green-200 bg-green-50",
                            assignment.status === 'in_progress' && "border-blue-200 bg-blue-50",
                            assignment.status === 'assigned' && "border-yellow-200 bg-yellow-50",
                            assignment.status === 'unassigned' && "border-gray-200 bg-gray-50"
                          )}
                        >
                          <CardContent className="p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Home className="h-4 w-4" />
                                <span className="font-bold text-lg">{assignment.room_number}</span>
                              </div>
                              {getStatusBadge(assignment.status)}
                            </div>

                            {assignment.housekeeper_name ? (
                              <div className="flex items-center gap-2 bg-white/50 rounded p-2">
                                <Avatar className="h-6 w-6">
                                  <AvatarFallback className="text-xs">
                                    {assignment.housekeeper_name.charAt(0).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">
                                    {assignment.housekeeper_name}
                                  </p>
                                  {assignment.assignment_type && (
                                    <p className="text-xs text-muted-foreground">
                                      {getAssignmentTypeLabel(assignment.assignment_type)}
                                      {assignment.estimated_duration && ` • ${assignment.estimated_duration}min`}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 bg-white/50 rounded p-2">
                                <User className="h-4 w-4 text-gray-400" />
                                <span className="text-sm text-gray-500 italic">
                                  {assignment.status === 'unassigned' ? 'No Show' : 'Not Assigned'}
                                </span>
                              </div>
                            )}

                            {assignment.priority > 1 && (
                              <Badge variant="destructive" className="text-xs">
                                Priority: {assignment.priority}
                              </Badge>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
