import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
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
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
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
      // Fetch dirty rooms filtered by manager's assigned hotel
      const { data: roomsData, error: roomsError } = await supabase
        .from('rooms')
        .select('id, room_number, status, hotel')
        .eq('status', 'dirty')
        .eq('hotel', profile.assigned_hotel)
        .order('room_number');

      // Fetch housekeeping staff filtered by same hotel and organization
      const { data: staffData, error: staffError } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .eq('role', 'housekeeping')
        .eq('assigned_hotel', profile.assigned_hotel)
        .eq('organization_slug', profile.organization_slug)
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
    console.log('assignSelectedRooms called', { selectedStaff, selectedRooms, user });
    
    if (!selectedStaff) return toast.error('Please select a housekeeper first');
    if (selectedRooms.length === 0) return toast.error('Select at least one room');
    
    if (!user?.id) {
      console.error('User ID is missing:', user);
      toast.error('User not properly authenticated. Please refresh the page.');
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

      const assignments = selectedRooms.map(roomId => ({
        room_id: roomId,
        assigned_to: selectedStaff,
        assigned_by: user.id,
        assignment_date: selectedDate,
        assignment_type: 'daily_cleaning' as const,
        priority: 1,
        estimated_duration: 30,
        notes: 'Quick assignment - selected rooms',
        organization_slug: profileData.organization_slug
      }));

      console.log('Creating assignments:', assignments);

      const { error } = await supabase
        .from('room_assignments')
        .insert(assignments as any);

      if (error) {
        console.error('Assignment error:', error);
        throw error;
      }

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
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <Zap className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
          {t('quickAssign.title')}
        </CardTitle>
        <p className="text-xs sm:text-sm text-muted-foreground">
          {t('quickAssign.subtitle')}
        </p>
      </CardHeader>
      <CardContent className="space-y-4 sm:space-y-6 p-4 sm:p-6">
        {/* Staff Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('quickAssign.chooseHousekeeper')}</label>
          <Select value={selectedStaff} onValueChange={setSelectedStaff}>
            <SelectTrigger>
              <SelectValue placeholder={t('quickAssign.selectHousekeeper')} />
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
            <div className="bg-blue-50 p-3 sm:p-4 rounded-lg border border-blue-200">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex-1">
                  <h4 className="font-medium text-blue-900 text-sm sm:text-base">{t('quickAssign.readyToAssign')}</h4>
                  <p className="text-xs sm:text-sm text-blue-700">
                    {selectedRooms.length} {t('quickAssign.roomsSelected')}
                  </p>
                </div>
                <Button
                  onClick={assignSelectedRooms}
                  disabled={loading || !selectedStaff || selectedRooms.length === 0}
                  className="bg-blue-600 hover:bg-blue-700 text-sm w-full sm:w-auto"
                >
                  <Calendar className="h-3 w-3 sm:h-4 sm:w-4 mr-2" />
                  {loading ? t('quickAssign.assigning') : t('quickAssign.assignSelected')}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 sm:py-8 text-muted-foreground">
            <Calendar className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 opacity-50" />
            <h3 className="font-medium mb-2 text-sm sm:text-base">{t('quickAssign.allRoomsClean')}</h3>
            <p className="text-xs sm:text-sm">{t('quickAssign.noRoomsFound')}</p>
          </div>
        )}

        <div className="text-xs text-muted-foreground bg-gray-50 p-3 rounded">
          <p><strong>{t('quickAssign.howItWorks')}</strong> {t('quickAssign.instructions')}</p>
        </div>
      </CardContent>
    </Card>
  );
}
