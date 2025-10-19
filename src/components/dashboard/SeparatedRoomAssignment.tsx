import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Calendar, Clock, Bed } from 'lucide-react';

interface Room {
  id: string;
  room_number: string;
  status: string;
  hotel: string;
  is_checkout_room: boolean;
}

interface Staff {
  id: string;
  full_name: string;
  nickname?: string;
}

interface SeparatedRoomAssignmentProps {
  onAssignmentCreated: () => void;
}

export function SeparatedRoomAssignment({ onAssignmentCreated }: SeparatedRoomAssignmentProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaffCheckout, setSelectedStaffCheckout] = useState<string>('');
  const [selectedStaffDaily, setSelectedStaffDaily] = useState<string>('');
  const [selectedCheckoutRooms, setSelectedCheckoutRooms] = useState<string[]>([]);
  const [selectedDailyRooms, setSelectedDailyRooms] = useState<string[]>([]);
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
        .select('id, room_number, status, hotel, is_checkout_room')
        .eq('status', 'dirty')
        .order('hotel')
        .order('room_number');

      if (roomsError) throw roomsError;

      // Fetch active assignments to exclude already assigned rooms
      const { data: activeAssignments, error: assignmentError } = await supabase
        .from('room_assignments')
        .select('room_id')
        .eq('assignment_date', selectedDate)
        .in('status', ['assigned', 'in_progress']);

      if (assignmentError) throw assignmentError;

      const activeAssignedRoomIds = new Set(activeAssignments?.map(a => a.room_id) || []);
      const availableRooms = (roomsData || []).filter(room => !activeAssignedRoomIds.has(room.id));

      // Fetch housekeeping staff
      const { data: staffData, error: staffError } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .eq('role', 'housekeeping')
        .order('full_name');

      if (staffError) throw staffError;

      setRooms(availableRooms);
      setStaff(staffData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load data');
    }
  };

  const checkoutRooms = rooms.filter(r => r.is_checkout_room);
  const dailyRooms = rooms.filter(r => !r.is_checkout_room);

  const toggleRoomSelection = (roomId: string, type: 'checkout' | 'daily') => {
    if (type === 'checkout') {
      setSelectedCheckoutRooms(prev =>
        prev.includes(roomId) ? prev.filter(id => id !== roomId) : [...prev, roomId]
      );
    } else {
      setSelectedDailyRooms(prev =>
        prev.includes(roomId) ? prev.filter(id => id !== roomId) : [...prev, roomId]
      );
    }
  };

  const selectAllRooms = (type: 'checkout' | 'daily') => {
    if (type === 'checkout') {
      setSelectedCheckoutRooms(checkoutRooms.map(r => r.id));
    } else {
      setSelectedDailyRooms(dailyRooms.map(r => r.id));
    }
  };

  const clearSelection = (type: 'checkout' | 'daily') => {
    if (type === 'checkout') {
      setSelectedCheckoutRooms([]);
    } else {
      setSelectedDailyRooms([]);
    }
  };

  const handleAssign = async (type: 'checkout' | 'daily') => {
    const selectedStaff = type === 'checkout' ? selectedStaffCheckout : selectedStaffDaily;
    const selectedRoomIds = type === 'checkout' ? selectedCheckoutRooms : selectedDailyRooms;

    if (!selectedStaff) {
      toast.error('Please select a housekeeper first');
      return;
    }

    if (selectedRoomIds.length === 0) {
      toast.error('Please select at least one room');
      return;
    }

    if (!user?.id) {
      toast.error('User not properly authenticated. Please refresh the page.');
      return;
    }

    setLoading(true);
    try {
      const assignments = selectedRoomIds.map(roomId => ({
        room_id: roomId,
        assigned_to: selectedStaff,
        assigned_by: user.id,
        assignment_date: selectedDate,
        assignment_type: (type === 'checkout' ? 'checkout_cleaning' : 'daily_cleaning') as 'checkout_cleaning' | 'daily_cleaning',
        priority: type === 'checkout' ? 2 : 1,
        estimated_duration: type === 'checkout' ? 45 : 30,
        ready_to_clean: false
      }));

      const { error } = await supabase
        .from('room_assignments')
        .insert(assignments);

      if (error) throw error;

      // Send notifications
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
          console.log('Failed to send notification:', notificationError);
        }
      }

      const staffMember = staff.find(s => s.id === selectedStaff);
      toast.success(`Assigned ${assignments.length} room(s) to ${staffMember?.full_name}`);

      // Clear selections
      if (type === 'checkout') {
        setSelectedCheckoutRooms([]);
      } else {
        setSelectedDailyRooms([]);
      }

      onAssignmentCreated();
      fetchData();
    } catch (error) {
      console.error('Error creating assignments:', error);
      toast.error('Failed to create assignments');
    } finally {
      setLoading(false);
    }
  };

  const groupRoomsByHotel = (roomList: Room[]) => {
    return roomList.reduce((groups, room) => {
      if (!groups[room.hotel]) {
        groups[room.hotel] = [];
      }
      groups[room.hotel].push(room);
      return groups;
    }, {} as Record<string, Room[]>);
  };

  const RoomSection = ({ 
    title, 
    rooms, 
    selectedRooms, 
    selectedStaff,
    onStaffChange,
    type,
    color
  }: {
    title: string;
    rooms: Room[];
    selectedRooms: string[];
    selectedStaff: string;
    onStaffChange: (value: string) => void;
    type: 'checkout' | 'daily';
    color: string;
  }) => {
    const groupedRooms = groupRoomsByHotel(rooms);

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className={color}>{title}</span>
            <Badge variant={type === 'checkout' ? 'destructive' : 'secondary'}>
              {rooms.length} {t('rooms')}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Staff Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('quickAssign.selectHousekeeper')}</label>
            <Select value={selectedStaff} onValueChange={onStaffChange}>
              <SelectTrigger>
                <SelectValue placeholder={t('quickAssign.chooseHousekeeper')} />
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

          {/* Rooms List */}
          {rooms.length > 0 ? (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Select Rooms</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => selectAllRooms(type)}>
                    Select All
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => clearSelection(type)}>
                    Clear
                  </Button>
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-3 p-3 bg-muted/30 rounded-lg">
                {Object.entries(groupedRooms).map(([hotel, hotelRooms]) => (
                  <div key={hotel} className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">{hotel}</h4>
                    <div className="grid grid-cols-4 gap-2">
                      {hotelRooms.map((room) => (
                        <div
                          key={room.id}
                          className={`flex items-center gap-2 p-2 border rounded cursor-pointer hover:bg-background transition ${
                            selectedRooms.includes(room.id) ? 'bg-blue-50 border-blue-300' : 'bg-background'
                          }`}
                          onClick={() => toggleRoomSelection(room.id, type)}
                        >
                          <Checkbox
                            checked={selectedRooms.includes(room.id)}
                            onCheckedChange={() => {}}
                          />
                          <span className="text-sm font-medium">{room.room_number}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <Button
                onClick={() => handleAssign(type)}
                disabled={loading || !selectedStaff || selectedRooms.length === 0}
                className="w-full"
                variant={type === 'checkout' ? 'default' : 'secondary'}
              >
                {type === 'checkout' ? <Clock className="h-4 w-4 mr-2" /> : <Calendar className="h-4 w-4 mr-2" />}
                {t('assignBtn')} {selectedRooms.length} {t('selectedRooms')}
              </Button>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Bed className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No {type} rooms available</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <RoomSection
        title={t('pms.checkoutToday')}
        rooms={checkoutRooms}
        selectedRooms={selectedCheckoutRooms}
        selectedStaff={selectedStaffCheckout}
        onStaffChange={setSelectedStaffCheckout}
        type="checkout"
        color="text-orange-700"
      />
      <RoomSection
        title={t('pms.stayingGuests')}
        rooms={dailyRooms}
        selectedRooms={selectedDailyRooms}
        selectedStaff={selectedStaffDaily}
        onStaffChange={setSelectedStaffDaily}
        type="daily"
        color="text-blue-700"
      />
    </div>
  );
}
