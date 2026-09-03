import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOperationalHotel } from '@/hooks/useOperationalHotel';
import { hasManagerPowers } from '@/lib/roleAccess';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { MapPin, User, LogOut } from 'lucide-react';

interface RoomAssignmentDialogProps {
  onAssignmentCreated: (roomCount?: number, staffCount?: number) => void;
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
  pms_metadata?: any;
  assignment?: {
    id: string;
    assigned_to_name: string;
    assignment_date: string;
    status: string;
  };
}

interface HousekeepingStaff {
  id: string;
  full_name: string;
  nickname?: string | null;
}

export function RoomAssignmentDialog({ onAssignmentCreated, selectedDate }: RoomAssignmentDialogProps) {
  const { user, profile } = useAuth();
  const { hotelKeys, orgSlug, role, ready } = useOperationalHotel();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [staff, setStaff] = useState<HousekeepingStaff[]>([]);
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [estimatedDuration, setEstimatedDuration] = useState<number>(30);
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const scopeRequestRef = useRef(0);
  const activeHotel = profile?.assigned_hotel ?? null;
  const activeHotelKeys = hotelKeys.join('|');

  useEffect(() => {
    // A manager can keep different properties open in different browser tabs.
    // Clear any selection immediately when the tab's active property/date changes,
    // then reload strictly from the tab-aware operational hotel context.
    const requestId = ++scopeRequestRef.current;
    setSelectedRooms([]);
    setSelectedStaff('');

    if (!ready || !orgSlug || hotelKeys.length === 0) {
      setRooms([]);
      setStaff([]);
      return;
    }

    void fetchRooms(requestId);
    void fetchStaff(requestId);
  }, [selectedDate, activeHotel, activeHotelKeys, orgSlug, ready]);

  const fetchRooms = async (requestId = scopeRequestRef.current) => {
    try {
      if (!orgSlug || hotelKeys.length === 0) {
        if (requestId === scopeRequestRef.current) setRooms([]);
        return;
      }

      // IMPORTANT: use the tab-aware hotel aliases from useOperationalHotel.
      // Re-reading profiles.assigned_hotel here is unsafe because that database
      // field is global to the account while HotelCare intentionally supports a
      // different selected property per browser tab.
      const { data, error } = await supabase
        .from('rooms')
        .select('id, room_number, hotel, status, room_name, floor_number, is_checkout_room, checkout_time, guest_count, pms_metadata, organization_slug')
        .eq('status', 'dirty')
        .eq('organization_slug', orgSlug)
        .in('hotel', hotelKeys)
        .order('hotel')
        .order('room_number');

      if (error) throw error;
      if (requestId !== scopeRequestRef.current) return;

      const roomIds = (data || []).map(room => room.id);
      let assignments: Array<{
        id: string;
        room_id: string;
        assignment_date: string;
        status: string;
        assigned_to: string;
      }> = [];

      // Fetch active assignments only for rooms in the currently selected hotel.
      // This avoids cross-property assignment data even for portfolio managers.
      if (roomIds.length > 0) {
        const { data: assignmentData, error: assignmentError } = await supabase
          .from('room_assignments')
          .select('id, room_id, assignment_date, status, assigned_to')
          .eq('assignment_date', selectedDate)
          .in('status', ['assigned', 'in_progress'])
          .in('room_id', roomIds);

        if (assignmentError) throw assignmentError;
        assignments = assignmentData || [];
      }

      if (requestId !== scopeRequestRef.current) return;

      // Get staff names for the assignments while keeping the lookup inside the
      // current organization. RLS provides an additional tenant boundary.
      const assignedUserIds = Array.from(new Set(assignments.map(a => a.assigned_to).filter(Boolean)));
      let staffNames: Record<string, string> = {};

      if (assignedUserIds.length > 0) {
        const { data: staffData, error: staffNameError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .eq('organization_slug', orgSlug)
          .in('id', assignedUserIds);

        if (staffNameError) throw staffNameError;
        staffNames = staffData?.reduce((acc, staffMember) => {
          acc[staffMember.id] = staffMember.full_name;
          return acc;
        }, {} as Record<string, string>) || {};
      }

      if (requestId !== scopeRequestRef.current) return;

      const roomsWithAssignments = (data || []).map(room => {
        const assignment = assignments.find(a => a.room_id === room.id);
        return {
          ...room,
          assignment: assignment ? {
            id: assignment.id,
            assigned_to_name: staffNames[assignment.assigned_to] || 'Unknown',
            assignment_date: assignment.assignment_date,
            status: assignment.status
          } : undefined
        };
      });

      setRooms(roomsWithAssignments);
    } catch (error) {
      if (requestId !== scopeRequestRef.current) return;
      console.error('Error fetching rooms:', error);
      toast({
        title: 'Error',
        description: 'Failed to load rooms',
        variant: 'destructive',
      });
    }
  };

  const fetchStaff = async (requestId = scopeRequestRef.current) => {
    try {
      if (!orgSlug || hotelKeys.length === 0 || !hasManagerPowers(role)) {
        if (requestId === scopeRequestRef.current) setStaff([]);
        return;
      }

      // Do not call get_assignable_staff_secure here: that legacy RPC reads the
      // raw profiles.assigned_hotel value and therefore has the same cross-tab
      // property leak as the old room query. Query the active tab's hotel aliases
      // explicitly; profile RLS still enforces organization access.
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .eq('organization_slug', orgSlug)
        .in('assigned_hotel', hotelKeys)
        .or('role.eq.housekeeping,acts_as_housekeeper.eq.true')
        .order('full_name');

      if (error) throw error;
      if (requestId !== scopeRequestRef.current) return;
      setStaff(data || []);
    } catch (error) {
      if (requestId !== scopeRequestRef.current) return;
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
    const availableRooms = rooms.filter(room => !room.assignment);
    setSelectedRooms(availableRooms.map(room => room.id));
  };

  const clearSelection = () => {
    setSelectedRooms([]);
  };

  const createAssignments = async () => {
    console.log('createAssignments called', { selectedStaff, selectedRooms, user });

    if (!selectedStaff || selectedRooms.length === 0) {
      console.log('Validation failed: missing staff or rooms', { selectedStaff, selectedRoomsCount: selectedRooms.length });
      toast({
        title: t('common.error'),
        description: t('assignment.selectStaffAndRooms'),
        variant: 'destructive',
      });
      return;
    }

    if (!user?.id) {
      console.error('User ID is missing:', user);
      toast({
        title: 'Error',
        description: 'User not properly authenticated. Please refresh the page.',
        variant: 'destructive',
      });
      return;
    }

    if (!orgSlug) {
      toast({
        title: 'Error',
        description: 'User organization not found. Please refresh the page.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Determine assignment type based on room type automatically
      const assignments = selectedRooms.map(roomId => {
        const room = rooms.find(r => r.id === roomId);
        const assignmentType: 'checkout_cleaning' | 'daily_cleaning' = room?.is_checkout_room || room?.pms_metadata?.scheduledDepartureToday ? 'checkout_cleaning' : 'daily_cleaning';
        // Daily rooms are ready immediately. Checkout rooms must always start
        // blocked and can only be released manually by eligible staff, or by
        // the dedicated Previo checkout poll for the test hotel.
        const readyToClean = assignmentType !== 'checkout_cleaning';

        return {
          room_id: roomId,
          assigned_to: selectedStaff,
          assigned_by: user.id,
          assignment_date: selectedDate,
          assignment_type: assignmentType,
          priority: 2,
          estimated_duration: estimatedDuration,
          notes: notes.trim() || null,
          ready_to_clean: readyToClean,
          organization_slug: orgSlug
        };
      });

      console.log('Creating assignments:', assignments);

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
              assignmentType: 'mixed',
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
      onAssignmentCreated(selectedRooms.length, 1);

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

  const handleUnassignRoom = async (assignmentId: string) => {
    try {
      const { error } = await supabase
        .from('room_assignments')
        .delete()
        .eq('id', assignmentId);

      if (error) throw error;

      toast({
        title: t('common.success'),
        description: 'Room assignment removed successfully',
      });

      // Refresh rooms to update assignment status
      void fetchRooms();
      onAssignmentCreated(); // Refresh parent component
    } catch (error) {
      console.error('Error unassigning room:', error);
      toast({
        title: t('common.error'),
        description: 'Failed to remove room assignment',
        variant: 'destructive',
      });
    }
  };

  // Group rooms by hotel and type
  const groupedRooms = rooms.reduce((groups, room) => {
    if (!groups[room.hotel]) {
      groups[room.hotel] = { checkout: [], daily: [] };
    }
    if (room.is_checkout_room || room.pms_metadata?.scheduledDepartureToday) {
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
                      <label key={room.id} className={`flex items-center space-x-3 p-3 border rounded-lg ${
                        room.assignment
                          ? 'border-gray-300 bg-gray-100 opacity-60 cursor-not-allowed'
                          : 'border-orange-200 bg-orange-50 cursor-pointer hover:bg-orange-100'
                      }`}>
                        <Checkbox
                          checked={selectedRooms.includes(room.id)}
                          onCheckedChange={(checked) => handleRoomSelection(room.id, checked as boolean)}
                          disabled={!!room.assignment}
                        />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">Room {room.room_number}</span>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {room.room_name || `${room.room_number}-${room.hotel.substring(0, 15)}`}
                            {room.floor_number && ` • Floor ${room.floor_number}`}
                          </div>
                          {room.assignment ? (
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-red-600 mt-1 flex items-center">
                                <User className="h-3 w-3 mr-1" />
                                Already assigned to {room.assignment.assigned_to_name}
                              </div>
                              {hasManagerPowers(role) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={async (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    await handleUnassignRoom(room.assignment!.id);
                                  }}
                                  className="h-6 px-2 text-xs"
                                >
                                  Unassign
                                </Button>
                              )}
                            </div>
                          ) : (
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
                          )}
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
                      <label key={room.id} className={`flex items-center space-x-3 p-3 border rounded-lg ${
                        room.assignment
                          ? 'border-gray-300 bg-gray-100 opacity-60 cursor-not-allowed'
                          : 'border-blue-200 bg-blue-50 cursor-pointer hover:bg-blue-100'
                      }`}>
                        <Checkbox
                          checked={selectedRooms.includes(room.id)}
                          onCheckedChange={(checked) => handleRoomSelection(room.id, checked as boolean)}
                          disabled={!!room.assignment}
                        />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">Room {room.room_number}</span>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {room.room_name || `${room.room_number}-${room.hotel.substring(0, 15)}`}
                            {room.floor_number && ` • Floor ${room.floor_number}`}
                          </div>
                          {room.assignment ? (
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-red-600 mt-1 flex items-center">
                                <User className="h-3 w-3 mr-1" />
                                Already assigned to {room.assignment.assigned_to_name}
                              </div>
                              {hasManagerPowers(role) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={async (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    await handleUnassignRoom(room.assignment!.id);
                                  }}
                                  className="h-6 px-2 text-xs"
                                >
                                  Unassign
                                </Button>
                              )}
                            </div>
                          ) : (
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
                          )}
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
