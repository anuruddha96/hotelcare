import { useState, useEffect } from 'react';
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

  useEffect(() => {
    if (open) {
      fetchData();
      setSelectedRoom(null);
      setSelectedItem('');
      setQuantity(1);
      setRoomSearch('');
    }
  }, [open]);

  const fetchData = async () => {
    const [roomsRes, itemsRes] = await Promise.all([
      supabase.from('rooms').select('id, room_number').eq('hotel', profile?.assigned_hotel || '').order('room_number'),
      supabase.from('minibar_items').select('id, name, price, category').eq('is_active', true).order('name'),
    ]);
    setRooms(roomsRes.data || []);
    setItems(itemsRes.data || []);
  };

  const filteredRooms = rooms.filter(r => r.room_number.toLowerCase().includes(roomSearch.toLowerCase()));

  const handleSubmit = async () => {
    if (!selectedRoom || !selectedItem) {
      toast({ title: 'Error', description: 'Please select a room and item', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const today = new Date();
      const dayStart = startOfDay(today).toISOString();
      const dayEnd = endOfDay(today).toISOString();

      // Check for duplicates
      const { data: existing } = await supabase
        .from('room_minibar_usage')
        .select('id, source, quantity_used')
        .eq('room_id', selectedRoom.id)
        .eq('minibar_item_id', selectedItem)
        .eq('is_cleared', false)
        .gte('usage_date', dayStart)
        .lte('usage_date', dayEnd)
        .limit(1);

      if (existing && existing.length > 0) {
        const existingRecord = existing[0] as any;
        if (existingRecord.source === 'guest') {
          // Staff overrides guest record — update it
          await supabase
            .from('room_minibar_usage')
            .update({ quantity_used: quantity, recorded_by: profile?.id || null, source })
            .eq('id', existingRecord.id);
          toast({
            title: 'Updated',
            description: `Guest record for Room ${selectedRoom.room_number} confirmed & updated by staff.`,
          });
          onRecorded();
          onOpenChange(false);
          setSubmitting(false);
          return;
        }
        // Already recorded by staff/reception — block
        toast({
          title: 'Already Recorded',
          description: `This item was already recorded for Room ${selectedRoom.room_number} today (by ${existingRecord.source || 'staff'}).`,
        });
        setSubmitting(false);
        return;
      }

      const { error } = await supabase.from('room_minibar_usage').insert({
        room_id: selectedRoom.id,
        minibar_item_id: selectedItem,
        quantity_used: quantity,
        recorded_by: profile?.id || null,
        source,
        organization_slug: profile?.organization_slug || 'rdhotels',
      });

      if (error) throw error;

      toast({ title: 'Success', description: `Minibar usage recorded for Room ${selectedRoom.room_number}` });
      onRecorded();
      onOpenChange(false);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
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
          {/* Room selection */}
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

          {/* Item selection */}
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

          {/* Quantity */}
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
