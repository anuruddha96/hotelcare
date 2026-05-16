import React, { useState, useEffect, useMemo } from 'react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  Grid3X3,
  RefreshCw,
  Eye,
  ListChecks,
  XCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface PrevioPreviewRoom {
  roomId: number;
  name: string;
  roomKindName: string;
  capacity: number;
  extraCapacity: number;
  roomCleanStatusId: number;
}

interface PrevioImportHistoryEntry {
  id: string;
  created_at: string;
  sync_status: 'success' | 'failed' | 'partial';
  error_message: string | null;
  data: {
    total?: number;
    upserted?: number;
    mapped?: number;
    errors?: string[];
    extracted_rooms?: Array<{
      roomId?: number;
      name?: string;
      roomKindName?: string;
      capacity?: number;
      extraCapacity?: number;
      roomCleanStatusId?: number;
    }>;
  } | null;
}

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
  room_category?: string | null;
  pms_metadata?: any;
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
    floor_number: '',
    room_size_sqm: '',
    room_capacity: ''
  });
  const [hotels, setHotels] = useState<any[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<any>(null);
  const [roomDetailOpen, setRoomDetailOpen] = useState(false);
  const [activeStatusFilter, setActiveStatusFilter] = useState<string | null>(null);
  const [importingPrevio, setImportingPrevio] = useState(false);
  const [loadingPrevioPreview, setLoadingPrevioPreview] = useState(false);
  const [loadingImportHistory, setLoadingImportHistory] = useState(false);
  const [previoPreviewRooms, setPrevioPreviewRooms] = useState<PrevioPreviewRoom[]>([]);
  const [previoPreviewError, setPrevioPreviewError] = useState<string | null>(null);
  const [importHistory, setImportHistory] = useState<PrevioImportHistoryEntry[]>([]);

  const isAdmin = profile?.role === 'admin';
  const canManageRooms = profile?.role && ['admin', 'manager', 'reception'].includes(profile.role);
  const assignedHotelConfig = useMemo(
    () => hotels.find((hotel) => hotel.id === profile?.assigned_hotel),
    [hotels, profile?.assigned_hotel]
  );
  const visibleHotelKeys = useMemo(() => {
    const keys = new Set<string>();
    if (profile?.assigned_hotel) keys.add(profile.assigned_hotel);
    if (assignedHotelConfig?.name) keys.add(assignedHotelConfig.name);
    return keys;
  }, [assignedHotelConfig?.name, profile?.assigned_hotel]);

  useEffect(() => {
    fetchRooms();
    fetchHotels();
  }, [profile]);

  useEffect(() => {
    if (profile?.assigned_hotel === 'previo-test') {
      fetchPrevioPreview({ silent: true });
      fetchImportHistory();
    }
  }, [profile?.assigned_hotel]);

  const fetchRooms = async () => {
    // Guard: profile may not be hydrated on first render. Bail without
    // surfacing an error — the effect re-runs once `profile` arrives.
    if (!profile) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let roomsData: any[] | null = null;
      let error: any = null;

      const base = supabase.from('rooms');

      if (profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'housekeeping_manager' || profile?.role === 'top_management') {
        // Resolve hotel_id slug to actual hotel_name used in rooms table
        let hotelFilter = profile.assigned_hotel;
        if (hotelFilter) {
          const { data: hotelConfigs } = await supabase
            .from('hotel_configurations')
            .select('hotel_name')
            .eq('hotel_id', hotelFilter)
            .limit(1);
          if (hotelConfigs && hotelConfigs.length > 0) {
            hotelFilter = hotelConfigs[0].hotel_name;
            console.log('🏨 Resolved hotel_id to hotel_name:', hotelFilter);
          }
        }

        let query = base
          .select('*, is_checkout_room, checkout_time, guest_count, last_cleaned_by_profile:profiles!rooms_last_cleaned_by_fkey(full_name)' as any);
        
        if (hotelFilter) {
          const hotelKeys = [profile.assigned_hotel, hotelFilter].filter(Boolean);
          query = query.in('hotel', hotelKeys);
          console.log('🏨 Filtering rooms by hotel keys:', hotelKeys);
        }
        
        const res = await query
          .order('hotel', { ascending: true })
          .order('room_number', { ascending: true });
        roomsData = res.data;
        error = res.error;
      } else {
        let query = base
          .select('*, is_checkout_room, checkout_time, guest_count');
        
        // Filter by assigned hotel - use direct match
        if (profile?.assigned_hotel) {
          const hotelKeys = Array.from(visibleHotelKeys);
          query = query.in('hotel', hotelKeys.length > 0 ? hotelKeys : [profile.assigned_hotel]);
          console.log('🏨 Filtering rooms by assigned_hotel keys:', hotelKeys);
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
      console.error('Failed to fetch rooms:', error);
      toast.error(`Failed to fetch rooms: ${error?.message || 'unknown error'}`);
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
      toast.error('Failed to load hotels');
    }
  };

  // Wraps supabase.functions.invoke so transient HTML responses from the gateway
  // (cold start, deploy roll, 5xx) don't surface as the raw "Unexpected token '<'"
  // JSON parse error. Returns { data, error } the same shape as invoke().
  const safeInvoke = async (fn: string, body: any): Promise<{ data: any; error: Error | null }> => {
    try {
      const res = await supabase.functions.invoke(fn, { body });
      return { data: res.data, error: res.error as any };
    } catch (e: any) {
      const msg = String(e?.message || e || '');
      if (msg.includes('Unexpected token') || msg.includes('not valid JSON') || msg.includes('<!DOCTYPE')) {
        return {
          data: null,
          error: new Error('Previo gateway returned a non-JSON response (likely a transient deploy/cold-start). Please retry.'),
        };
      }
      return { data: null, error: e instanceof Error ? e : new Error(msg) };
    }
  };

  const fetchPrevioPreview = async (opts: { silent?: boolean } = {}) => {
    if (profile?.assigned_hotel !== 'previo-test') return;

    setLoadingPrevioPreview(true);
    try {
      let { data, error } = await safeInvoke('previo-sync-rooms', { hotelId: 'previo-test', previewOnly: true });

      // Single retry for transient gateway/deploy races.
      if (error && /non-JSON|temporarily|transient|cold-start/i.test(error.message)) {
        await new Promise((r) => setTimeout(r, 800));
        ({ data, error } = await safeInvoke('previo-sync-rooms', { hotelId: 'previo-test', previewOnly: true }));
      }

      const payload = data as { success?: boolean; error?: string; rooms?: PrevioPreviewRoom[] } | null;
      if (error || payload?.success === false) {
        throw new Error(payload?.error || error?.message || 'Failed to fetch Previo rooms');
      }

      setPrevioPreviewRooms(Array.isArray(payload?.rooms) ? payload.rooms : []);
      setPrevioPreviewError(null);
    } catch (error: any) {
      console.error('Previo preview fetch failed:', error);
      const msg = error?.message || 'Failed to fetch Previo room preview';
      setPrevioPreviewError(msg);
      // Only toast when the user explicitly triggered a refresh; the auto-load
      // on tab open is silent and just reflects the error inline.
      if (!opts.silent) toast.error(msg);
    } finally {
      setLoadingPrevioPreview(false);
    }
  };

  const fetchImportHistory = async () => {
    if (profile?.assigned_hotel !== 'previo-test') return;

    setLoadingImportHistory(true);
    try {
      const { data, error } = await supabase
        .from('pms_sync_history')
        .select('id, created_at, sync_status, error_message, data')
        .eq('hotel_id', 'previo-test')
        .eq('sync_type', 'rooms')
        .eq('direction', 'from_previo')
        .contains('data', { operation: 'import_rooms' })
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      setImportHistory((data as PrevioImportHistoryEntry[]) || []);
    } catch (error: any) {
      console.error('Import history fetch failed:', error);
    } finally {
      setLoadingImportHistory(false);
    }
  };

  const handleImportFromPrevio = async () => {
    setImportingPrevio(true);
    const loadingToast = toast.loading('Importing rooms from Previo…');

    try {
      const { data, error } = await safeInvoke('previo-sync-rooms', { hotelId: 'previo-test', importLocal: true });

      const payload = data as {
        success?: boolean;
        error?: string;
        results?: { total?: number; upserted?: number; mapped?: number };
      } | null;

      if (error || payload?.success === false) {
        throw new Error(payload?.error || error?.message || 'Sync failed');
      }

      const results = payload?.results;
      toast.success(
        results
          ? `Imported ${results.upserted ?? 0} of ${results.total ?? 0} extracted rooms`
          : 'Import complete',
        { id: loadingToast }
      );

      await Promise.all([fetchRooms(), fetchPrevioPreview({ silent: true }), fetchImportHistory()]);
    } catch (error: any) {
      const msg = error?.message || 'Import failed';
      toast.error(msg, { id: loadingToast });
      // Surface the failure immediately in the local Import History panel.
      setImportHistory((prev) => [
        {
          id: `local-${Date.now()}`,
          created_at: new Date().toISOString(),
          sync_status: 'failed',
          error_message: msg,
          data: { operation: 'import_rooms', error: msg },
        } as PrevioImportHistoryEntry,
        ...prev,
      ].slice(0, 10));
    } finally {
      setImportingPrevio(false);
    }
  };

  const getPrevioCleanStatusLabel = (statusId: number) => {
    switch (statusId) {
      case 1:
        return 'Dirty';
      case 2:
        return 'Clean';
      case 3:
        return 'Inspected';
      case 4:
        return 'Out of order';
      case 5:
        return 'Out of service';
      default:
        return `Status ${statusId}`;
    }
  };

  const handleCreateRoom = async () => {
    if (!newRoom.hotel || !newRoom.room_number) {
      toast.error('Hotel and room number are required');
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
          floor_number: newRoom.floor_number ? parseInt(newRoom.floor_number) : null,
          room_size_sqm: newRoom.room_size_sqm ? parseFloat(newRoom.room_size_sqm) : null,
          room_capacity: newRoom.room_capacity ? parseInt(newRoom.room_capacity) : null
        })
        .select();

      if (error) {
        console.error('Room creation error:', error);
        throw error;
      }

      console.log('Room created successfully:', data);

      toast.success('Room created successfully');

      setCreateDialogOpen(false);
      setNewRoom({ hotel: '', room_number: '', room_name: '', room_type: 'standard', bed_type: 'double', floor_number: '', room_size_sqm: '', room_capacity: '' });
      fetchRooms();
    } catch (error: any) {
      console.error('Room creation failed:', error);
      toast.error(error.message || 'Failed to create room');
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

      toast.success(`Room status updated to ${newStatus}`);

      fetchRooms();
    } catch (error: any) {
      toast.error(error.message);
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
                {profile?.assigned_hotel === 'previo-test' && (
                  <Button
                    variant="outline"
                    onClick={handleImportFromPrevio}
                    disabled={importingPrevio}
                    className="flex items-center gap-2"
                  >
                    {importingPrevio ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    <span>{importingPrevio ? 'Importing…' : 'Import from Previo'}</span>
                  </Button>
                )}
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
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                          <Label>Room Size (m²)</Label>
                          <Input
                            type="number"
                            value={newRoom.room_size_sqm}
                            onChange={(e) => setNewRoom({...newRoom, room_size_sqm: e.target.value})}
                            placeholder="e.g., 25"
                            className="mt-1"
                            min="0"
                            step="0.5"
                          />
                        </div>
                        <div>
                          <Label>Room Capacity</Label>
                          <Input
                            type="number"
                            value={newRoom.room_capacity}
                            onChange={(e) => setNewRoom({...newRoom, room_capacity: e.target.value})}
                            placeholder="e.g., 2"
                            className="mt-1"
                            min="0"
                          />
                        </div>
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

        {profile?.assigned_hotel === 'previo-test' && (
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="bg-card rounded-lg border shadow-sm p-4 sm:p-6 space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Eye className="h-4 w-4" />
                    <span>Previo room preview</span>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Extracted rooms before import</h3>
                  <p className="text-sm text-muted-foreground">
                    {loadingPrevioPreview
                      ? 'Loading rooms from Previo…'
                      : `${previoPreviewRooms.length} rooms currently available from Previo for preview.`}
                  </p>
                  {previoPreviewError && !loadingPrevioPreview && (
                    <p className="text-xs text-destructive">
                      Last preview attempt failed — click Refresh preview to retry.
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  onClick={() => fetchPrevioPreview()}
                  disabled={loadingPrevioPreview || importingPrevio}
                  className="flex items-center gap-2"
                >
                  <RefreshCw className={`h-4 w-4 ${loadingPrevioPreview ? 'animate-spin' : ''}`} />
                  <span>Refresh preview</span>
                </Button>
              </div>

              <div className="rounded-md border">
                <div className="max-h-[320px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Room</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Capacity</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previoPreviewRooms.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                            {loadingPrevioPreview ? 'Loading preview…' : 'No preview rooms available yet.'}
                          </TableCell>
                        </TableRow>
                      ) : (
                        previoPreviewRooms.map((room) => (
                          <TableRow key={room.roomId}>
                            <TableCell className="font-medium">{room.name}</TableCell>
                            <TableCell>{room.roomKindName || '—'}</TableCell>
                            <TableCell>{(room.capacity ?? 0) + (room.extraCapacity ?? 0)}</TableCell>
                            <TableCell>{getPrevioCleanStatusLabel(room.roomCleanStatusId)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg border shadow-sm p-4 sm:p-6 space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <ListChecks className="h-4 w-4" />
                    <span>Import history</span>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">Recent Previo room imports</h3>
                </div>
                <Button
                  variant="outline"
                  onClick={fetchImportHistory}
                  disabled={loadingImportHistory}
                  className="flex items-center gap-2"
                >
                  <RefreshCw className={`h-4 w-4 ${loadingImportHistory ? 'animate-spin' : ''}`} />
                  <span>Refresh log</span>
                </Button>
              </div>

              <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                {importHistory.length === 0 ? (
                  <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground text-center">
                    {loadingImportHistory ? 'Loading import history…' : 'No import attempts logged yet.'}
                  </div>
                ) : (
                  importHistory.map((entry) => {
                    const roomCount = entry.data?.total ?? 0;
                    const importedCount = entry.data?.upserted ?? 0;
                    const statusTone =
                      entry.sync_status === 'success'
                        ? 'default'
                        : entry.sync_status === 'partial'
                          ? 'secondary'
                          : 'destructive';

                    return (
                      <div key={entry.id} className="rounded-md border p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Badge variant={statusTone}>{entry.sync_status}</Badge>
                              <span className="text-sm font-medium text-foreground">{roomCount} rooms extracted</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(entry.created_at), 'MMM dd, yyyy HH:mm:ss')}
                            </p>
                          </div>
                          <span className="text-sm text-muted-foreground">Imported {importedCount}</span>
                        </div>

                        {entry.error_message ? (
                          <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-foreground">
                            <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
                            <span>{entry.error_message}</span>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">No error message recorded.</p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-card rounded-lg border shadow-sm p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Input
                placeholder={t('rooms.searchByRoomOrHotel')}
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
                <SelectValue placeholder={t('rooms.allStatus')} />
              </SelectTrigger>
              <SelectContent className="bg-white">
                <SelectItem value="all">{t('rooms.allStatus')}</SelectItem>
                <SelectItem value="clean">{t('rooms.clean')}</SelectItem>
                <SelectItem value="dirty">{t('rooms.dirty')}</SelectItem>
                <SelectItem value="maintenance">{t('rooms.maintenance')}</SelectItem>
                <SelectItem value="out_of_order">{t('rooms.outOfOrder')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={roomTypeFilter} onValueChange={(value: 'all' | 'checkout' | 'daily') => setRoomTypeFilter(value)}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder={t('rooms.roomType')} />
              </SelectTrigger>
              <SelectContent className="bg-white">
                <SelectItem value="all">{t('rooms.allTypes')}</SelectItem>
                <SelectItem value="checkout">{t('rooms.checkoutRooms')}</SelectItem>
                <SelectItem value="daily">{t('rooms.dailyCleaningRooms')}</SelectItem>
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