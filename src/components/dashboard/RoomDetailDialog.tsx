import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Bed, 
  MapPin, 
  Clock, 
  User, 
  Ticket, 
  ShoppingCart, 
  Plus,
  Minus,
  CheckCircle2,
  AlertTriangle,
  Settings,
  Wrench
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '@/hooks/use-toast';

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

interface MinibarItem {
  id: string;
  name: string;
  category: string;
  price: number;
  is_active: boolean;
}

interface MinibarUsage {
  id: string;
  quantity_used: number;
  minibar_item: {
    id: string;
    name: string;
    price: number;
  };
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
  room: Room;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRoomUpdated: () => void;
}

export function RoomDetailDialog({ room, open, onOpenChange, onRoomUpdated }: RoomDetailDialogProps) {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [minibarItems, setMinibarItems] = useState<MinibarItem[]>([]);
  const [minibarUsage, setMinibarUsage] = useState<MinibarUsage[]>([]);
  const [recentTickets, setRecentTickets] = useState<Ticket[]>([]);
  const [tempUsage, setTempUsage] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState(room.notes || '');

  useEffect(() => {
    if (open) {
      fetchMinibarItems();
      fetchMinibarUsage();
      fetchRecentTickets();
      setNotes(room.notes || '');
    }
  }, [open, room.id]);

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
      toast({
        title: 'Error',
        description: 'Failed to fetch minibar items',
        variant: 'destructive',
      });
    }
  };

  const fetchMinibarUsage = async () => {
    try {
      const { data, error } = await supabase
        .from('room_minibar_usage')
        .select(`
          id,
          quantity_used,
          minibar_items!inner(id, name, price)
        `)
        .eq('room_id', room.id)
        .eq('is_cleared', false);

      if (error) throw error;
      
      const usage = (data || []).map(item => ({
        id: item.id,
        quantity_used: item.quantity_used,
        minibar_item: {
          id: item.minibar_items.id,
          name: item.minibar_items.name,
          price: item.minibar_items.price
        }
      }));
      
      setMinibarUsage(usage);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch minibar usage',
        variant: 'destructive',
      });
    }
  };

  const fetchRecentTickets = async () => {
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
      toast({
        title: 'Error',
        description: 'Failed to fetch recent tickets',
        variant: 'destructive',
      });
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    setLoading(true);
    try {
      const updateData: any = {
        status: newStatus,
        notes
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
        title: 'Success',
        description: `Room status updated to ${newStatus}`,
      });

      onRoomUpdated();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const updateMinibarUsage = async (itemId: string, quantity: number) => {
    if (quantity < 0) return;

    setLoading(true);
    try {
      const existingUsage = minibarUsage.find(u => u.minibar_item.id === itemId);

      if (existingUsage) {
        if (quantity === 0) {
          // Delete the usage record
          const { error } = await supabase
            .from('room_minibar_usage')
            .delete()
            .eq('id', existingUsage.id);

          if (error) throw error;
        } else {
          // Update existing usage
          const { error } = await supabase
            .from('room_minibar_usage')
            .update({
              quantity_used: quantity,
              recorded_by: profile?.id
            })
            .eq('id', existingUsage.id);

          if (error) throw error;
        }
      } else if (quantity > 0) {
        // Create new usage record
        const { error } = await supabase
          .from('room_minibar_usage')
          .insert({
            room_id: room.id,
            minibar_item_id: itemId,
            quantity_used: quantity,
            recorded_by: profile?.id
          });

        if (error) throw error;
      }

      fetchMinibarUsage();
      toast({
        title: 'Success',
        description: 'Minibar usage updated',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const clearMinibarUsage = async () => {
    setLoading(true);
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

      toast({
        title: 'Success',
        description: 'Minibar usage cleared for checkout',
      });

      fetchMinibarUsage();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
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

  const getCurrentUsage = (itemId: string) => {
    return minibarUsage.find(u => u.minibar_item.id === itemId)?.quantity_used || 0;
  };

  const getTotalMinibarValue = () => {
    return minibarUsage.reduce((total, usage) => {
      return total + (usage.quantity_used * usage.minibar_item.price);
    }, 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bed className="h-6 w-6" />
              <div>
                <div>Room {room.room_number}</div>
                <div className="text-sm text-muted-foreground font-normal">
                  {room.hotel.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </div>
              </div>
            </div>
            <Badge className={getStatusColor(room.status)} variant="outline">
              {getStatusIcon(room.status)}
              <span className="ml-2 capitalize">{room.status.replace('_', ' ')}</span>
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Room Status Section */}
          <Card>
            <CardHeader>
              <CardTitle>Room Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {['clean', 'dirty', 'maintenance', 'out_of_order'].map((status) => (
                  <Button
                    key={status}
                    size="sm"
                    variant={room.status === status ? 'default' : 'outline'}
                    onClick={() => handleStatusChange(status)}
                    disabled={loading}
                    className="capitalize"
                  >
                    {getStatusIcon(status)}
                    <span className="ml-2">{status.replace('_', ' ')}</span>
                  </Button>
                ))}
              </div>

              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any notes about this room..."
                  rows={3}
                />
              </div>

              {room.last_cleaned_at && (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Last cleaned: {format(new Date(room.last_cleaned_at), 'MMM dd, yyyy HH:mm')}
                  {room.last_cleaned_by && (
                    <span className="flex items-center gap-1">
                      <User className="h-4 w-4" />
                      {room.last_cleaned_by.full_name}
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Minibar Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" />
                  Minibar Usage
                </div>
                {minibarUsage.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      Total: ${getTotalMinibarValue().toFixed(2)}
                    </Badge>
                    <Button size="sm" onClick={clearMinibarUsage} disabled={loading}>
                      Clear for Checkout
                    </Button>
                  </div>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {minibarItems.map((item) => {
                  const currentUsage = getCurrentUsage(item.id);
                  return (
                    <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="text-sm text-muted-foreground">${item.price.toFixed(2)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateMinibarUsage(item.id, currentUsage - 1)}
                          disabled={currentUsage === 0 || loading}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center">{currentUsage}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateMinibarUsage(item.id, currentUsage + 1)}
                          disabled={loading}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Recent Tickets Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ticket className="h-5 w-5" />
                Recent Tickets
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentTickets.length === 0 ? (
                <p className="text-muted-foreground">No recent tickets for this room</p>
              ) : (
                <div className="space-y-3">
                  {recentTickets.map((ticket) => (
                    <div key={ticket.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium">{ticket.ticket_number}</p>
                        <p className="text-sm text-muted-foreground">{ticket.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(ticket.created_at), 'MMM dd, yyyy')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={ticket.priority === 'urgent' ? 'destructive' : 'secondary'}>
                          {ticket.priority}
                        </Badge>
                        <Badge variant={ticket.status === 'completed' ? 'default' : 'outline'}>
                          {ticket.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}