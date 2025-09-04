import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { MapPin, User, Clock, Calendar, LogOut } from 'lucide-react';

interface RoomAssignmentDialogProps {
  onAssignmentCreated: () => void;
  selectedDate: string;
}

interface Room {
  id: string;
  room_number: string;
  hotel: string;
  status: string;
  room_name?: string;
  floor_number?: number;
  is_checkout_room: boolean;
  checkout_time?: string;
  guest_count?: number;
}

interface HousekeepingStaff {
  id: string;
  full_name: string;
  nickname: string;
}

export function RoomAssignmentDialog({ onAssignmentCreated, selectedDate }: RoomAssignmentDialogProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [staff, setStaff] = useState<HousekeepingStaff[]>([]);
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>('');
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
        .select('id, room_number, hotel, status, room_name, floor_number, is_checkout_room, checkout_time, guest_count')
        .eq('status', 'dirty')
        .order('hotel')
        .order('room_number');

      if (error) throw error;
      setRooms(data || []);
    } catch (error) {
      console.error('Error fetching rooms:', error);
      toast({
        title: 'Error',
        description: 'Failed to load rooms',
        variant: 'destructive',
      });
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
      toast({
        title: 'Error',
        description: 'Failed to load housekeeping staff',
        variant: 'destructive',
      });
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
      toast({
        title: t('common.error'),
        description: t('assignment.selectStaffAndRooms'),
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Determine assignment type based on room type automatically
      const assignments = selectedRooms.map(roomId => {
        const room = rooms.find(r => r.id === roomId);
        const assignmentType: 'checkout_cleaning' | 'daily_cleaning' = room?.is_checkout_room ? 'checkout_cleaning' : 'daily_cleaning';
        
        return {
          room_id: roomId,
          assigned_to: selectedStaff,
          assigned_by: user?.id,
          assignment_date: selectedDate,
          assignment_type: assignmentType,
          priority: 2, // Standard priority for all housekeeping tasks
          estimated_duration: estimatedDuration,
          notes: notes.trim() || null
        };
      });

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
              assignmentType: 'mixed', // Since we have automatic assignment based on room type
              totalRooms: selectedRooms.length
            }
          });
        } catch (notificationError) {
          console.error('Error sending notification:', notificationError);
          // Don't fail the assignment if notification fails
        }
      }

      toast({
        title: t('common.success'),
        description: `Successfully assigned ${selectedRooms.length} rooms to ${selectedStaffMember?.full_name}`,
      });
      onAssignmentCreated();
      
      // Reset form
      setSelectedRooms([]);
      setSelectedStaff('');
      setNotes('');
      setEstimatedDuration(30);
    } catch (error) {
      console.error('Error creating assignments:', error);
      toast({
        title: t('common.error'),
        description: t('assignment.createError'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Group rooms by hotel and type
  const groupedRooms = rooms.reduce((groups, room) => {
    if (!groups[room.hotel]) {
      groups[room.hotel] = { checkout: [], daily: [] };
    }
    if (room.is_checkout_room) {
      groups[room.hotel].checkout.push(room);
    } else {
      groups[room.hotel].daily.push(room);
    }
    return groups;
  }, {} as Record<string, { checkout: Room[]; daily: Room[] }>);

  return (
    <div className="space-y-6">
      {/* Assignment Configuration */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">{t('assignment.details')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('assignment.assignToStaff')}</label>
            <Select value={selectedStaff} onValueChange={setSelectedStaff}>
              <SelectTrigger>
                <SelectValue placeholder={t('assignment.selectStaff')} />
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
            <label className="text-sm font-medium">{t('assignment.estimatedDuration')}</label>
            <Select value={estimatedDuration.toString()} onValueChange={(v) => setEstimatedDuration(parseInt(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">{t('assignment.duration.15min')}</SelectItem>
                <SelectItem value="30">{t('assignment.duration.30min')}</SelectItem>
                <SelectItem value="45">{t('assignment.duration.45min')}</SelectItem>
                <SelectItem value="60">{t('assignment.duration.1hour')}</SelectItem>
                <SelectItem value="90">{t('assignment.duration.1hour30min')}</SelectItem>
                <SelectItem value="120">{t('assignment.duration.2hours')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">{t('assignment.notes')}</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('assignment.notesPlaceholder')}
            rows={3}
          />
        </div>
      </div>

      {/* Room Selection */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">{t('assignment.selectRooms')} ({selectedRooms.length} {t('assignment.selected')})</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={selectAllRooms}>
              {t('assignment.selectAll')}
            </Button>
            <Button size="sm" variant="outline" onClick={clearSelection}>
              {t('assignment.clearAll')}
            </Button>
          </div>
        </div>

        <div className="space-y-6 max-h-96 overflow-y-auto">
          {Object.entries(groupedRooms).map(([hotel, { checkout, daily }]) => (
            <div key={hotel} className="border rounded-lg p-4">
              <h3 className="font-semibold mb-4 flex items-center">
                <MapPin className="h-4 w-4 mr-2" />
                {hotel} ({checkout.length + daily.length} rooms)
              </h3>
              
              {/* Checkout Rooms */}
              {checkout.length > 0 && (
                <div className="mb-4">
                  <h4 className="font-medium text-orange-600 mb-2 flex items-center">
                    <LogOut className="h-4 w-4 mr-1" />
                    {t('assignment.checkoutRooms')} ({checkout.length})
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {checkout.map((room) => (
                      <label key={room.id} className="flex items-center space-x-3 p-3 border border-orange-200 bg-orange-50 rounded-lg cursor-pointer hover:bg-orange-100">
                        <Checkbox
                          checked={selectedRooms.includes(room.id)}
                          onCheckedChange={(checked) => handleRoomSelection(room.id, checked as boolean)}
                        />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">Room {room.room_number}</span>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {room.room_name || `${room.room_number}-${room.hotel.substring(0, 15)}`}
                            {room.floor_number && ` • Floor ${room.floor_number}`}
                          </div>
                          <div className="text-xs text-orange-600 mt-1 flex items-center">
                            <LogOut className="h-3 w-3 mr-1" />
                            {t('assignment.checkoutRoom')}
                            {room.guest_count && room.guest_count > 0 && (
                              <span className="ml-2 flex items-center">
                                <User className="h-3 w-3 mr-1" />
                                {room.guest_count}
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Daily Cleaning Rooms */}
              {daily.length > 0 && (
                <div>
                  <h4 className="font-medium text-blue-600 mb-2 flex items-center">
                    <User className="h-4 w-4 mr-1" />
                    {t('assignment.dailyCleaningRooms')} ({daily.length})
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {daily.map((room) => (
                      <label key={room.id} className="flex items-center space-x-3 p-3 border border-blue-200 bg-blue-50 rounded-lg cursor-pointer hover:bg-blue-100">
                        <Checkbox
                          checked={selectedRooms.includes(room.id)}
                          onCheckedChange={(checked) => handleRoomSelection(room.id, checked as boolean)}
                        />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">Room {room.room_number}</span>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {room.room_name || `${room.room_number}-${room.hotel.substring(0, 15)}`}
                            {room.floor_number && ` • Floor ${room.floor_number}`}
                          </div>
                          <div className="text-xs text-blue-600 mt-1 flex items-center">
                            <User className="h-3 w-3 mr-1" />
                            {t('assignment.dailyCleaning')}
                            {room.guest_count && room.guest_count > 0 && (
                              <span className="ml-2 flex items-center">
                                <User className="h-3 w-3 mr-1" />
                                {room.guest_count}
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Create Button */}
      <div className="flex justify-end">
        <Button
          onClick={createAssignments}
          disabled={loading || !selectedStaff || selectedRooms.length === 0}
          size="lg"
        >
          {loading ? t('assignment.creating') : `${t('assignment.assign')} ${selectedRooms.length} ${t('assignment.rooms')}`}
        </Button>
      </div>
    </div>
  );
}