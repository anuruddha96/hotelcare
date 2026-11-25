import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Search, Plus, Loader2 } from 'lucide-react';
import { startOfDay, endOfDay } from 'date-fns';
import { persistMinibarQuickAdd } from '@/lib/minibarQuickAdd';

interface MinibarQuickAddProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: () => void;
  source?: 'staff' | 'reception';
}

interface Room {
  id: string;
  room_number: string;
}

interface MinibarItem {
  id: string;
  name: string;
  price: number;
  category: string;
}

export function MinibarQuickAdd({ open, onOpenChange, onRecorded, source = 'reception' }: MinibarQuickAddProps) {
  const { profile } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [items, setItems] = useState<MinibarItem[]>([]);
  const [roomSearch, setRoomSearch] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [selectedItem, setSelectedItem] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  // React state alone cannot guard two clicks within the same event batch.
  const submittingRef = useRef(false);

  useEffect(() => {
    if (open) {
      setRooms([]);
      setItems([]);
      setSelectedRoom(null);
      setSelectedItem('');
      setQuantity(1);
      setRoomSearch('');
      void fetchData();
    }
  // Reset when changing properties/accounts while the dialog is open.
  }, [open, profile?.id, profile?.assigned_hotel, profile?.organization_slug]);

  const fetchData = async () => {
    const assignedHotel = profile?.assigned_hotel || '';
    if (!assignedHotel || !profile?.organization_slug) {
      setRooms([]);
      setItems([]);
      return;
    }

    try {
      // Resolve the assigned hotel within the current organization. Never
      // accept a different organization's identically named hotel alias.
      const { data: hotelConfigs, error: hotelError } = await supabase
        .from('hotel_configurations')
        .select('hotel_id, hotel_name, organizations!inner(slug)')
        .eq('organizations.slug', profile.organization_slug)
        .or(`hotel_id.eq.${assignedHotel},hotel_name.eq.${assignedHotel}`);
      if (hotelError) throw hotelError;
      if (!hotelConfigs?.length) throw new Error('Hotel access could not be verified.');

      const hotelNames = new Set<string>();
      hotelConfigs.forEach(h => {
        hotelNames.add(h.hotel_id);
        hotelNames.add(h.hotel_name);
      });

      const [roomsRes, itemsRes] = await Promise.all([
        supabase.from('rooms').select('id, room_number, organization_slug').in('hotel', Array.from(hotelNames)).order('room_number'),
        supabase.from('minibar_items').select('id, name, price, category').eq('is_active', true).order('name'),
      ]);
      if (roomsRes.error) throw roomsRes.error;
      if (itemsRes.error) throw itemsRes.error;

      // Preserve legacy rooms with no organization_slug only if their hotel's
      // canonical alias was verified above; never show a different tenant's rows.
      const sortedRooms = (roomsRes.data || [])
        .filter(r => !r.organization_slug || r.organization_slug === profile.organization_slug)
        .sort((a, b) => {
          const na = parseInt(a.room_number, 10);
          const nb = parseInt(b.room_number, 10);
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
          return a.room_number.localeCompare(b.room_number);
        });
      setRooms(sortedRooms.map(({ id, room_number }) => ({ id, room_number })));
      setItems(itemsRes.data || []);
    } catch (error: any) {
      setRooms([]);
      setItems([]);
      toast({ title: 'Unable to load minibar', description: error.message || 'Please try again.', variant: 'destructive' });
    }
  };

  const filteredRooms = rooms.filter(r => r.room_number.toLowerCase().includes(roomSearch.toLowerCase()));

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    if (!selectedRoom || !selectedItem || !rooms.some(r => r.id === selectedRoom.id)) {
      toast({ title: 'Error', description: 'Please select a valid room and item', variant: 'destructive' });
      return;
    }
    if (!profile?.organization_slug || !profile.id) {
      toast({ title: 'Access error', description: 'Organization access could not be verified', variant: 'destructive' });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const now = new Date();
      const dayStart = startOfDay(now).toISOString();
      const dayEnd = endOfDay(now).toISOString();
      const outcome = await persistMinibarQuickAdd({
        findExisting: async () => {
          const result = await supabase
            .from('room_minibar_usage')
            .select('id, source')
            .eq('room_id', selectedRoom.id)
            .eq('minibar_item_id', selectedItem)
            .eq('is_cleared', false)
            .gte('usage_date', dayStart)
            .lte('usage_date', dayEnd)
            .limit(1);
          return { data: result.data, error: result.error };
        },
        confirmGuest: async (recordId) => {
          const result = await supabase
            .from('room_minibar_usage')
            .update({ quantity_used: quantity, recorded_by: profile.id, source })
            .eq('id', recordId)
            .eq('room_id', selectedRoom.id)
            .eq('minibar_item_id', selectedItem)
            .eq('source', 'guest')
            .eq('is_cleared', false)
            .select('id');
          return { data: result.data, error: result.error };
        },
        createUsage: async () => {
          const result = await supabase.from('room_minibar_usage').insert({
            room_id: selectedRoom.id,
            minibar_item_id: selectedItem,
            quantity_used: quantity,
            recorded_by: profile.id,
            source,
            organization_slug: profile.organization_slug,
          });
          return { data: result.data, error: result.error };
        },
      }, quantity);

      if (outcome === 'already-recorded') {
        toast({
          title: 'Already Recorded',
          description: `This item was already recorded for Room ${selectedRoom.room_number} today.`,
        });
        return;
      }

      toast({
        title: outcome === 'guest-confirmed' ? 'Updated' : 'Success',
        description: outcome === 'guest-confirmed'
          ? `Guest record for Room ${selectedRoom.room_number} confirmed & updated by staff.`
          : `Minibar usage recorded for Room ${selectedRoom.room_number}`,
      });
      onRecorded();
      onOpenChange(false);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message || 'Minibar update failed', variant: 'destructive' });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Minibar Usage</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Room Number</Label>
            {selectedRoom ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 p-2 border rounded-md bg-muted font-medium">Room {selectedRoom.room_number}</div>
                <Button size="sm" variant="ghost" onClick={() => setSelectedRoom(null)}>Change</Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search room..." value={roomSearch} onChange={e => setRoomSearch(e.target.value)} className="pl-8" />
                </div>
                <div className="max-h-32 overflow-y-auto border rounded-md">
                  {filteredRooms.slice(0, 20).map(room => (
                    <button
                      key={room.id}
                      onClick={() => { setSelectedRoom(room); setRoomSearch(''); }}
                      className="w-full text-left px-3 py-2 hover:bg-muted text-sm transition-colors"
                    >
                      Room {room.room_number}
                    </button>
                  ))}
                  {filteredRooms.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No rooms found</p>}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Item</Label>
            <Select value={selectedItem} onValueChange={setSelectedItem}>
              <SelectTrigger><SelectValue placeholder="Select item..." /></SelectTrigger>
              <SelectContent>
                {items.map(item => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} — €{item.price.toFixed(2)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Quantity</Label>
            <Input type="number" min={1} max={20} value={quantity} onChange={e => setQuantity(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))} />
          </div>

          <Button onClick={handleSubmit} disabled={submitting || !selectedRoom || !selectedItem} className="w-full">
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Record Usage
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
