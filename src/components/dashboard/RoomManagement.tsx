import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { HotelFilter } from './HotelFilter';
import { MinimBarManagement } from './MinimBarManagement';
import { EnhancedRoomCardV2 } from './EnhancedRoomCardV2';
import { CompactRoomCard } from './CompactRoomCard';
import { OrganizedRoomCard } from './OrganizedRoomCard';
import { RoomDetailDialog } from './RoomDetailDialog';
import { BulkRoomCreation } from './BulkRoomCreation';
import { useIsMobile } from '@/hooks/use-mobile';
import { 
  Search, 
  Plus, 
  CheckCircle2, 
  AlertTriangle, 
  Settings, 
  Bed,
  MapPin,
  Clock,
  User,
  Wrench,
  Upload,
  Grid3X3
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface Room {
  id: string;
  hotel: string;
  room_number: string;
  room_name?: string;
  room_type: string;
  bed_type?: string;
  floor_number?: number;
  status: 'clean' | 'dirty' | 'out_of_order' | 'maintenance';
  last_cleaned_at?: string;
  last_cleaned_by?: {
    full_name: string;
  };
  notes?: string;
  created_at: string;
  updated_at: string;
}

interface RoomWithTickets extends Room {
  recent_tickets: Array<{
    id: string;
    ticket_number: string;
    title: string;
    priority: string;
    status: string;
    created_at: string;
  }>;
  minibar_usage: Array<{
    id: string;
    quantity_used: number;
    minibar_item: {
      name: string;
      price: number;
    };
  }>;
  is_checkout_room?: boolean;
  checkout_time?: string;
  guest_count?: number;
}

export function RoomManagement() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [rooms, setRooms] = useState<RoomWithTickets[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedHotel, setSelectedHotel] = useState('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [roomTypeFilter, setRoomTypeFilter] = useState<'all' | 'checkout' | 'daily'>('all');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [bulkCreateDialogOpen, setBulkCreateDialogOpen] = useState(false);
  const [minibarDialogOpen, setMinibarDialogOpen] = useState(false);
  const [newRoom, setNewRoom] = useState({
    hotel: '',
    room_number: '',
    room_name: '',
    room_type: 'standard',
    bed_type: 'double',
    floor_number: ''
  });
  const [hotels, setHotels] = useState<any[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<any>(null);
  const [roomDetailOpen, setRoomDetailOpen] = useState(false);
  const [activeStatusFilter, setActiveStatusFilter] = useState<string | null>(null);

  const isAdmin = profile?.role === 'admin';
  const canManageRooms = profile?.role && ['admin', 'manager', 'reception'].includes(profile.role);

  useEffect(() => {
    fetchRooms();
    fetchHotels();
  }, [profile]);

  const fetchRooms = async () => {
    setLoading(true);
    try {
      let roomsData: any[] | null = null;
      let error: any = null;

      const base = supabase.from('rooms');

      if (profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'housekeeping_manager') {
        let query = base
          .select('*, is_checkout_room, checkout_time, guest_count, last_cleaned_by_profile:profiles!rooms_last_cleaned_by_fkey(full_name)' as any);
        
        // Filter by assigned hotel - use direct match first
        if (profile.assigned_hotel) {
          query = query.eq('hotel', profile.assigned_hotel);
          console.log('🏨 Filtering rooms by assigned_hotel:', profile.assigned_hotel);
        }
        
        const res = await query
          .order('hotel', { ascending: true })
          .order('room_number', { ascending: true });
        roomsData = res.data;
        error = res.error;
        
        // Fallback: if direct match returns 0 results, try hotel_configurations lookup
        if ((!roomsData || roomsData.length === 0) && profile.assigned_hotel) {
          console.log('⚠️ Direct match returned 0 rooms, trying hotel_configurations fallback...');
          const { data: hotelConfigs } = await supabase
            .from('hotel_configurations')
            .select('hotel_id, hotel_name')
            .or(`hotel_id.eq.${profile.assigned_hotel},hotel_name.eq.${profile.assigned_hotel}`)
            .limit(1);
          
          if (hotelConfigs && hotelConfigs.length > 0) {
            const altName = hotelConfigs[0].hotel_name !== profile.assigned_hotel 
              ? hotelConfigs[0].hotel_name 
              : hotelConfigs[0].hotel_id;
            console.log('✅ Fallback: trying alternative hotel name:', altName);
            let fallbackQuery = base
              .select('*, is_checkout_room, checkout_time, guest_count, last_cleaned_by_profile:profiles!rooms_last_cleaned_by_fkey(full_name)' as any)
              .eq('hotel', altName);
            const fallbackRes = await fallbackQuery
              .order('hotel', { ascending: true })
              .order('room_number', { ascending: true });
            roomsData = fallbackRes.data;
            error = fallbackRes.error;
          }
        }
      } else {
        let query = base
          .select('*, is_checkout_room, checkout_time, guest_count');
        
        // Filter by assigned hotel - use direct match
        if (profile.assigned_hotel) {
          query = query.eq('hotel', profile.assigned_hotel);
          console.log('🏨 Filtering rooms by assigned_hotel:', profile.assigned_hotel);
        }
        
        const res = await query
          .order('hotel', { ascending: true })
          .order('room_number', { ascending: true });
        roomsData = res.data;
        error = res.error;
      }

      if (error) throw error;

      // Fetch recent tickets and minibar usage for each room
      const roomsWithExtras = await Promise.all(
        (roomsData || []).map(async (room) => {
          // Fetch recent tickets for this room
          const { data: tickets } = await supabase
            .from('tickets')
            .select('id, ticket_number, title, priority, status, created_at')
            .eq('room_number', room.room_number)
            .eq('hotel', room.hotel)
            .order('created_at', { ascending: false })
            .limit(3);

          // Fetch minibar usage
          const { data: minibarUsage } = await supabase
            .from('room_minibar_usage')
            .select(`
              id,
              quantity_used,
              minibar_items!inner(name, price)
            `)
            .eq('room_id', room.id)
            .eq('is_cleared', false);

          return {
            ...room,
            status: room.status as 'clean' | 'dirty' | 'out_of_order' | 'maintenance',
            last_cleaned_by: room.last_cleaned_by_profile,
            recent_tickets: tickets || [],
            minibar_usage: (minibarUsage || []).map(usage => ({
              id: usage.id,
              quantity_used: usage.quantity_used,
              minibar_item: {
                name: usage.minibar_items.name,
                price: usage.minibar_items.price
              }
            }))
          };
        })
      );

      setRooms(roomsWithExtras);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch rooms',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRoomClick = (room: any) => {
    setSelectedRoom(room);
    setRoomDetailOpen(true);
  };

  const fetchHotels = async () => {
    try {
      const { data, error } = await supabase
        .from('hotel_configurations')
        .select('hotel_id, hotel_name')
        .order('hotel_name');

      if (error) throw error;
      // Map to the format expected by the component
      const mappedHotels = (data || []).map(h => ({
        id: h.hotel_id,
        name: h.hotel_name
      }));
      setHotels(mappedHotels);
    } catch (error: any) {
      console.error('Error fetching hotels:', error);
      toast({
        title: 'Error',
        description: 'Failed to load hotels',
        variant: 'destructive',
      });
    }
  };

  const handleCreateRoom = async () => {
    if (!newRoom.hotel || !newRoom.room_number) {
      toast({
        title: 'Error',
        description: 'Hotel and room number are required',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Find the hotel_id from the selected hotel name
      const selectedHotel = hotels.find(h => h.name === newRoom.hotel);
      const hotelId = selectedHotel?.id || newRoom.hotel;
      
      console.log('Creating room with hotel ID:', hotelId);
      const roomName = newRoom.room_name || generateRoomName(newRoom);
      
      const { data, error } = await supabase
        .from('rooms')
        .insert({
          hotel: hotelId,
          room_number: newRoom.room_number,
          room_name: roomName,
          room_type: newRoom.room_type,
          bed_type: newRoom.bed_type,
          floor_number: newRoom.floor_number ? parseInt(newRoom.floor_number) : null
        })
        .select();

      if (error) {
        console.error('Room creation error:', error);
        throw error;
      }

      console.log('Room created successfully:', data);

      toast({
        title: 'Success',
        description: 'Room created successfully',
      });

      setCreateDialogOpen(false);
      setNewRoom({ hotel: '', room_number: '', room_name: '', room_type: 'standard', bed_type: 'double', floor_number: '' });
      fetchRooms();
    } catch (error: any) {
      console.error('Room creation failed:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create room',
        variant: 'destructive',
      });
    }
  };

  const generateRoomName = (room: { room_number: string; room_type: string; bed_type: string }) => {
    const paddedNumber = room.room_number.padStart(3, '0');
    const typeCapitalized = room.room_type.charAt(0).toUpperCase() + room.room_type.slice(1);
    const bedCapitalized = room.bed_type.charAt(0).toUpperCase() + room.bed_type.slice(1);
    return `${paddedNumber}-${typeCapitalized}-${bedCapitalized}`;
  };

  const handleStatusChange = async (roomId: string, newStatus: string, notes?: string) => {
    try {
      const updateData: any = {
        status: newStatus,
        ...(notes && { notes })
      };

      if (newStatus === 'clean') {
        updateData.last_cleaned_at = new Date().toISOString();
        updateData.last_cleaned_by = profile?.id;
      }

      const { error } = await supabase
        .from('rooms')
        .update(updateData)
        .eq('id', roomId);

      if (error) throw error;

      toast({
        title: 'Success',
        description: `Room status updated to ${newStatus}`,
      });

      fetchRooms();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'clean': return 'bg-green-100 text-green-800 border-green-300';
      case 'dirty': return 'bg-red-100 text-red-800 border-red-300';
      case 'out_of_order': return 'bg-gray-100 text-gray-800 border-gray-300';
      case 'maintenance': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'clean': return <CheckCircle2 className="h-4 w-4" />;
      case 'dirty': return <AlertTriangle className="h-4 w-4" />;
      case 'out_of_order': return <Settings className="h-4 w-4" />;
      case 'maintenance': return <Wrench className="h-4 w-4" />;
      default: return <Bed className="h-4 w-4" />;
    }
  };

  // Filter rooms based on search query and filters
  const filteredRooms = rooms.filter((room) => {
    const matchesSearch = searchQuery === '' || 
      room.room_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      room.hotel.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (room.room_name && room.room_name.toLowerCase().includes(searchQuery.toLowerCase()));
    
    // Dynamic hotel filtering
    const matchesHotel = selectedHotel === 'all' || room.hotel === selectedHotel;
    
    const matchesStatus = statusFilter === 'all' || room.status === statusFilter;
    
    return matchesSearch && matchesHotel && matchesStatus;
  });
  
  // Apply room type filter and active status filter
  const finalFilteredRooms = filteredRooms.filter((room) => {
    const matchesType = roomTypeFilter === 'all' || 
      (roomTypeFilter === 'checkout' && room.is_checkout_room) ||
      (roomTypeFilter === 'daily' && !room.is_checkout_room);
    
    const matchesActiveFilter = !activeStatusFilter || room.status === activeStatusFilter;
    
    return matchesType && matchesActiveFilter;
  });

  // Group rooms by hotel for better organization
  const groupedRooms = finalFilteredRooms.reduce((groups, room) => {
    if (!groups[room.hotel]) {
      groups[room.hotel] = [];
    }
    groups[room.hotel].push(room);
    return groups;
  }, {} as Record<string, RoomWithTickets[]>);

  // Sort rooms within each hotel by room number
  Object.keys(groupedRooms).forEach(hotel => {
    groupedRooms[hotel].sort((a, b) => {
      const numA = parseInt(a.room_number);
      const numB = parseInt(b.room_number);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.room_number.localeCompare(b.room_number);
    });
  });

  const handleStatusFilterClick = (status: string) => {
    if (activeStatusFilter === status) {
      setActiveStatusFilter(null);
      setStatusFilter('all'); // Reset the main filter
    } else {
      setActiveStatusFilter(status);
      setStatusFilter(status); // Apply the filter
    }
  };

  const getStatusDisplayName = (status: string) => {
    switch (status) {
      case 'clean': return t('rooms.clean');
      case 'dirty': return t('rooms.dirty');
      case 'maintenance': return t('rooms.maintenance');
      case 'out_of_order': return 'Out of Order';
      default: return status;
    }
  };

  return (
      <div 
        className="container mx-auto p-2 sm:p-4 space-y-6"
        onClick={(e) => {
          // Reset filter when clicking outside of cards
          if (e.target === e.currentTarget) {
            setActiveStatusFilter(null);
          }
        }}
      >
        {/* Header */}
        <div className="bg-card rounded-lg border shadow-sm p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-foreground">{t('rooms.title')}</h2>
              <p className="text-muted-foreground">{t('rooms.subtitle')}</p>
              {profile?.assigned_hotel && !['admin', 'top_management'].includes(profile.role || '') && (
                <div className="mt-2 flex items-center gap-2 px-3 py-1.5 bg-primary/10 border border-primary/20 rounded-md">
                  <MapPin className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-primary">{profile.assigned_hotel}</span>
                </div>
              )}
            </div>
            
            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => setMinibarDialogOpen(true)}
                  className="flex items-center gap-2"
                >
                  <Settings className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('rooms.minibarSettings')}</span>
                  <span className="sm:hidden">Minibar</span>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setBulkCreateDialogOpen(true)}
                  className="flex items-center gap-2"
                >
                  <Upload className="h-4 w-4" />
                  <span className="hidden sm:inline">Bulk Add Rooms</span>
                  <span className="sm:hidden">Bulk Add</span>
                </Button>
                <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="flex items-center gap-2">
                      <Plus className="h-4 w-4" />
                      <span className="hidden sm:inline">{t('rooms.addRoom')}</span>
                      <span className="sm:hidden">Add Room</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{t('createRoom.title')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label>{t('createRoom.hotel')}</Label>
                        <Select value={newRoom.hotel} onValueChange={(value) => setNewRoom({...newRoom, hotel: value})}>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder={t('createRoom.hotel')} />
                          </SelectTrigger>
                          <SelectContent>
                            {hotels.map((hotel) => (
                              <SelectItem key={hotel.id} value={hotel.name}>
                                {hotel.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Room Number</Label>
                        <Input
                          value={newRoom.room_number}
                          onChange={(e) => setNewRoom({...newRoom, room_number: e.target.value})}
                          placeholder="e.g., 101"
                          className="mt-1"
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <Label>Room Type</Label>
                          <Select value={newRoom.room_type} onValueChange={(value) => setNewRoom({...newRoom, room_type: value})}>
                            <SelectTrigger className="mt-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="economy">Economy</SelectItem>
                              <SelectItem value="comfort">Comfort</SelectItem>
                              <SelectItem value="standard">Standard</SelectItem>
                              <SelectItem value="deluxe">Deluxe</SelectItem>
                              <SelectItem value="suite">Suite</SelectItem>
                              <SelectItem value="presidential">Presidential</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Bed Type</Label>
                          <Select value={newRoom.bed_type} onValueChange={(value) => setNewRoom({...newRoom, bed_type: value})}>
                            <SelectTrigger className="mt-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="single">Single</SelectItem>
                              <SelectItem value="double">Double</SelectItem>
                              <SelectItem value="twin">Twin</SelectItem>
                              <SelectItem value="queen">Queen</SelectItem>
                              <SelectItem value="king">King</SelectItem>
                              <SelectItem value="triple">Triple</SelectItem>
                              <SelectItem value="quadruple">Quadruple</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label>Floor Number</Label>
                        <Input
                          type="number"
                          value={newRoom.floor_number}
                          onChange={(e) => setNewRoom({...newRoom, floor_number: e.target.value})}
                          placeholder="e.g., 1"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label>Custom Room Name (Optional)</Label>
                        <Input
                          value={newRoom.room_name || ''}
                          onChange={(e) => setNewRoom({...newRoom, room_name: e.target.value})}
                          placeholder="Auto-generated if empty"
                          className="mt-1"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Preview: {generateRoomName(newRoom)}
                        </p>
                      </div>
                      <Button onClick={handleCreateRoom} className="w-full">
                        {t('createRoom.create')}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="bg-card rounded-lg border shadow-sm p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Input
                placeholder="Search by room number or hotel..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full"
              />
            </div>
            <HotelFilter 
              value={selectedHotel}
              onValueChange={setSelectedHotel}
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent className="bg-white">
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="clean">Clean</SelectItem>
                <SelectItem value="dirty">Dirty</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
                <SelectItem value="out_of_order">Out of Order</SelectItem>
              </SelectContent>
            </Select>
            <Select value={roomTypeFilter} onValueChange={(value: 'all' | 'checkout' | 'daily') => setRoomTypeFilter(value)}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Room Type" />
              </SelectTrigger>
              <SelectContent className="bg-white">
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="checkout">Checkout Rooms</SelectItem>
                <SelectItem value="daily">Daily Cleaning Rooms</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Room Stats */}
        <div className="bg-card rounded-lg border shadow-sm p-4">
          <h3 className="text-lg font-semibold text-foreground mb-4">{t('rooms.statusOverview')}</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {['clean', 'dirty', 'maintenance', 'out_of_order'].map((status) => {
              // Use filtered rooms for count when hotel filter is applied
              const roomsToCount = selectedHotel === 'all' ? rooms : filteredRooms;
              const count = roomsToCount.filter(r => r.status === status).length;
              const isActive = activeStatusFilter === status;
              
              const statusConfig = {
                clean: {
                  icon: CheckCircle2,
                  bgColor: 'bg-emerald-50',
                  iconColor: 'bg-emerald-100 text-emerald-600',
                  textColor: 'text-emerald-700',
                  subtitle: t('rooms.status.clean.subtitle')
                },
                dirty: {
                  icon: AlertTriangle,
                  bgColor: 'bg-orange-50',
                  iconColor: 'bg-orange-100 text-orange-600',
                  textColor: 'text-orange-700',
                  subtitle: t('rooms.status.dirty.subtitle')
                },
                maintenance: {
                  icon: Wrench,
                  bgColor: 'bg-amber-50',
                  iconColor: 'bg-amber-100 text-amber-600',
                  textColor: 'text-amber-700',
                  subtitle: t('rooms.status.maintenance.subtitle')
                },
                out_of_order: {
                  icon: Settings,
                  bgColor: 'bg-slate-50',
                  iconColor: 'bg-slate-100 text-slate-600',
                  textColor: 'text-slate-700',
                  subtitle: t('rooms.status.outOfOrder.subtitle')
                }
              };
              
              const config = statusConfig[status as keyof typeof statusConfig];
              const IconComponent = config.icon;
              
              return (
                <Card 
                  key={status} 
                  className={`cursor-pointer transition-all duration-200 border ${
                    isActive 
                      ? 'ring-2 ring-primary shadow-lg border-primary scale-[1.02]' 
                      : 'hover:shadow-md hover:scale-[1.01] hover:border-border/60'
                  } ${config.bgColor}`}
                  onClick={() => handleStatusFilterClick(status)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className={`p-2 rounded-lg ${config.iconColor}`}>
                        <IconComponent className="h-4 w-4" />
                      </div>
                      <div className="text-right">
                        <div className={`text-2xl font-bold ${isActive ? 'text-primary' : 'text-foreground'}`}>
                          {count}
                        </div>
                        <div className="text-xs text-muted-foreground font-medium">
                          {t('rooms.roomsCount')}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <h4 className={`font-semibold text-sm ${config.textColor}`}>
                        {getStatusDisplayName(status)}
                      </h4>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {config.subtitle}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Rooms by Hotel */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : finalFilteredRooms.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No rooms found</p>
          </div>
        ) : (
          <div className="space-y-8">
            {(profile?.role === 'admin' || profile?.role === 'top_management') 
              ? Object.keys(groupedRooms).sort().map(hotel => (
                  <div key={hotel}>
                    <div className="flex items-center gap-2 mb-4">
                      <MapPin className="h-5 w-5 text-primary" />
                      <h3 className="text-xl font-semibold text-foreground">{hotel}</h3>
                      <Badge variant="outline">
                        {groupedRooms[hotel].length} rooms
                      </Badge>
                    </div>
                     <div className={`grid gap-3 ${
                       isMobile 
                         ? 'grid-cols-2 sm:grid-cols-3' 
                         : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'
                     }`}>
                       {groupedRooms[hotel].map((room) => (
                         <OrganizedRoomCard 
                           key={room.id} 
                           room={room} 
                           onClick={() => handleRoomClick(room)}
                         />
                       ))}
                     </div>
                  </div>
                ))
              : (
                 <div className={`grid gap-3 ${
                   isMobile 
                     ? 'grid-cols-2 sm:grid-cols-3' 
                     : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'
                 }`}>
                   {finalFilteredRooms.map((room) => (
                     <OrganizedRoomCard 
                       key={room.id} 
                       room={room} 
                       onClick={() => handleRoomClick(room)}
                     />
                   ))}
                 </div>
              )
            }
          </div>
        )}

        {/* Dialogs */}
        <MinimBarManagement 
          open={minibarDialogOpen} 
          onOpenChange={setMinibarDialogOpen} 
        />

        <BulkRoomCreation 
          open={bulkCreateDialogOpen}
          onOpenChange={setBulkCreateDialogOpen}
          hotels={hotels}
          onComplete={fetchRooms}
        />

        <RoomDetailDialog
          room={selectedRoom}
          open={roomDetailOpen}
          onOpenChange={setRoomDetailOpen}
          onRoomUpdated={fetchRooms}
        />
      </div>
  );
}