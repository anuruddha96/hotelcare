import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
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
  Wrench
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface Room {
  id: string;
  hotel: string;
  room_number: string;
  room_type: string;
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
}

export function RoomManagement() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<RoomWithTickets[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedHotel, setSelectedHotel] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [minibarDialogOpen, setMinibarDialogOpen] = useState(false);
  const [newRoom, setNewRoom] = useState({
    hotel: '',
    room_number: '',
    room_type: 'standard',
    floor_number: ''
  });

  const isAdmin = profile?.role === 'admin';
  const canManageRooms = profile?.role && ['admin', 'manager', 'reception'].includes(profile.role);

  useEffect(() => {
    fetchRooms();
    fetchHotels();
  }, [profile]);

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const { data: roomsData, error } = await supabase
        .from('rooms')
        .select(`
          *,
          last_cleaned_by_profile:profiles!rooms_last_cleaned_by_fkey(full_name)
        `)
        .order('hotel', { ascending: true })
        .order('room_number', { ascending: true });

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
      const { error } = await supabase
        .from('rooms')
        .insert({
          hotel: newRoom.hotel,
          room_number: newRoom.room_number,
          room_type: newRoom.room_type,
          floor_number: newRoom.floor_number ? parseInt(newRoom.floor_number) : null
        });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Room created successfully',
      });

      setCreateDialogOpen(false);
      setNewRoom({ hotel: '', room_number: '', room_type: 'standard', floor_number: '' });
      fetchRooms();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    }
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

  const filteredRooms = rooms.filter(room => {
    const matchesSearch = 
      room.room_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      room.hotel.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesHotel = selectedHotel === 'all' || room.hotel === selectedHotel;
    const matchesStatus = statusFilter === 'all' || room.status === statusFilter;
    
    return matchesSearch && matchesHotel && matchesStatus;
  });

  return (
    <div className="container mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Room Management</h2>
          <p className="text-muted-foreground">Monitor and manage hotel room status</p>
        </div>
        
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <>
              <Button
                variant="outline"
                onClick={() => setMinibarDialogOpen(true)}
              >
                <Settings className="h-4 w-4 mr-2" />
                Minibar Settings
              </Button>
              <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Room
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Room</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Hotel</Label>
                      <Select value={newRoom.hotel} onValueChange={(value) => setNewRoom({...newRoom, hotel: value})}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select hotel" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="memories-budapest">Hotel Memories Budapest</SelectItem>
                          <SelectItem value="mika-downtown">Hotel Mika Downtown</SelectItem>
                          <SelectItem value="ottofiori">Hotel Ottofiori</SelectItem>
                          <SelectItem value="gozsdu-court">Gozsdu Court Budapest</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Room Number</Label>
                      <Input
                        value={newRoom.room_number}
                        onChange={(e) => setNewRoom({...newRoom, room_number: e.target.value})}
                        placeholder="e.g., 101"
                      />
                    </div>
                    <div>
                      <Label>Room Type</Label>
                      <Select value={newRoom.room_type} onValueChange={(value) => setNewRoom({...newRoom, room_type: value})}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="standard">Standard</SelectItem>
                          <SelectItem value="deluxe">Deluxe</SelectItem>
                          <SelectItem value="suite">Suite</SelectItem>
                          <SelectItem value="presidential">Presidential</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Floor Number</Label>
                      <Input
                        type="number"
                        value={newRoom.floor_number}
                        onChange={(e) => setNewRoom({...newRoom, floor_number: e.target.value})}
                        placeholder="e.g., 1"
                      />
                    </div>
                    <Button onClick={handleCreateRoom} className="w-full">
                      Create Room
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by room number or hotel..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        
        <div className="flex gap-2">
          <HotelFilter value={selectedHotel} onValueChange={setSelectedHotel} />
          
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="clean">Clean</SelectItem>
              <SelectItem value="dirty">Dirty</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
              <SelectItem value="out_of_order">Out of Order</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Room Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {['clean', 'dirty', 'maintenance', 'out_of_order'].map((status) => {
          const count = rooms.filter(r => r.status === status).length;
          return (
            <Card key={status}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  {getStatusIcon(status)}
                  <div>
                    <p className="text-sm text-muted-foreground capitalize">
                      {status.replace('_', ' ')}
                    </p>
                    <p className="text-2xl font-bold">{count}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Room Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : filteredRooms.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No rooms found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredRooms.map((room) => (
            <Card key={room.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Bed className="h-5 w-5" />
                    {room.room_number}
                  </CardTitle>
                  <Badge className={getStatusColor(room.status)} variant="outline">
                    {getStatusIcon(room.status)}
                    <span className="ml-1 capitalize">{room.status.replace('_', ' ')}</span>
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  {room.hotel.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                {/* Quick Action Buttons */}
                <div className="flex gap-2 flex-wrap">
                  {room.status !== 'clean' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleStatusChange(room.id, 'clean')}
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Clean
                    </Button>
                  )}
                  {room.status !== 'dirty' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleStatusChange(room.id, 'dirty')}
                    >
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Dirty
                    </Button>
                  )}
                </div>

                {/* Last Cleaned Info */}
                {room.last_cleaned_at && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Cleaned {format(new Date(room.last_cleaned_at), 'MMM dd, HH:mm')}
                    {room.last_cleaned_by && (
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {room.last_cleaned_by.full_name}
                      </span>
                    )}
                  </div>
                )}

                {/* Recent Tickets */}
                {room.recent_tickets.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Recent Tickets:</p>
                    <div className="space-y-1">
                      {room.recent_tickets.slice(0, 2).map((ticket) => (
                        <div key={ticket.id} className="text-xs p-2 bg-muted rounded">
                          <p className="font-medium">{ticket.ticket_number}</p>
                          <p className="truncate">{ticket.title}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Minibar Usage */}
                {room.minibar_usage.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Pending Minibar:</p>
                    <div className="space-y-1">
                      {room.minibar_usage.slice(0, 3).map((usage) => (
                        <div key={usage.id} className="text-xs flex justify-between bg-orange-50 p-1 rounded">
                          <span>{usage.minibar_item.name} x{usage.quantity_used}</span>
                          <span>${(usage.minibar_item.price * usage.quantity_used).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Minibar Management Dialog */}
      <MinimBarManagement 
        open={minibarDialogOpen} 
        onOpenChange={setMinibarDialogOpen} 
      />
    </div>
  );
}