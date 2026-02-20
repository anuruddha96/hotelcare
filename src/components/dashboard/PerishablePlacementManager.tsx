import { useState, useEffect, useMemo } from 'react';
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
import { AlertTriangle, CheckCircle2, Clock, Plus, CheckSquare, Square, RefreshCw, Package, Trash2 } from 'lucide-react';

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

type RoomStatus = 'active' | 'expiring_today' | 'overdue' | 'none';

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

  // Room action dialog state
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionRoom, setActionRoom] = useState<RoomOption | null>(null);
  const [actionPlacements, setActionPlacements] = useState<Placement[]>([]);

  // Selected perishable item for the room grid view
  const [selectedViewItem, setSelectedViewItem] = useState<string>('');

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

  // Auto-select first perishable item for view
  useEffect(() => {
    if (!selectedViewItem && perishableItems.length > 0) {
      setSelectedViewItem(perishableItems[0].id);
    }
  }, [perishableItems, selectedViewItem]);

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

  const today = startOfDay(new Date());

  // Build a map: roomId -> placement status for the selected item
  const roomStatusMap = useMemo(() => {
    const map = new Map<string, { status: RoomStatus; placements: Placement[] }>();
    const itemPlacements = selectedViewItem
      ? placements.filter(p => p.minibar_item_id === selectedViewItem)
      : placements;

    itemPlacements.forEach(p => {
      const daysUntilExpiry = differenceInDays(startOfDay(new Date(p.expires_at)), today);
      let status: RoomStatus = 'active';
      if (daysUntilExpiry < 0) status = 'overdue';
      else if (daysUntilExpiry === 0) status = 'expiring_today';

      const existing = map.get(p.room_id);
      if (existing) {
        // Use worst status
        const priority: Record<RoomStatus, number> = { overdue: 3, expiring_today: 2, active: 1, none: 0 };
        if (priority[status] > priority[existing.status]) existing.status = status;
        existing.placements.push(p);
      } else {
        map.set(p.room_id, { status, placements: [p] });
      }
    });
    return map;
  }, [placements, selectedViewItem, today]);

  // Stats
  const totalActive = placements.filter(p => selectedViewItem ? p.minibar_item_id === selectedViewItem : true).length;
  const overdueCount = Array.from(roomStatusMap.values()).filter(v => v.status === 'overdue').length;
  const expiringTodayCount = Array.from(roomStatusMap.values()).filter(v => v.status === 'expiring_today').length;

  const handleRoomChipClick = (room: RoomOption) => {
    const info = roomStatusMap.get(room.id);
    setActionRoom(room);
    setActionPlacements(info?.placements || []);
    setActionDialogOpen(true);
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
      // Update action dialog placements
      setActionPlacements(prev => prev.filter(p => p.id !== placementId));
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleRefillRoom = async (room: RoomOption) => {
    if (!selectedViewItem) {
      toast({ title: 'No item selected', description: 'Please select a perishable item first', variant: 'destructive' });
      return;
    }
    const item = perishableItems.find(i => i.id === selectedViewItem);
    if (!item) return;

    try {
      const now = new Date();
      const expiresAt = addDays(startOfDay(now), item.expiry_days);

      const { error } = await (supabase
        .from('minibar_placements' as any)
        .insert({
          room_id: room.id,
          minibar_item_id: selectedViewItem,
          placed_by: profile?.id,
          placed_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
          quantity: 1,
          status: 'active',
          hotel: room.hotel,
          organization_slug: organizationSlug,
        } as any) as any);

      if (error) throw error;
      toast({
        title: 'Refilled',
        description: `${item.name} placed in Room ${room.room_number}. Expires ${format(expiresAt, 'MMM d')}`,
      });
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
        description: `${records.length} × ${item.name} placed. Expires ${format(expiresAt, 'MMM d')}`,
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

  const getChipClasses = (roomId: string): string => {
    const info = roomStatusMap.get(roomId);
    if (!info) return 'bg-muted text-muted-foreground hover:bg-muted/80 border-transparent';
    switch (info.status) {
      case 'overdue':
        return 'bg-red-100 text-red-800 border-red-300 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700';
      case 'expiring_today':
        return 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700';
      case 'active':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700';
      default:
        return 'bg-muted text-muted-foreground hover:bg-muted/80 border-transparent';
    }
  };

  const getStatusDot = (roomId: string) => {
    const info = roomStatusMap.get(roomId);
    if (!info) return null;
    switch (info.status) {
      case 'overdue':
        return <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />;
      case 'expiring_today':
        return <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />;
      case 'active':
        return <span className="w-2 h-2 rounded-full bg-emerald-500" />;
      default:
        return null;
    }
  };

  const selectedViewItemName = perishableItems.find(i => i.id === selectedViewItem)?.name || 'Perishable Items';

  // Group rooms by floor
  const roomsByFloor = useMemo(() => {
    const floors = new Map<string, RoomOption[]>();
    rooms.forEach(room => {
      const floor = room.room_number.length >= 2 ? room.room_number.charAt(0) : '0';
      const floorKey = `Floor ${floor}`;
      if (!floors.has(floorKey)) floors.set(floorKey, []);
      floors.get(floorKey)!.push(room);
    });
    return floors;
  }, [rooms]);

  return (
    <>
      {(perishableItems.length > 0 || placements.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Package className="h-4 w-4 text-primary" />
                  Perishable Item Tracker
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Click any room to manage placement · Colored rooms have active items
                </p>
              </div>
              <div className="flex items-center gap-2">
                {perishableItems.length > 1 && (
                  <Select value={selectedViewItem} onValueChange={setSelectedViewItem}>
                    <SelectTrigger className="w-[200px] h-8 text-xs">
                      <SelectValue placeholder="Select item..." />
                    </SelectTrigger>
                    <SelectContent>
                      {perishableItems.map(item => (
                        <SelectItem key={item.id} value={item.id} className="text-xs">
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {canPlace && (
                  <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1 h-8">
                    <Plus className="h-3.5 w-3.5" />
                    Bulk Place
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Status summary pills */}
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="gap-1.5 text-xs py-1 px-2.5 bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                {totalActive - overdueCount - expiringTodayCount} Active
              </Badge>
              {expiringTodayCount > 0 && (
                <Badge variant="outline" className="gap-1.5 text-xs py-1 px-2.5 bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  {expiringTodayCount} Collect Today
                </Badge>
              )}
              {overdueCount > 0 && (
                <Badge variant="outline" className="gap-1.5 text-xs py-1 px-2.5 bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  {overdueCount} Overdue
                </Badge>
              )}
              <Badge variant="outline" className="gap-1.5 text-xs py-1 px-2.5">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />
                {rooms.length - roomStatusMap.size} No Items
              </Badge>
            </div>

            {/* Room chips grid by floor */}
            {Array.from(roomsByFloor.entries()).map(([floorName, floorRooms]) => (
              <div key={floorName}>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">{floorName}</p>
                <div className="flex flex-wrap gap-1.5">
                  {floorRooms.map(room => {
                    const info = roomStatusMap.get(room.id);
                    return (
                      <button
                        key={room.id}
                        onClick={() => handleRoomChipClick(room)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${getChipClasses(room.id)}`}
                      >
                        {getStatusDot(room.id)}
                        {room.room_number}
                        {info && info.placements.length > 1 && (
                          <span className="text-[10px] opacity-70">×{info.placements.length}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {rooms.length === 0 && !loading && (
              <div className="text-center py-6 text-sm text-muted-foreground">
                No rooms found for this hotel
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Room Action Dialog */}
      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Room {actionRoom?.room_number}
              {actionPlacements.length > 0 && (
                <Badge variant="secondary" className="text-xs">{actionPlacements.length} item{actionPlacements.length !== 1 ? 's' : ''}</Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {actionPlacements.length > 0 ? (
              actionPlacements.map(p => {
                const daysLeft = differenceInDays(startOfDay(new Date(p.expires_at)), today);
                const isOverdue = daysLeft < 0;
                const isToday = daysLeft === 0;

                return (
                  <div key={p.id} className={`p-3 rounded-lg border ${isOverdue ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800' : isToday ? 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800' : 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{p.item_name}</span>
                      {isOverdue && <Badge className="bg-red-500 text-white text-[10px] px-1.5 py-0">OVERDUE</Badge>}
                      {isToday && <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0">TODAY</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Placed {format(new Date(p.placed_at), 'MMM d, HH:mm')} · Expires {format(new Date(p.expires_at), 'MMM d')}
                      {!isOverdue && !isToday && ` (${daysLeft}d left)`}
                    </div>
                    <Button
                      size="sm"
                      variant={isOverdue || isToday ? 'default' : 'outline'}
                      className="w-full gap-1 h-7 text-xs"
                      onClick={() => handleMarkCollected(p.id)}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Mark Collected
                    </Button>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-4 text-sm text-muted-foreground">
                No active perishable items in this room
              </div>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-col gap-2">
            {canPlace && actionRoom && (
              <Button
                className="w-full gap-1.5"
                onClick={() => {
                  handleRefillRoom(actionRoom);
                  setActionDialogOpen(false);
                }}
                disabled={!selectedViewItem}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refill {selectedViewItemName.length > 30 ? selectedViewItemName.substring(0, 28) + '...' : selectedViewItemName}
              </Button>
            )}
            <Button variant="outline" className="w-full" onClick={() => setActionDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Place Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Bulk Place Perishable Items</DialogTitle>
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
