import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Building, Clock, AlertCircle } from 'lucide-react';

interface RoomAssignmentDialogProps {
  onAssignmentCreated: () => void;
  selectedDate: string;
}

interface Room {
  id: string;
  room_number: string;
  hotel: string;
  status: string;
  room_name: string;
  floor_number: number;
}

interface HousekeepingStaff {
  id: string;
  full_name: string;
  nickname: string;
}

export function RoomAssignmentDialog({ onAssignmentCreated, selectedDate }: RoomAssignmentDialogProps) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [staff, setStaff] = useState<HousekeepingStaff[]>([]);
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [assignmentType, setAssignmentType] = useState<'daily_cleaning' | 'checkout_cleaning' | 'maintenance' | 'deep_cleaning'>('daily_cleaning');
  const [priority, setPriority] = useState<number>(1);
  const [estimatedDuration, setEstimatedDuration] = useState<number>(30);
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchRooms();
    fetchStaff();
  }, []);

  const fetchRooms = async () => {
    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('id, room_number, hotel, status, room_name, floor_number')
        .order('hotel')
        .order('room_number');

      if (error) throw error;
      setRooms(data || []);
    } catch (error) {
      console.error('Error fetching rooms:', error);
      toast.error('Failed to load rooms');
    }
  };

  const fetchStaff = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .eq('role', 'housekeeping')
        .order('full_name');

      if (error) throw error;
      setStaff(data || []);
    } catch (error) {
      console.error('Error fetching staff:', error);
      toast.error('Failed to load housekeeping staff');
    }
  };

  const handleRoomSelection = (roomId: string, selected: boolean) => {
    if (selected) {
      setSelectedRooms(prev => [...prev, roomId]);
    } else {
      setSelectedRooms(prev => prev.filter(id => id !== roomId));
    }
  };

  const selectAllRooms = () => {
    setSelectedRooms(rooms.map(room => room.id));
  };

  const clearSelection = () => {
    setSelectedRooms([]);
  };

  const createAssignments = async () => {
    if (!selectedStaff || selectedRooms.length === 0) {
      toast.error('Please select staff and at least one room');
      return;
    }

    setLoading(true);
    try {
      // Create assignments for all selected rooms
      const assignments = selectedRooms.map(roomId => ({
        room_id: roomId,
        assigned_to: selectedStaff,
        assigned_by: user?.id,
        assignment_date: selectedDate,
        assignment_type: assignmentType,
        priority,
        estimated_duration: estimatedDuration,
        notes: notes.trim() || null
      }));

      const { error } = await supabase
        .from('room_assignments')
        .insert(assignments);

      if (error) throw error;

      // Send email notification
      const selectedStaffMember = staff.find(s => s.id === selectedStaff);
      if (selectedStaffMember) {
        const roomNumbers = selectedRooms
          .map(id => rooms.find(r => r.id === id)?.room_number)
          .filter(Boolean)
          .join(', ');

        try {
          await supabase.functions.invoke('send-assignment-notification', {
            body: {
              staffId: selectedStaff,
              staffName: selectedStaffMember.full_name,
              assignmentDate: selectedDate,
              roomNumbers,
              assignmentType,
              totalRooms: selectedRooms.length
            }
          });
        } catch (notificationError) {
          console.error('Error sending notification:', notificationError);
          // Don't fail the assignment if notification fails
        }
      }

      toast.success(`Successfully assigned ${selectedRooms.length} rooms to ${selectedStaffMember?.full_name}`);
      onAssignmentCreated();
      
      // Reset form
      setSelectedRooms([]);
      setSelectedStaff('');
      setNotes('');
      setPriority(1);
      setEstimatedDuration(30);
    } catch (error) {
      console.error('Error creating assignments:', error);
      toast.error('Failed to create assignments');
    } finally {
      setLoading(false);
    }
  };

  const getRoomStatusColor = (status: string) => {
    switch (status) {
      case 'clean':
        return 'text-green-600';
      case 'dirty':
        return 'text-red-600';
      case 'out_of_order':
        return 'text-gray-600';
      case 'maintenance':
        return 'text-orange-600';
      default:
        return 'text-gray-600';
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
    <div className="space-y-6">
      {/* Assignment Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Assignment Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
              <label className="text-sm font-medium">Assignment Type</label>
              <Select value={assignmentType} onValueChange={(value) => setAssignmentType(value as 'daily_cleaning' | 'checkout_cleaning' | 'maintenance' | 'deep_cleaning')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily_cleaning">Daily Cleaning</SelectItem>
                  <SelectItem value="checkout_cleaning">Checkout Cleaning</SelectItem>
                  <SelectItem value="deep_cleaning">Deep Cleaning</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Priority</label>
              <Select value={priority.toString()} onValueChange={(v) => setPriority(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Low Priority</SelectItem>
                  <SelectItem value="2">Medium Priority</SelectItem>
                  <SelectItem value="3">High Priority</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Estimated Duration (minutes)</label>
              <Select value={estimatedDuration.toString()} onValueChange={(v) => setEstimatedDuration(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 minutes</SelectItem>
                  <SelectItem value="30">30 minutes</SelectItem>
                  <SelectItem value="45">45 minutes</SelectItem>
                  <SelectItem value="60">1 hour</SelectItem>
                  <SelectItem value="90">1.5 hours</SelectItem>
                  <SelectItem value="120">2 hours</SelectItem>
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
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Room Selection */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Select Rooms ({selectedRooms.length} selected)</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={selectAllRooms}>
                Select All
              </Button>
              <Button size="sm" variant="outline" onClick={clearSelection}>
                Clear All
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {Object.entries(groupedRooms).map(([hotel, hotelRooms]) => (
              <div key={hotel} className="space-y-2">
                <div className="flex items-center gap-2 font-medium text-sm">
                  <Building className="h-4 w-4" />
                  {hotel}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pl-6">
                  {hotelRooms.map((room) => (
                    <div
                      key={room.id}
                      className="flex items-center space-x-2 p-2 border rounded-md hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={selectedRooms.includes(room.id)}
                        onCheckedChange={(checked) => handleRoomSelection(room.id, checked as boolean)}
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Room {room.room_number}</span>
                          <Badge
                            variant="outline"
                            className={getRoomStatusColor(room.status)}
                          >
                            {room.status}
                          </Badge>
                        </div>
                        {room.room_name && (
                          <p className="text-xs text-muted-foreground">{room.room_name}</p>
                        )}
                        <p className="text-xs text-muted-foreground">Floor {room.floor_number}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Create Button */}
      <div className="flex justify-end">
        <Button
          onClick={createAssignments}
          disabled={loading || !selectedStaff || selectedRooms.length === 0}
          size="lg"
        >
          {loading ? 'Creating Assignments...' : `Assign ${selectedRooms.length} Room(s)`}
        </Button>
      </div>
    </div>
  );
}