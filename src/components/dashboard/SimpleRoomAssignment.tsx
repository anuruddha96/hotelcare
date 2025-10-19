import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { MapPin, User } from 'lucide-react';

interface Room {
  id: string;
  room_number: string;
  room_name: string | null;
  floor_number: number | null;
  status: string;
  hotel: string;
  is_checkout_room: boolean;
  existing_assignment?: {
    id: string;
    assigned_to: string;
    staff_name: string;
  } | null;
}

interface Staff {
  id: string;
  full_name: string;
  nickname?: string;
}

interface SimpleRoomAssignmentProps {
  onAssignmentCreated: () => void;
  selectedDate: string;
}

export function SimpleRoomAssignment({ onAssignmentCreated, selectedDate }: SimpleRoomAssignmentProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [estimatedDuration, setEstimatedDuration] = useState<string>('30');
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, [selectedDate]);

  const fetchData = async () => {
    try {
      // Fetch dirty rooms
      const { data: roomsData, error: roomsError } = await supabase
        .from('rooms')
        .select('id, room_number, room_name, floor_number, status, hotel, is_checkout_room')
        .eq('status', 'dirty')
        .order('hotel')
        .order('is_checkout_room', { ascending: false })
        .order('room_number');

      if (roomsError) throw roomsError;

      // Fetch existing assignments for the selected date
      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('room_assignments')
        .select(`
          id,
          room_id,
          assigned_to,
          profiles!room_assignments_assigned_to_fkey(full_name)
        `)
        .eq('assignment_date', selectedDate)
        .in('status', ['assigned', 'in_progress']);

      if (assignmentsError) throw assignmentsError;

      // Map assignments to rooms
      const roomsWithAssignments = (roomsData || []).map(room => {
        const assignment = assignmentsData?.find(a => a.room_id === room.id);
        return {
          ...room,
          existing_assignment: assignment ? {
            id: assignment.id,
            assigned_to: assignment.assigned_to,
            staff_name: (assignment.profiles as any)?.full_name || 'Unknown'
          } : null
        };
      });

      // Fetch housekeeping staff
      const { data: staffData, error: staffError } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .eq('role', 'housekeeping')
        .order('full_name');

      if (staffError) throw staffError;

      setRooms(roomsWithAssignments);
      setStaff(staffData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load data');
    }
  };

  const checkoutRooms = rooms.filter(r => r.is_checkout_room);
  const dailyRooms = rooms.filter(r => !r.is_checkout_room);

  const toggleRoom = (roomId: string) => {
    setSelectedRooms(prev =>
      prev.includes(roomId) ? prev.filter(id => id !== roomId) : [...prev, roomId]
    );
  };

  const selectAll = () => {
    const unassignedRoomIds = rooms
      .filter(r => !r.existing_assignment)
      .map(r => r.id);
    setSelectedRooms(unassignedRoomIds);
  };

  const clearAll = () => setSelectedRooms([]);

  const unassignRoom = async (assignmentId: string, roomNumber: string) => {
    try {
      const { error } = await supabase
        .from('room_assignments')
        .delete()
        .eq('id', assignmentId);

      if (error) throw error;

      toast.success(`Room ${roomNumber} unassigned successfully`);
      fetchData();
    } catch (error) {
      console.error('Error unassigning room:', error);
      toast.error('Failed to unassign room');
    }
  };

  const assignRooms = async () => {
    if (!selectedStaff) {
      toast.error('Please select a housekeeper first');
      return;
    }

    if (selectedRooms.length === 0) {
      toast.error('Please select at least one room');
      return;
    }

    if (!user?.id) {
      toast.error('User not properly authenticated');
      return;
    }

    setLoading(true);
    try {
      const assignments = selectedRooms.map(roomId => {
        const room = rooms.find(r => r.id === roomId);
        const isCheckout = room?.is_checkout_room || false;

        return {
          room_id: roomId,
          assigned_to: selectedStaff,
          assigned_by: user.id,
          assignment_date: selectedDate,
          assignment_type: (isCheckout ? 'checkout_cleaning' : 'daily_cleaning') as 'checkout_cleaning' | 'daily_cleaning',
          ready_to_clean: !isCheckout,
          priority: isCheckout ? 2 : 1,
          estimated_duration: parseInt(estimatedDuration) || 30,
          notes: notes.trim() || null
        };
      });

      const { error } = await supabase
        .from('room_assignments')
        .insert(assignments);

      if (error) throw error;

      const staffMember = staff.find(s => s.id === selectedStaff);
      toast.success(`Assigned ${assignments.length} room(s) to ${staffMember?.full_name}`);
      
      setSelectedRooms([]);
      setNotes('');
      onAssignmentCreated();
      fetchData();
    } catch (error) {
      console.error('Error creating assignments:', error);
      toast.error('Failed to create assignments');
    } finally {
      setLoading(false);
    }
  };

  const RoomCard = ({ room }: { room: Room }) => {
    const isSelected = selectedRooms.includes(room.id);
    const isAssigned = !!room.existing_assignment;

    return (
      <div
        className={`border rounded-lg p-3 transition-colors ${
          isSelected ? 'bg-blue-50 border-blue-300' : 'bg-background border-border'
        } ${isAssigned ? 'opacity-75' : ''}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            {!isAssigned && (
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => toggleRoom(room.id)}
                className="mt-1"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{room.room_number}</div>
              <div className="text-xs text-muted-foreground">
                {room.room_name || 'Standard'} • Floor {room.floor_number || '?'}
              </div>
              {isAssigned && (
                <div className="flex items-center gap-1 text-xs text-orange-600 mt-1">
                  <User className="h-3 w-3" />
                  <span>Already assigned to {room.existing_assignment?.staff_name}</span>
                </div>
              )}
            </div>
          </div>
          {isAssigned && (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-7 px-2"
              onClick={() => unassignRoom(room.existing_assignment!.id, room.room_number)}
            >
              Unassign
            </Button>
          )}
        </div>
      </div>
    );
  };

  const totalRooms = rooms.length;
  const unassignedCount = rooms.filter(r => !r.existing_assignment).length;

  return (
    <div className="space-y-6">
      {/* Assignment Details Section */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Assignment Details</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Assign to Staff</label>
            <Select value={selectedStaff} onValueChange={setSelectedStaff}>
              <SelectTrigger>
                <SelectValue placeholder="Select housekeeping staff" />
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

          <div className="space-y-2">
            <label className="text-sm font-medium">Estimated Duration</label>
            <Select value={estimatedDuration} onValueChange={setEstimatedDuration}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 minutes</SelectItem>
                <SelectItem value="30">30 minutes</SelectItem>
                <SelectItem value="45">45 minutes</SelectItem>
                <SelectItem value="60">60 minutes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Notes (Optional)</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any special instructions or notes for the housekeeper..."
            className="min-h-[80px] resize-none"
          />
        </div>
      </div>

      {/* Room Selection Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            Select Rooms ({selectedRooms.length} selected)
          </h3>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={selectAll}>
              Select All
            </Button>
            <Button variant="outline" size="sm" onClick={clearAll}>
              Clear All
            </Button>
          </div>
        </div>

        {rooms.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8 text-muted-foreground">
              <p>No dirty rooms available for assignment</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Hotel Grouping */}
            {Array.from(new Set(rooms.map(r => r.hotel))).map(hotel => {
              const hotelRooms = rooms.filter(r => r.hotel === hotel);
              const hotelCheckoutRooms = hotelRooms.filter(r => r.is_checkout_room);
              const hotelDailyRooms = hotelRooms.filter(r => !r.is_checkout_room);

              return (
                <Card key={hotel}>
                  <CardContent className="p-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <h4 className="font-semibold">{hotel} ({hotelRooms.length} rooms)</h4>
                    </div>

                    {/* Checkout Rooms Section */}
                    {hotelCheckoutRooms.length > 0 && (
                      <div className="space-y-3">
                        <h5 className="text-sm font-medium text-orange-600 flex items-center gap-2">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                          </svg>
                          Checkout Rooms ({hotelCheckoutRooms.length})
                        </h5>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {hotelCheckoutRooms.map(room => (
                            <RoomCard key={room.id} room={room} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Daily Cleaning Rooms Section */}
                    {hotelDailyRooms.length > 0 && (
                      <div className="space-y-3">
                        <h5 className="text-sm font-medium text-blue-600 flex items-center gap-2">
                          <User className="h-4 w-4" />
                          Daily Cleaning Rooms ({hotelDailyRooms.length})
                        </h5>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {hotelDailyRooms.map(room => (
                            <RoomCard key={room.id} room={room} />
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Assignment Button */}
      {selectedRooms.length > 0 && (
        <div className="sticky bottom-0 bg-background border-t pt-4">
          <Button
            onClick={assignRooms}
            disabled={loading || !selectedStaff}
            className="w-full"
            size="lg"
          >
            {loading ? 'Assigning...' : `Assign ${selectedRooms.length} Room(s) to Staff`}
          </Button>
        </div>
      )}
    </div>
  );
}
