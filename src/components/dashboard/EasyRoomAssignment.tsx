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
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
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

  const toggleRoom = (roomId: string) => {
    setSelectedRooms(prev => prev.includes(roomId) ? prev.filter(id => id !== roomId) : [...prev, roomId]);
  };

  const selectAll = () => setSelectedRooms(rooms.map(r => r.id));
  const clearAll = () => setSelectedRooms([]);

  const assignSelectedRooms = async () => {
    if (!selectedStaff) return toast.error('Please select a housekeeper first');
    if (selectedRooms.length === 0) return toast.error('Select at least one room');

    setLoading(true);
    try {
      const assignments = selectedRooms.map(roomId => ({
        room_id: roomId,
        assigned_to: selectedStaff,
        assigned_by: user?.id as string,
        assignment_date: selectedDate,
        assignment_type: 'daily_cleaning' as const,
        priority: 1,
        estimated_duration: 30,
        notes: 'Quick assignment - selected rooms'
      }));

      const { error } = await supabase
        .from('room_assignments')
        .insert(assignments as any);

      if (error) throw error;

      toast.success(`Assigned ${assignments.length} room(s)`);
      onAssignmentCreated();
      clearAll();
      fetchData();
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
          Select a housekeeper, pick rooms, then assign
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

        {/* Rooms Selection */}
        {rooms.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Dirty Rooms to Assign</h3>
              <Badge variant="outline" className="text-orange-600 border-orange-200">
                {rooms.length} rooms total
              </Badge>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={selectAll}>Select All</Button>
              <Button variant="outline" size="sm" onClick={clearAll}>Clear</Button>
            </div>

            {/* Room Grid */}
            <div className="bg-muted/50 p-4 rounded-lg space-y-3">
              {Object.entries(groupedRooms).map(([hotel, hotelRooms]) => (
                <div key={hotel} className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">{hotel}</h4>
                  <div className="flex flex-wrap gap-2">
                    {hotelRooms.map((room) => {
                      const checked = selectedRooms.includes(room.id);
                      return (
                        <button
                          type="button"
                          key={room.id}
                          onClick={() => toggleRoom(room.id)}
                          className={`px-3 py-1 rounded-full text-xs border transition ${
                            checked ? 'bg-blue-600 text-white border-blue-600' : 'bg-background border-muted'
                          }`}
                          aria-pressed={checked}
                        >
                          {room.room_number}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Assign Action */}
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-blue-900">Ready to Assign</h4>
                  <p className="text-sm text-blue-700">
                    {selectedRooms.length} room(s) selected
                  </p>
                </div>
                <Button
                  onClick={assignSelectedRooms}
                  disabled={loading || !selectedStaff || selectedRooms.length === 0}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  {loading ? 'Assigning...' : 'Assign Selected'}
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
          <p><strong>How it works:</strong> Select a housekeeper, choose individual rooms, then click "Assign Selected".</p>
        </div>
      </CardContent>
    </Card>
  );
}
