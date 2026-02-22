import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { format, differenceInDays, startOfDay, addDays } from 'date-fns';
import { AlertTriangle, CheckCircle2, Clock, Plus, CheckSquare, Square, RefreshCw, Package, Trash2, Wine, Loader2, Receipt, CalendarIcon, Luggage, Home, ArrowRightLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  is_checkout_room: boolean;
  guest_nights_stayed: number;
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

  // Custom expiry date for bulk place
  const [customExpiryDate, setCustomExpiryDate] = useState<Date | undefined>(undefined);

  // Room action dialog state
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionRoom, setActionRoom] = useState<RoomOption | null>(null);
  const [actionPlacements, setActionPlacements] = useState<Placement[]>([]);
  const [refillExpiryDate, setRefillExpiryDate] = useState<Date | undefined>(undefined);

  // Live minibar usage state for room chip dialog
  const [roomUsage, setRoomUsage] = useState<any[]>([]);
  const [roomUsageLoading, setRoomUsageLoading] = useState(false);
  const [allMinibarItems, setAllMinibarItems] = useState<{ id: string; name: string; price: number; category: string }[]>([]);
  const [quickAddItemId, setQuickAddItemId] = useState('');
  const [quickAddQty, setQuickAddQty] = useState(1);
  const [quickAddSubmitting, setQuickAddSubmitting] = useState(false);

  // Selected perishable item for the room grid view
  const [selectedViewItem, setSelectedViewItem] = useState<string>('');

  // Collecting all overdue
  const [collectingAll, setCollectingAll] = useState(false);

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
    fetchAllMinibarItems();
  }, []);

  // Auto-select first perishable item for view
  useEffect(() => {
    if (!selectedViewItem && perishableItems.length > 0) {
      setSelectedViewItem(perishableItems[0].id);
    }
  }, [perishableItems, selectedViewItem]);

  // Update custom expiry date default when item changes in bulk dialog
  useEffect(() => {
    if (selectedItemId) {
      const item = perishableItems.find(i => i.id === selectedItemId);
      if (item) {
        setCustomExpiryDate(addDays(startOfDay(new Date()), item.expiry_days));
      }
    }
  }, [selectedItemId, perishableItems]);

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
      .select('id, room_number, hotel, is_checkout_room, guest_nights_stayed')
      .or(filter)
      .order('room_number', { ascending: true });

    const sorted = (data || []).sort((a, b) => numericSort(a.room_number, b.room_number));
    setRooms(sorted.map(r => ({
      id: r.id,
      room_number: r.room_number,
      hotel: r.hotel,
      is_checkout_room: r.is_checkout_room ?? false,
      guest_nights_stayed: r.guest_nights_stayed ?? 0,
    })));
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

  const fetchAllMinibarItems = async () => {
    const { data } = await supabase
      .from('minibar_items')
      .select('id, name, price, category')
      .eq('is_active', true)
      .order('name');
    setAllMinibarItems(data || []);
  };

  const fetchRoomUsage = async (roomId: string) => {
    setRoomUsageLoading(true);
    try {
      const { data } = await supabase
        .from('room_minibar_usage')
        .select('*, minibar_items:minibar_item_id(name, price)')
        .eq('room_id', roomId)
        .eq('is_cleared', false)
        .order('usage_date', { ascending: false });
      setRoomUsage(data || []);
    } catch (e) {
      console.error('Error fetching room usage:', e);
      setRoomUsage([]);
    } finally {
      setRoomUsageLoading(false);
    }
  };

  const handleQuickAddUsage = async () => {
    if (!actionRoom || !quickAddItemId) return;
    setQuickAddSubmitting(true);
    try {
      const { error } = await supabase.from('room_minibar_usage').insert({
        room_id: actionRoom.id,
        minibar_item_id: quickAddItemId,
        quantity_used: quickAddQty,
        recorded_by: profile?.id || null,
        source: 'staff',
        organization_slug: organizationSlug,
      });
      if (error) throw error;
      toast({ title: 'Recorded', description: `Minibar usage added for Room ${actionRoom.room_number}` });
      setQuickAddItemId('');
      setQuickAddQty(1);
      fetchRoomUsage(actionRoom.id);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setQuickAddSubmitting(false);
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

  // Get all overdue placements for bulk actions
  const overduePlacements = useMemo(() => {
    const result: Placement[] = [];
    roomStatusMap.forEach(v => {
      if (v.status === 'overdue') {
        result.push(...v.placements.filter(p => differenceInDays(startOfDay(new Date(p.expires_at)), today) < 0));
      }
    });
    return result;
  }, [roomStatusMap, today]);

  const handleRoomChipClick = (room: RoomOption) => {
    const info = roomStatusMap.get(room.id);
    setActionRoom(room);
    setActionPlacements(info?.placements || []);
    setQuickAddItemId('');
    setQuickAddQty(1);
    // Set default refill expiry
    if (selectedViewItem) {
      const item = perishableItems.find(i => i.id === selectedViewItem);
      if (item) setRefillExpiryDate(addDays(today, item.expiry_days));
    }
    setActionDialogOpen(true);
    fetchRoomUsage(room.id);
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
      setActionPlacements(prev => prev.filter(p => p.id !== placementId));
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleCollectAndRefill = async (placement: Placement) => {
    if (!selectedViewItem || !actionRoom) return;
    const item = perishableItems.find(i => i.id === selectedViewItem);
    if (!item) return;

    try {
      // Mark as collected
      await (supabase
        .from('minibar_placements' as any)
        .update({
          status: 'collected',
          collected_by: profile?.id,
          collected_at: new Date().toISOString(),
        } as any)
        .eq('id', placement.id) as any);

      // Place new one
      const expiresAt = refillExpiryDate || addDays(today, item.expiry_days);
      await (supabase
        .from('minibar_placements' as any)
        .insert({
          room_id: actionRoom.id,
          minibar_item_id: selectedViewItem,
          placed_by: profile?.id,
          placed_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
          quantity: 1,
          status: 'active',
          hotel: actionRoom.hotel,
          organization_slug: organizationSlug,
        } as any) as any);

      toast({ title: 'Collected & Refilled', description: `New ${item.name} placed, expires ${format(expiresAt, 'MMM d')}` });
      fetchPlacements();
      setActionPlacements(prev => prev.filter(p => p.id !== placement.id));
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
      const expiresAt = refillExpiryDate || addDays(today, item.expiry_days);

      const { error } = await (supabase
        .from('minibar_placements' as any)
        .insert({
          room_id: room.id,
          minibar_item_id: selectedViewItem,
          placed_by: profile?.id,
          placed_at: new Date().toISOString(),
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

  const handleCollectAllOverdue = async () => {
    if (overduePlacements.length === 0) return;
    setCollectingAll(true);
    try {
      const ids = overduePlacements.map(p => p.id);
      const { error } = await (supabase
        .from('minibar_placements' as any)
        .update({
          status: 'collected',
          collected_by: profile?.id,
          collected_at: new Date().toISOString(),
        } as any)
        .in('id', ids) as any);

      if (error) throw error;
      toast({ title: 'All Overdue Collected', description: `${ids.length} items marked as collected` });
      fetchPlacements();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setCollectingAll(false);
    }
  };

  const handleCollectAndRefillAllOverdue = async () => {
    if (overduePlacements.length === 0 || !selectedViewItem) return;
    const item = perishableItems.find(i => i.id === selectedViewItem);
    if (!item) return;

    setCollectingAll(true);
    try {
      const ids = overduePlacements.map(p => p.id);
      // Mark all as collected
      const { error: collectError } = await (supabase
        .from('minibar_placements' as any)
        .update({
          status: 'collected',
          collected_by: profile?.id,
          collected_at: new Date().toISOString(),
        } as any)
        .in('id', ids) as any);

      if (collectError) throw collectError;

      // Insert fresh placements
      const expiresAt = addDays(today, item.expiry_days);
      const uniqueRoomIds = [...new Set(overduePlacements.map(p => p.room_id))];
      const newPlacements = uniqueRoomIds.map(roomId => {
        const room = rooms.find(r => r.id === roomId);
        return {
          room_id: roomId,
          minibar_item_id: selectedViewItem,
          placed_by: profile?.id,
          placed_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
          quantity: 1,
          status: 'active',
          hotel: room?.hotel || hotel,
          organization_slug: organizationSlug,
        };
      });

      const { error: insertError } = await (supabase
        .from('minibar_placements' as any)
        .insert(newPlacements as any) as any);

      if (insertError) throw insertError;

      toast({
        title: 'Collected & Refilled All',
        description: `${ids.length} collected, ${newPlacements.length} fresh items placed. Expires ${format(expiresAt, 'MMM d')}`,
      });
      fetchPlacements();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setCollectingAll(false);
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
      const expiresAt = customExpiryDate || addDays(startOfDay(now), item.expiry_days);

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
      setCustomExpiryDate(undefined);
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

  const getRoomTypeBadge = (room: RoomOption) => {
    if (room.is_checkout_room) {
      return (
        <span className="text-[9px] font-bold bg-orange-200 text-orange-700 dark:bg-orange-800/40 dark:text-orange-300 rounded px-1 leading-tight">
          C/O
        </span>
      );
    }
    if (room.guest_nights_stayed > 0) {
      return (
        <span className="text-[9px] font-bold bg-blue-200 text-blue-700 dark:bg-blue-800/40 dark:text-blue-300 rounded px-1 leading-tight">
          D{room.guest_nights_stayed}
        </span>
      );
    }
    return null;
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
                  Click any room to manage · <span className="inline-flex items-center gap-0.5"><span className="text-[9px] font-bold bg-orange-200 text-orange-700 rounded px-0.5">C/O</span> = Checkout</span> · <span className="inline-flex items-center gap-0.5"><span className="text-[9px] font-bold bg-blue-200 text-blue-700 rounded px-0.5">D3</span> = Daily (nights)</span>
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
            {/* Overdue Alert Banner */}
            {overdueCount > 0 && (
              <Alert variant="destructive" className="border-red-300 bg-red-50 dark:bg-red-900/20">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="flex items-center justify-between flex-wrap gap-2">
                  <span className="font-medium">
                    {overdueCount} room{overdueCount !== 1 ? 's have' : ' has'} expired items that need collection!
                  </span>
                  {canPlace && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1 border-red-300 text-red-700 hover:bg-red-100"
                        onClick={handleCollectAllOverdue}
                        disabled={collectingAll}
                      >
                        {collectingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        Collect All
                      </Button>
                      {selectedViewItem && (
                        <Button
                          size="sm"
                          className="h-7 text-xs gap-1 bg-red-600 hover:bg-red-700 text-white"
                          onClick={handleCollectAndRefillAllOverdue}
                          disabled={collectingAll}
                        >
                          {collectingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRightLeft className="h-3 w-3" />}
                          Collect & Refill All
                        </Button>
                      )}
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Status summary pills */}
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="gap-1.5 text-xs py-1 px-2.5 bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                {totalActive - overdueCount - expiringTodayCount} Active
              </Badge>
              <Badge variant="outline" className="gap-1.5 text-xs py-1 px-2.5 bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                {expiringTodayCount} Collect Today
              </Badge>
              <Badge variant="outline" className="gap-1.5 text-xs py-1 px-2.5 bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
                <AlertTriangle className="h-3 w-3" />
                {overdueCount} Overdue
              </Badge>
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
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${getChipClasses(room.id)}`}
                      >
                        {getStatusDot(room.id)}
                        {room.room_number}
                        {getRoomTypeBadge(room)}
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

      {/* Enhanced Room Action Dialog */}
      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                Room {actionRoom?.room_number}
                {actionRoom && (
                  <span className="flex items-center gap-1">
                    {actionRoom.is_checkout_room ? (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 border-orange-300 text-orange-700 bg-orange-50">
                        <Luggage className="h-2.5 w-2.5" />
                        Checkout
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 border-blue-300 text-blue-700 bg-blue-50">
                        <Home className="h-2.5 w-2.5" />
                        Daily{actionRoom.guest_nights_stayed > 0 ? ` · ${actionRoom.guest_nights_stayed}n` : ''}
                      </Badge>
                    )}
                  </span>
                )}
              </span>
              {(() => {
                const usageTotal = roomUsage.reduce((sum, u) => sum + ((u.minibar_items?.price || 0) * (u.quantity_used || 0)), 0);
                return usageTotal > 0 ? (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <Receipt className="h-3 w-3" />
                    €{usageTotal.toFixed(2)}
                  </Badge>
                ) : null;
              })()}
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="perishable" className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="grid grid-cols-2 w-full h-9">
              <TabsTrigger value="perishable" className="text-xs gap-1">
                <Package className="h-3 w-3" />
                Perishable ({actionPlacements.length})
              </TabsTrigger>
              <TabsTrigger value="usage" className="text-xs gap-1">
                <Wine className="h-3 w-3" />
                Minibar ({roomUsage.length})
              </TabsTrigger>
            </TabsList>

            {/* Perishable Tab - now first */}
            <TabsContent value="perishable" className="flex-1 overflow-y-auto space-y-3 mt-2">
              {actionPlacements.length > 0 ? (
                actionPlacements.map(p => {
                  const daysLeft = differenceInDays(startOfDay(new Date(p.expires_at)), today);
                  const isOverdue = daysLeft < 0;
                  const isToday = daysLeft === 0;

                  return (
                    <div key={p.id} className={`p-3 rounded-lg border ${isOverdue ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800' : isToday ? 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800' : 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{p.item_name}</span>
                        {isOverdue && (
                          <Badge className="bg-red-500 text-white text-[10px] px-1.5 py-0 gap-1">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            {Math.abs(daysLeft)}d OVERDUE
                          </Badge>
                        )}
                        {isToday && <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0">COLLECT TODAY</Badge>}
                        {!isOverdue && !isToday && (
                          <Badge className="bg-emerald-500 text-white text-[10px] px-1.5 py-0">{daysLeft}d left</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">
                        Placed {format(new Date(p.placed_at), 'MMM d, HH:mm')} · Expires {format(new Date(p.expires_at), 'MMM d')}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 gap-1 h-7 text-xs"
                          onClick={() => handleMarkCollected(p.id)}
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Collect
                        </Button>
                        {canPlace && selectedViewItem && (
                          <Button
                            size="sm"
                            className={`flex-1 gap-1 h-7 text-xs ${isOverdue || isToday ? 'bg-primary' : ''}`}
                            onClick={() => handleCollectAndRefill(p)}
                          >
                            <ArrowRightLeft className="h-3 w-3" />
                            Collect & Refill
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  No active perishable items
                </div>
              )}

              {canPlace && actionRoom && (
                <div className="border-t pt-3 space-y-2">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Refill with new item</Label>
                  
                  {/* Expiry date picker for refill */}
                  <div className="flex items-center gap-2">
                    <Label className="text-xs whitespace-nowrap">Expires:</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className={cn("h-8 flex-1 justify-start text-left text-xs font-normal", !refillExpiryDate && "text-muted-foreground")}>
                          <CalendarIcon className="mr-1.5 h-3 w-3" />
                          {refillExpiryDate ? format(refillExpiryDate, 'MMM d, yyyy') : 'Pick date'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={refillExpiryDate}
                          onSelect={setRefillExpiryDate}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                          disabled={(date) => date < today}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  
                  <Button
                    className="w-full gap-1.5 h-9"
                    onClick={() => handleRefillRoom(actionRoom)}
                    disabled={!selectedViewItem}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Refill {selectedViewItemName.length > 25 ? selectedViewItemName.substring(0, 23) + '...' : selectedViewItemName}
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* Minibar Usage Tab */}
            <TabsContent value="usage" className="flex-1 overflow-y-auto space-y-3 mt-2">
              {roomUsageLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : roomUsage.length > 0 ? (
                <div className="space-y-2">
                  {roomUsage.map((u: any) => (
                    <div key={u.id} className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/30 text-sm">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{u.minibar_items?.name || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground">
                          Qty: {u.quantity_used} · {u.source === 'guest' ? 'Guest (QR)' : 'Staff'} · {format(new Date(u.usage_date), 'MMM d, HH:mm')}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-foreground">
                        €{((u.minibar_items?.price || 0) * (u.quantity_used || 0)).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  No minibar usage recorded
                </div>
              )}

              {/* Quick Add Usage */}
              {canPlace && (
                <div className="border-t pt-3 space-y-2">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Record Usage</Label>
                  <Select value={quickAddItemId} onValueChange={setQuickAddItemId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select item..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allMinibarItems.map(item => (
                        <SelectItem key={item.id} value={item.id} className="text-xs">
                          {item.name} — €{item.price.toFixed(2)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={quickAddQty}
                      onChange={e => setQuickAddQty(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
                      className="h-8 w-20 text-xs"
                      placeholder="Qty"
                    />
                    <Button
                      size="sm"
                      className="flex-1 h-8 text-xs gap-1"
                      disabled={!quickAddItemId || quickAddSubmitting}
                      onClick={handleQuickAddUsage}
                    >
                      {quickAddSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                      Add
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
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

            {/* Custom Expiry Date */}
            {selectedItemId && (
              <div>
                <label className="text-sm font-medium">Expiry Date</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full mt-1 justify-start text-left font-normal", !customExpiryDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {customExpiryDate ? format(customExpiryDate, 'PPP') : 'Pick expiry date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={customExpiryDate}
                      onSelect={setCustomExpiryDate}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                      disabled={(date) => date < today}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}

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
                      {getRoomTypeBadge(room)}
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
                  {customExpiryDate ? format(customExpiryDate, 'MMM d, yyyy') : format(addDays(startOfDay(new Date()), perishableItems.find(i => i.id === selectedItemId)?.expiry_days || 2), 'MMM d, yyyy')}
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
