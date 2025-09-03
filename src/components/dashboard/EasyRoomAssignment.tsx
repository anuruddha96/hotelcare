import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Users, Calendar, Zap } from 'lucide-react';

interface Room {
  id: string;
  room_number: string;
  status: string;
  hotel: string;
}

interface Staff {
  id: string;
  full_name: string;
  nickname?: string;
}

interface EasyRoomAssignmentProps {
  onAssignmentCreated: () => void;
}

export function EasyRoomAssignment({ onAssignmentCreated }: EasyRoomAssignmentProps) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [selectedDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // Fetch dirty rooms
      const { data: roomsData, error: roomsError } = await supabase
        .from('rooms')
        .select('id, room_number, status, hotel')
        .eq('status', 'dirty')
        .order('hotel')
        .order('room_number');

      // Fetch housekeeping staff
      const { data: staffData, error: staffError } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .eq('role', 'housekeeping')
        .order('full_name');

      if (roomsError || staffError) {
        throw roomsError || staffError;
      }

      setRooms(roomsData || []);
      setStaff(staffData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load data');
    }
  };

  const assignAllRooms = async () => {
    if (!selectedStaff) {
      toast.error('Please select a housekeeper first');
      return;
    }

    if (rooms.length === 0) {
      toast.error('No dirty rooms to assign');
      return;
    }

    setLoading(true);
    try {
      const assignments = rooms.map(room => ({
        room_id: room.id,
        assigned_to: selectedStaff,
        assigned_by: user?.id,
        assignment_date: selectedDate,
        assignment_type: 'daily_cleaning' as const,
        priority: 1,
        estimated_duration: 30,
        notes: 'Quick assignment - all dirty rooms'
      }));

      const { error } = await supabase
        .from('room_assignments')
        .insert(assignments);

      if (error) throw error;

      // Send notification
      try {
        await supabase.functions.invoke('send-work-assignment-notification', {
          body: {
            staff_id: selectedStaff,
            assignment_type: 'room_assignment',
            assignment_details: {
              room_count: rooms.length,
              assignment_type: 'daily_cleaning'
            }
          }
        });
      } catch (notificationError) {
        console.log('Notification failed:', notificationError);
      }

      const staffMember = staff.find(s => s.id === selectedStaff);
      toast.success(`Assigned ${assignments.length} rooms to ${staffMember?.full_name}`);
      
      onAssignmentCreated();
      fetchData(); // Refresh rooms list
    } catch (error) {
      console.error('Error creating assignments:', error);
      toast.error('Failed to create assignments');
    } finally {
      setLoading(false);
    }
  };

  const groupedRooms = rooms.reduce((groups, room) => {
    if (!groups[room.hotel]) {
      groups[room.hotel] = [];
    }
    groups[room.hotel].push(room);
    return groups;
  }, {} as Record<string, Room[]>);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-blue-600" />
          Quick Assign
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Assign all dirty rooms to a housekeeper instantly
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Staff Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Choose Housekeeper</label>
          <Select value={selectedStaff} onValueChange={setSelectedStaff}>
            <SelectTrigger>
              <SelectValue placeholder="Select housekeeper..." />
            </SelectTrigger>
            <SelectContent>
              {staff.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.full_name} {member.nickname && `(${member.nickname})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Rooms Overview */}
        {rooms.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Dirty Rooms to Assign</h3>
              <Badge variant="outline" className="text-orange-600 border-orange-200">
                {rooms.length} rooms total
              </Badge>
            </div>

            {/* Simple Room Display */}
            <div className="bg-muted/50 p-4 rounded-lg space-y-3">
              {Object.entries(groupedRooms).map(([hotel, hotelRooms]) => (
                <div key={hotel} className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">{hotel}</h4>
                  <div className="flex flex-wrap gap-2">
                    {hotelRooms.map((room) => (
                      <Badge key={room.id} variant="secondary" className="text-xs">
                        {room.room_number}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Simple Assignment Action */}
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-blue-900">Ready to Assign</h4>
                  <p className="text-sm text-blue-700">
                    All {rooms.length} dirty rooms will be assigned for daily cleaning
                  </p>
                </div>
                <Button
                  onClick={assignAllRooms}
                  disabled={loading || !selectedStaff}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  {loading ? 'Assigning...' : 'Assign All Rooms'}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <h3 className="font-medium mb-2">All Rooms Clean!</h3>
            <p className="text-sm">No dirty rooms found. Great job team! 🎉</p>
          </div>
        )}

        <div className="text-xs text-muted-foreground bg-gray-50 p-3 rounded">
          <p><strong>How it works:</strong> Select a housekeeper and click "Assign All Rooms" to instantly assign all dirty rooms for today's cleaning schedule.</p>
        </div>
      </CardContent>
    </Card>
  );
}
