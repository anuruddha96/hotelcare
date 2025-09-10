import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { 
  CheckCircle2, 
  AlertTriangle, 
  Wrench, 
  XCircle, 
  Hotel, 
  Wine,
  Plus,
  Minus,
  Euro,
  User,
  Calendar,
  Trash2,
  Camera
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { DNDPhotosViewer } from './DNDPhotosViewer';

interface Room {
  id: string;
  room_number: string;
  room_name?: string;
  hotel: string;
  status: string;
  room_type?: string;
  floor_number?: number;
  notes?: string;
  last_cleaned_at?: string;
  last_cleaned_by?: string;
}

interface MinibarItem {
  id: string;
  name: string;
  category: string;
  price: number;
  is_active: boolean;
}

interface MinibarUsage {
  id: string;
  minibar_item_id: string;
  quantity_used: number;
  usage_date: string;
  is_cleared: boolean;
  minibar_items: MinibarItem;
}

interface Ticket {
  id: string;
  ticket_number: string;
  title: string;
  priority: string;
  status: string;
  created_at: string;
}

interface RoomDetailDialogProps {
  room: Room | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRoomUpdated?: () => void;
}

export function RoomDetailDialog({ room, open, onOpenChange, onRoomUpdated }: RoomDetailDialogProps) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [minibarItems, setMinibarItems] = useState<MinibarItem[]>([]);
  const [minibarUsage, setMinibarUsage] = useState<MinibarUsage[]>([]);
  const [recentTickets, setRecentTickets] = useState<Ticket[]>([]);
  const [tempUsage, setTempUsage] = useState<{ [key: string]: number }>({});
  const [roomNotes, setRoomNotes] = useState('');
  const [dndPhotosOpen, setDndPhotosOpen] = useState(false);

  useEffect(() => {
    if (open && room) {
      setRoomNotes(room.notes || '');
      fetchMinibarItems();
      fetchMinibarUsage();
      fetchRecentTickets();
    }
  }, [open, room]);

  const fetchMinibarItems = async () => {
    try {
      const { data, error } = await supabase
        .from('minibar_items')
        .select('*')
        .eq('is_active', true)
        .order('category', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      setMinibarItems(data || []);
    } catch (error: any) {
      console.error('Error fetching minibar items:', error);
    }
  };

  const fetchMinibarUsage = async () => {
    if (!room) return;

    try {
      const { data, error } = await supabase
        .from('room_minibar_usage')
        .select(`
          *,
          minibar_items (*)
        `)
        .eq('room_id', room.id)
        .eq('is_cleared', false)
        .order('usage_date', { ascending: false });

      if (error) throw error;
      setMinibarUsage(data || []);
    } catch (error: any) {
      console.error('Error fetching minibar usage:', error);
    }
  };

  const fetchRecentTickets = async () => {
    if (!room) return;

    try {
      const { data, error } = await supabase
        .from('tickets')
        .select('id, ticket_number, title, priority, status, created_at')
        .eq('room_number', room.room_number)
        .eq('hotel', room.hotel)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      setRecentTickets(data || []);
    } catch (error: any) {
      console.error('Error fetching recent tickets:', error);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!room) return;

    setLoading(true);
    try {
      const updateData: any = {
        status: newStatus,
        notes: roomNotes,
      };

      if (newStatus === 'clean') {
        updateData.last_cleaned_at = new Date().toISOString();
        updateData.last_cleaned_by = profile?.id;
      }

      const { error } = await supabase
        .from('rooms')
        .update(updateData)
        .eq('id', room.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Room status updated successfully",
      });

      onRoomUpdated?.();
      onOpenChange(false); // Close dialog automatically after successful update
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const updateMinibarUsage = async (itemId: string, change: number) => {
    if (!room) return;

    const currentUsage = getCurrentUsage(itemId);
    const newQuantity = Math.max(0, currentUsage + change);

    if (newQuantity === 0 && currentUsage === 0) return;

    try {
      if (newQuantity === 0) {
        // Remove usage record
        const existingUsage = minibarUsage.find(u => u.minibar_item_id === itemId);
        if (existingUsage) {
          const { error } = await supabase
            .from('room_minibar_usage')
            .delete()
            .eq('id', existingUsage.id);

          if (error) throw error;
        }
      } else {
        // Update or create usage record
        const existingUsage = minibarUsage.find(u => u.minibar_item_id === itemId);
        
        if (existingUsage) {
          const { error } = await supabase
            .from('room_minibar_usage')
            .update({
              quantity_used: newQuantity,
              usage_date: new Date().toISOString(),
              recorded_by: profile?.id
            })
            .eq('id', existingUsage.id);

          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('room_minibar_usage')
            .insert({
              room_id: room.id,
              minibar_item_id: itemId,
              quantity_used: newQuantity,
              usage_date: new Date().toISOString(),
              recorded_by: profile?.id
            });

          if (error) throw error;
        }
      }

      await fetchMinibarUsage();
      toast({
        title: "Success",
        description: "Minibar usage updated",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const clearMinibarUsage = async () => {
    if (!room) return;

    try {
      const { error } = await supabase
        .from('room_minibar_usage')
        .update({ 
          is_cleared: true,
          guest_checkout_date: new Date().toISOString()
        })
        .eq('room_id', room.id)
        .eq('is_cleared', false);

      if (error) throw error;

      await fetchMinibarUsage();
      toast({
        title: "Success",
        description: "Minibar usage cleared for checkout",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'clean': return 'bg-green-100 text-green-800';
      case 'dirty': return 'bg-orange-100 text-orange-800';
      case 'maintenance': return 'bg-blue-100 text-blue-800';
      case 'out_of_order': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'clean': return <CheckCircle2 className="h-4 w-4" />;
      case 'dirty': return <AlertTriangle className="h-4 w-4" />;
      case 'maintenance': return <Wrench className="h-4 w-4" />;
      case 'out_of_order': return <XCircle className="h-4 w-4" />;
      default: return <CheckCircle2 className="h-4 w-4" />;
    }
  };

  const getCurrentUsage = (itemId: string): number => {
    const usage = minibarUsage.find(u => u.minibar_item_id === itemId);
    return usage?.quantity_used || 0;
  };

  const getTotalMinibarValue = (): number => {
    return minibarUsage.reduce((total, usage) => {
      return total + (usage.quantity_used * usage.minibar_items.price);
    }, 0);
  };

  const handleDeleteRoom = async () => {
    if (!room || profile?.role !== 'admin') return;

    const confirmed = window.confirm(
      `Are you sure you want to delete room ${room.room_number}? This action cannot be undone.`
    );

    if (!confirmed) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('rooms')
        .delete()
        .eq('id', room.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Room deleted successfully",
      });

      onRoomUpdated?.();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!room) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <Hotel className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="text-base sm:text-xl">
                  Room {room.room_number} {room.room_name && `- ${room.room_name}`}
                </span>
              </DialogTitle>
              <p className="text-xs sm:text-sm text-muted-foreground">{room.hotel}</p>
            </div>
            {profile?.role === 'admin' && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeleteRoom}
                disabled={loading}
                className="text-destructive hover:text-destructive hover:border-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Delete Room</span>
                <span className="sm:hidden">Delete</span>
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 sm:space-y-6 pr-2">
          {/* Room Status Section */}
          <Card>
            <CardHeader className="pb-3 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                {getStatusIcon(room.status)}
                <span>Room Status</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <Badge className={`${getStatusColor(room.status)} w-fit`}>
                  {t(`room.status.${room.status}` as any)}
                </Badge>
                
                <Select value={room.status} onValueChange={handleStatusChange}>
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="clean">{t('room.status.clean')}</SelectItem>
                    <SelectItem value="dirty">{t('room.status.dirty')}</SelectItem>
                    <SelectItem value="maintenance">{t('room.status.maintenance')}</SelectItem>
                    <SelectItem value="out_of_order">{t('room.status.out_of_order')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium">Notes</label>
                <Textarea
                  value={roomNotes}
                  onChange={(e) => setRoomNotes(e.target.value)}
                  placeholder="Add room notes..."
                  className="mt-1"
                  rows={2}
                />
              </div>

              {room.last_cleaned_at && (
                <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                  <Calendar className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span>Last cleaned: {new Date(room.last_cleaned_at).toLocaleString()}</span>
                </div>
              )}

              {/* DND Photos Button for Managers/Admins */}
              {profile?.role && ['admin', 'manager', 'housekeeping_manager'].includes(profile.role) && (
                <div className="pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setDndPhotosOpen(true)}
                    className="w-full sm:w-auto"
                  >
                    <Camera className="h-4 w-4 mr-2" />
                    View DND Photos
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Minibar Section */}
          <Card>
            <CardHeader className="pb-3 sm:pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                  <Wine className="h-4 w-4 sm:h-5 sm:w-5" />
                  <span>Minibar Usage</span>
                </CardTitle>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="text-sm font-medium text-primary">
                    Total: €{getTotalMinibarValue().toFixed(2)}
                  </div>
                  {minibarUsage.length > 0 && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={clearMinibarUsage}
                      className="text-xs sm:text-sm"
                    >
                      <span className="hidden sm:inline">Clear for Checkout</span>
                      <span className="sm:hidden">Clear</span>
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 sm:space-y-3">
                {minibarItems.map((item) => {
                  const currentUsage = getCurrentUsage(item.id);
                  return (
                    <div key={item.id} className="flex flex-col gap-3 p-3 border rounded-lg bg-card hover:bg-muted/20 transition-colors sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-sm sm:text-base">{item.name}</div>
                        <div className="text-xs sm:text-sm text-muted-foreground flex flex-wrap items-center gap-2">
                          <span className="capitalize">{item.category}</span>
                          <span className="hidden sm:inline">•</span>
                          <span className="flex items-center gap-1 font-medium text-primary">
                            <Euro className="h-3 w-3" />
                            {item.price.toFixed(2)}
                          </span>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 justify-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateMinibarUsage(item.id, -1)}
                          disabled={currentUsage === 0}
                          className="h-8 w-8 p-0"
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        
                        <span className="w-10 text-center font-semibold text-base sm:text-lg">
                          {currentUsage}
                        </span>
                        
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateMinibarUsage(item.id, 1)}
                          className="h-8 w-8 p-0"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                
                {minibarItems.length === 0 && (
                  <div className="text-center py-8">
                    <Wine className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No minibar items available</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Recent Tickets Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Tickets</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {recentTickets.map((ticket) => (
                  <div key={ticket.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 border rounded-lg bg-card hover:bg-muted/20 transition-colors">
                    <div className="flex-1 mb-2 sm:mb-0">
                      <div className="font-medium">{ticket.ticket_number}</div>
                      <div className="text-sm text-muted-foreground">{ticket.title}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{ticket.priority}</Badge>
                      <Badge variant="secondary">{ticket.status}</Badge>
                    </div>
                  </div>
                ))}
                
                {recentTickets.length === 0 && (
                  <div className="text-center py-8">
                    <div className="mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                      <Calendar className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-muted-foreground">No recent tickets</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>

      {/* DND Photos Viewer */}
      <DNDPhotosViewer
        open={dndPhotosOpen}
        onOpenChange={setDndPhotosOpen}
        roomId={room.id}
        roomNumber={room.room_number}
      />
    </Dialog>
  );
}