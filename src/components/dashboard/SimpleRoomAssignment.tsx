import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Users, Calendar, Clock } from 'lucide-react';

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

interface SimpleRoomAssignmentProps {
  onAssignmentCreated: () => void;
}

export function SimpleRoomAssignment({ onAssignmentCreated }: SimpleRoomAssignmentProps) {
  const { user, profile } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [assignmentType, setAssignmentType] = useState<'daily_cleaning' | 'checkout_cleaning'>('daily_cleaning');
  const [loading, setLoading] = useState(false);
  const [selectedDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    if (profile?.assigned_hotel) {
      fetchData();
    }
  }, [profile?.assigned_hotel]);

  const fetchData = async () => {
    if (!profile?.assigned_hotel || !profile?.organization_slug) {
      console.log('Missing hotel or organization info for filtering');
      return;
    }

    try {
      // Fetch dirty rooms that need cleaning - filtered by manager's hotel
      const { data: roomsData, error: roomsError } = await supabase
        .from('rooms')
        .select('id, room_number, status, hotel')
        .eq('status', 'dirty')
        .eq('hotel', profile.assigned_hotel)
        .order('room_number');

      if (roomsError) throw roomsError;

      // Fetch active (non-completed) assignments for today to exclude already assigned rooms
      const { data: activeAssignments, error: assignmentError } = await supabase
        .from('room_assignments')
        .select('room_id')
        .eq('assignment_date', selectedDate)
        .in('status', ['assigned', 'in_progress']);

      if (assignmentError) throw assignmentError;

      // Filter out rooms that have active assignments (but allow rooms with completed assignments)
      const activeAssignedRoomIds = new Set(activeAssignments?.map(a => a.room_id) || []);
      const availableRooms = (roomsData || []).filter(room => !activeAssignedRoomIds.has(room.id));

      // Fetch housekeeping staff - filtered by same hotel and organization
      const { data: staffData, error: staffError } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .eq('role', 'housekeeping')
        .eq('assigned_hotel', profile.assigned_hotel)
        .eq('organization_slug', profile.organization_slug)
        .order('full_name');

      if (staffError) throw staffError;

      setRooms(availableRooms);
      setStaff(staffData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load rooms and staff');
    }
  };

  const handleQuickAssign = async (type: 'daily_cleaning' | 'checkout_cleaning') => {
    console.log('handleQuickAssign called', { type, selectedStaff, selectedRooms, user });
    
    if (!selectedStaff) {
      toast.error('Please select a housekeeper first');
      return;
    }

    if (!user?.id) {
      console.error('User ID is missing:', user);
      toast.error('User not properly authenticated. Please refresh the page.');
      return;
    }

    const roomsToAssign = type === 'daily_cleaning' 
      ? rooms.filter(r => !selectedRooms.includes(r.id)) // All unselected rooms for daily
      : selectedRooms; // Only selected rooms for checkout

    if (roomsToAssign.length === 0) {
      toast.error(`No rooms available for ${type.replace('_', ' ')}`);
      return;
    }

    setLoading(true);
    try {
      // Get user's organization slug
      const { data: profileData } = await supabase
        .from('profiles')
        .select('organization_slug')
        .eq('id', user.id)
        .single();

      if (!profileData?.organization_slug) {
        throw new Error('User organization not found');
      }

      const assignments = (type === 'daily_cleaning' ? 
        rooms.filter(r => !selectedRooms.includes(r.id)).map(r => r.id) : 
        selectedRooms
      ).map(roomId => ({
        room_id: roomId,
        assigned_to: selectedStaff,
        assigned_by: user.id,
        assignment_date: selectedDate,
        assignment_type: type,
        priority: type === 'checkout_cleaning' ? 2 : 1,
        estimated_duration: type === 'checkout_cleaning' ? 45 : 30,
        notes: `Quick assignment - ${type.replace('_', ' ')}`,
        ready_to_clean: false,
        organization_slug: profileData.organization_slug
      }));

      console.log('Creating assignments:', assignments);

      const { error } = await supabase
        .from('room_assignments')
        .insert(assignments);

      if (error) throw error;

      // Send email notifications for each assignment
      for (const assignment of assignments) {
        try {
          const room = rooms.find(r => r.id === assignment.room_id);
          await supabase.functions.invoke('send-work-assignment-notification', {
            body: {
              staff_id: assignment.assigned_to,
              assignment_type: 'room_assignment',
              assignment_details: {
                room_number: room?.room_number || 'Unknown',
                assignment_type: assignment.assignment_type
              },
              hotel_name: room?.hotel
            }
          });
        } catch (notificationError) {
          console.log('Failed to send notification for assignment:', notificationError);
          // Don't break the flow if email fails
        }
      }

      const staffMember = staff.find(s => s.id === selectedStaff);
      toast.success(`Assigned ${assignments.length} rooms for ${type.replace('_', ' ')} to ${staffMember?.full_name}`);
      
      onAssignmentCreated();
      setSelectedRooms([]);
      fetchData(); // Refresh rooms list
    } catch (error) {
      console.error('Error creating assignments:', error);
      toast.error('Failed to create assignments');
    } finally {
      setLoading(false);
    }
  };

  const toggleRoomSelection = (roomId: string) => {
    setSelectedRooms(prev => 
      prev.includes(roomId) 
        ? prev.filter(id => id !== roomId)
        : [...prev, roomId]
    );
  };

  const selectAllRooms = () => {
    setSelectedRooms(rooms.map(r => r.id));
  };

  const clearSelection = () => {
    setSelectedRooms([]);
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
          <Users className="h-5 w-5" />
          Quick Room Assignment
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Assign dirty rooms to housekeepers quickly and efficiently
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Staff Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Select Housekeeper</label>
          <Select value={selectedStaff} onValueChange={setSelectedStaff}>
            <SelectTrigger>
              <SelectValue placeholder="Choose housekeeper..." />
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

        {/* Rooms to Assign */}
        {rooms.length > 0 ? (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-medium">Dirty Rooms ({rooms.length})</h3>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={selectAllRooms}>
                  Select All
                </Button>
                <Button size="sm" variant="outline" onClick={clearSelection}>
                  Clear
                </Button>
              </div>
            </div>

            {/* Room List */}
            <div className="max-h-64 overflow-y-auto space-y-3">
              {Object.entries(groupedRooms).map(([hotel, hotelRooms]) => (
                <div key={hotel} className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">{hotel}</h4>
                  <div className="grid grid-cols-4 gap-2">
                    {hotelRooms.map((room) => (
                      <div
                        key={room.id}
                        className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-muted/50 ${
                          selectedRooms.includes(room.id) ? 'bg-blue-50 border-blue-200' : ''
                        }`}
                        onClick={() => toggleRoomSelection(room.id)}
                      >
                        <Checkbox
                          checked={selectedRooms.includes(room.id)}
                          onChange={() => {}} // Handled by parent onClick
                        />
                        <span className="text-sm font-medium">{room.room_number}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p>No dirty rooms found! All rooms are clean.</p>
          </div>
        )}

        {/* Assignment Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3 p-4 border rounded-lg">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-blue-600" />
              <h4 className="font-medium">Daily Cleaning</h4>
            </div>
            <p className="text-sm text-muted-foreground">
              Assign ALL unselected rooms for daily maintenance cleaning
            </p>
            <div className="flex items-center justify-between">
              <Badge variant="outline">
                {rooms.length - selectedRooms.length} rooms
              </Badge>
              <Button
                size="sm"
                onClick={() => handleQuickAssign('daily_cleaning')}
                disabled={loading || !selectedStaff || (rooms.length - selectedRooms.length) === 0}
              >
                <Clock className="h-4 w-4 mr-2" />
                Assign Daily
              </Button>
            </div>
          </div>

          <div className="space-y-3 p-4 border rounded-lg">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-orange-600" />
              <h4 className="font-medium">Checkout Cleaning</h4>
            </div>
            <p className="text-sm text-muted-foreground">
              Assign ONLY selected rooms for checkout cleaning (higher priority)
            </p>
            <div className="flex items-center justify-between">
              <Badge variant="outline">
                {selectedRooms.length} rooms
              </Badge>
              <Button
                size="sm"
                onClick={() => handleQuickAssign('checkout_cleaning')}
                disabled={loading || !selectedStaff || selectedRooms.length === 0}
                className="bg-orange-600 hover:bg-orange-700"
              >
                <Clock className="h-4 w-4 mr-2" />
                Assign Checkout
              </Button>
            </div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>• Select rooms that need checkout cleaning (departing guests)</p>
          <p>• Unselected rooms will be assigned for daily cleaning</p>
          <p>• Both types can be assigned to the same housekeeper</p>
        </div>
      </CardContent>
    </Card>
  );
}
