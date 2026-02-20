import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { format, differenceInDays, startOfDay, addDays } from 'date-fns';
import { AlertTriangle, CheckCircle2, Clock, Plus, CheckSquare, Square } from 'lucide-react';

interface PerishableItem {
  id: string;
  name: string;
  expiry_days: number;
  category: string;
}

interface Placement {
  id: string;
  room_id: string;
  minibar_item_id: string;
  placed_at: string;
  expires_at: string;
  quantity: number;
  status: string;
  collected_by: string | null;
  collected_at: string | null;
  hotel: string;
  room_number: string;
  item_name: string;
}

interface RoomOption {
  id: string;
  room_number: string;
  hotel: string;
}

interface PerishablePlacementManagerProps {
  hotel: string;
  organizationSlug: string;
}

const numericSort = (a: string, b: string) => {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return a.localeCompare(b);
};

export function PerishablePlacementManager({ hotel, organizationSlug }: PerishablePlacementManagerProps) {
  const { profile } = useAuth();
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [perishableItems, setPerishableItems] = useState<PerishableItem[]>([]);
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [resolvedHotelNames, setResolvedHotelNames] = useState<string[]>([]);

  // Resolve hotel prop to all possible hotel name variants
  useEffect(() => {
    if (!hotel) return;
    const resolve = async () => {
      const { data } = await supabase
        .from('hotel_configurations')
        .select('hotel_id, hotel_name')
        .or(`hotel_id.eq.${hotel},hotel_name.eq.${hotel}`);

      const names = new Set<string>();
      names.add(hotel);
      (data || []).forEach(h => {
        names.add(h.hotel_id);
        names.add(h.hotel_name);
      });
      setResolvedHotelNames(Array.from(names));
    };
    resolve();
  }, [hotel]);

  useEffect(() => {
    if (resolvedHotelNames.length === 0) return;
    fetchPlacements();
    fetchRooms();
  }, [resolvedHotelNames]);

  useEffect(() => {
    fetchPerishableItems();
  }, []);

  const buildHotelFilter = () =>
    resolvedHotelNames.map(n => `hotel.eq.${n}`).join(',');

  const fetchPerishableItems = async () => {
    const { data, error } = await supabase
      .from('minibar_items')
      .select('id, name, category, expiry_days')
      .eq('is_active', true)
      .not('expiry_days', 'is', null);

    if (error) {
      console.error('Error fetching perishable items:', error);
      return;
    }

    setPerishableItems(
      (data || [])
        .filter(i => (i.expiry_days ?? 0) > 0)
        .map(i => ({ id: i.id, name: i.name, expiry_days: i.expiry_days!, category: i.category || '' }))
    );
  };

  const fetchRooms = async () => {
    const filter = buildHotelFilter();
    if (!filter) return;

    const { data } = await supabase
      .from('rooms')
      .select('id, room_number, hotel')
      .or(filter)
      .order('room_number', { ascending: true });

    const sorted = (data || []).sort((a, b) => numericSort(a.room_number, b.room_number));
    setRooms(sorted);
  };

  const fetchPlacements = async () => {
    const filter = buildHotelFilter();
    if (!filter) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase
        .from('minibar_placements' as any)
        .select('*, rooms:room_id(room_number, hotel), minibar_items:minibar_item_id(name)')
        .or(filter)
        .eq('status', 'active')
        .order('expires_at', { ascending: true }) as any);

      if (error) throw error;

      setPlacements(
        ((data as any[]) || []).map((p: any) => ({
          id: p.id,
          room_id: p.room_id,
          minibar_item_id: p.minibar_item_id,
          placed_at: p.placed_at,
          expires_at: p.expires_at,
          quantity: p.quantity,
          status: p.status,
          collected_by: p.collected_by,
          collected_at: p.collected_at,
          hotel: p.hotel,
          room_number: p.rooms?.room_number || 'N/A',
          item_name: p.minibar_items?.name || 'Unknown',
        }))
      );
    } catch (error) {
      console.error('Error fetching placements:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkCollected = async (placementId: string) => {
    try {
      const { error } = await (supabase
        .from('minibar_placements' as any)
        .update({
          status: 'collected',
          collected_by: profile?.id,
          collected_at: new Date().toISOString(),
        } as any)
        .eq('id', placementId) as any);

      if (error) throw error;
      toast({ title: 'Collected', description: 'Item marked as collected' });
      fetchPlacements();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleBulkPlace = async () => {
    if (!selectedItemId || selectedRoomIds.size === 0) return;

    setSubmitting(true);
    try {
      const item = perishableItems.find(i => i.id === selectedItemId);
      if (!item) return;

      // Use the hotel value from the first room to stay consistent with rooms table
      const sampleRoom = rooms.find(r => selectedRoomIds.has(r.id));
      const hotelValue = sampleRoom?.hotel || hotel;

      const now = new Date();
      const expiresAt = addDays(startOfDay(now), item.expiry_days);

      const records = Array.from(selectedRoomIds).map(roomId => ({
        room_id: roomId,
        minibar_item_id: selectedItemId,
        placed_by: profile?.id,
        placed_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        quantity: 1,
        status: 'active',
        hotel: hotelValue,
        organization_slug: organizationSlug,
      }));

      const { error } = await (supabase
        .from('minibar_placements' as any)
        .insert(records as any) as any);

      if (error) throw error;

      toast({
        title: 'Items Placed',
        description: `${records.length} ${item.name} placed. Expires ${format(expiresAt, 'MMM d')}`,
      });

      setDialogOpen(false);
      setSelectedItemId('');
      setSelectedRoomIds(new Set());
      fetchPlacements();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const today = startOfDay(new Date());

  const overduePlacements = placements.filter(p => differenceInDays(startOfDay(new Date(p.expires_at)), today) < 0);
  const collectTodayPlacements = placements.filter(p => differenceInDays(startOfDay(new Date(p.expires_at)), today) === 0);
  const upcomingPlacements = placements.filter(p => differenceInDays(startOfDay(new Date(p.expires_at)), today) > 0);

  const hasAlerts = overduePlacements.length > 0 || collectTodayPlacements.length > 0;

  const toggleRoom = (roomId: string) => {
    setSelectedRoomIds(prev => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  };

  const selectAllRooms = () => setSelectedRoomIds(new Set(rooms.map(r => r.id)));
  const deselectAllRooms = () => setSelectedRoomIds(new Set());

  const canPlace = ['admin', 'manager', 'housekeeping_manager', 'reception'].includes(profile?.role || '');

  return (
    <>
      {(hasAlerts || upcomingPlacements.length > 0 || (canPlace && perishableItems.length > 0)) && (
        <Card className={hasAlerts ? 'border-amber-300 bg-amber-50/50' : ''}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className={`h-4 w-4 ${hasAlerts ? 'text-amber-600' : 'text-muted-foreground'}`} />
                Perishable Item Alerts
              </CardTitle>
              {canPlace && (
                <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1">
                  <Plus className="h-3.5 w-3.5" />
                  Place Items
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {overduePlacements.map(p => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-red-50 border border-red-200">
                <div className="flex items-center gap-2">
                  <Badge className="bg-red-500 text-white hover:bg-red-600 text-xs">OVERDUE</Badge>
                  <span className="font-medium text-sm">Room {p.room_number}</span>
                  <span className="text-sm text-muted-foreground">
                    {p.item_name} (placed {format(new Date(p.placed_at), 'MMM d')}, expired {format(new Date(p.expires_at), 'MMM d')})
                  </span>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleMarkCollected(p.id)} className="gap-1 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Collected
                </Button>
              </div>
            ))}

            {collectTodayPlacements.map(p => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-amber-50 border border-amber-200">
                <div className="flex items-center gap-2">
                  <Badge className="bg-amber-500 text-white hover:bg-amber-600 text-xs">COLLECT TODAY</Badge>
                  <span className="font-medium text-sm">Room {p.room_number}</span>
                  <span className="text-sm text-muted-foreground">
                    {p.item_name} (placed {format(new Date(p.placed_at), 'MMM d')})
                  </span>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleMarkCollected(p.id)} className="gap-1 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Collected
                </Button>
              </div>
            ))}

            {upcomingPlacements.length > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200">
                <Clock className="h-4 w-4 text-blue-600" />
                <span className="text-sm text-blue-800">
                  {upcomingPlacements.length} item{upcomingPlacements.length !== 1 ? 's' : ''} placed, expiring soon
                </span>
              </div>
            )}

            {placements.length === 0 && !loading && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                No active perishable placements
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Place Perishable Items</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 flex-1 overflow-y-auto">
            <div>
              <label className="text-sm font-medium">Select Item</label>
              <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Choose a perishable item..." />
                </SelectTrigger>
                <SelectContent>
                  {perishableItems.map(item => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} ({item.expiry_days} day{item.expiry_days !== 1 ? 's' : ''})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedItemId && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">Select Rooms</label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{selectedRoomIds.size}/{rooms.length}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={selectedRoomIds.size === rooms.length ? deselectAllRooms : selectAllRooms}
                    >
                      {selectedRoomIds.size === rooms.length ? (
                        <><Square className="h-3 w-3" /> Deselect All</>
                      ) : (
                        <><CheckSquare className="h-3 w-3" /> Select All</>
                      )}
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 max-h-[40vh] overflow-y-auto border rounded-lg p-3">
                  {rooms.map(room => (
                    <label
                      key={room.id}
                      className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors ${
                        selectedRoomIds.has(room.id) ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50 border border-transparent'
                      }`}
                    >
                      <Checkbox
                        checked={selectedRoomIds.has(room.id)}
                        onCheckedChange={() => toggleRoom(room.id)}
                      />
                      <span className="text-sm font-medium">{room.room_number}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {selectedItemId && selectedRoomIds.size > 0 && (
              <div className="p-3 rounded-lg bg-muted/30 border text-sm">
                <p className="font-medium">Summary</p>
                <p className="text-muted-foreground">
                  {selectedRoomIds.size} × {perishableItems.find(i => i.id === selectedItemId)?.name} → expires{' '}
                  {format(addDays(startOfDay(new Date()), perishableItems.find(i => i.id === selectedItemId)?.expiry_days || 2), 'MMM d, yyyy')}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleBulkPlace}
              disabled={!selectedItemId || selectedRoomIds.size === 0 || submitting}
            >
              {submitting ? 'Placing...' : `Place in ${selectedRoomIds.size} Room${selectedRoomIds.size !== 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
