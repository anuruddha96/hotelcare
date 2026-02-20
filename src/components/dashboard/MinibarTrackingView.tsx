import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfDay, endOfDay } from 'date-fns';
import { Calendar as CalendarIcon, DollarSign, Package, TrendingUp, Trash2, AlertTriangle, Plus, QrCode, Settings, Search, Upload, Image, User, Monitor, ScanLine, Receipt, Hotel } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { subDays } from 'date-fns';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { Input } from '@/components/ui/input';
import { MinibarQuickAdd } from './MinibarQuickAdd';
import { MinibarQRManagement } from './MinibarQRManagement';
import { MinimBarManagement } from './MinimBarManagement';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';

interface MinibarUsageRecord {
  id: string;
  room_number: string;
  hotel: string;
  item_name: string;
  quantity_used: number;
  item_price: number;
  total_price: number;
  usage_date: string;
  recorded_by_name: string;
  source: string;
  is_cleared: boolean;
  guest_nights_stayed: number;
}

interface RoomGroup {
  room_number: string;
  hotel: string;
  items: MinibarUsageRecord[];
  totalPrice: number;
  totalItems: number;
}

interface MinibarSummary {
  totalRevenue: number;
  totalItems: number;
  roomsWithUsage: number;
  avgPerRoom: number;
}
function SourceBadge({ source }: { source: string }) {
  if (source === 'guest') {
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 text-xs gap-1">
        <ScanLine className="h-3 w-3" /> Guest
      </Badge>
    );
  }
  if (source === 'reception') {
    return (
      <Badge variant="outline" className="text-xs gap-1">
        <Monitor className="h-3 w-3" /> Reception
      </Badge>
    );
  }
  return (
    <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100 text-xs gap-1">
      <User className="h-3 w-3" /> Staff
    </Badge>
  );
}

function RoomGroupedView({
  records,
  searchTerm,
  loading,
  canDelete,
  onDeleteRecord,
  t,
}: {
  records: MinibarUsageRecord[];
  searchTerm: string;
  loading: boolean;
  canDelete: boolean;
  onDeleteRecord: (id: string) => void;
  t: (key: string) => string;
}) {
  // Compute max guest_nights_stayed per room group
  const roomNightsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records) {
      const key = `${r.room_number}-${r.hotel}`;
      map.set(key, Math.max(map.get(key) || 1, r.guest_nights_stayed || 1));
    }
    return map;
  }, [records]);
  const roomGroups = useMemo(() => {
    const filtered = records.filter(r => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return r.room_number.toLowerCase().includes(term) || r.item_name.toLowerCase().includes(term);
    });

    const groups = new Map<string, RoomGroup>();
    for (const record of filtered) {
      const key = `${record.room_number}-${record.hotel}`;
      if (!groups.has(key)) {
        groups.set(key, {
          room_number: record.room_number,
          hotel: record.hotel,
          items: [],
          totalPrice: 0,
          totalItems: 0,
        });
      }
      const group = groups.get(key)!;
      group.items.push(record);
      group.totalPrice += record.total_price;
      group.totalItems += record.quantity_used;
    }

    return Array.from(groups.values()).sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
  }, [records, searchTerm]);

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">{t('common.loading')}</div>;
  }

  if (roomGroups.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {searchTerm ? 'No records found matching your search' : t('minibar.noData')}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {roomGroups.map((group) => (
        <Card key={`${group.room_number}-${group.hotel}`} className="overflow-hidden">
          <CardHeader className="pb-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Room {group.room_number}</CardTitle>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-muted-foreground">{group.hotel}</p>
                  {(roomNightsMap.get(`${group.room_number}-${group.hotel}`) || 1) > 1 && (
                    <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 hover:bg-indigo-100 text-[10px] gap-0.5">
                      <Hotel className="h-2.5 w-2.5" />
                      Full Stay ({roomNightsMap.get(`${group.room_number}-${group.hotel}`)} nights)
                    </Badge>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-primary">€{group.totalPrice.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">{group.totalItems} item{group.totalItems !== 1 ? 's' : ''}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {group.items.map((record) => (
                <div key={record.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{record.item_name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <SourceBadge source={record.source} />
                      {record.is_cleared && (
                        <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                          ✓ Cleared
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(record.usage_date), 'HH:mm')}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-3">
                    <div className="text-right">
                      <div className="font-medium">€{record.total_price.toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">
                        {record.quantity_used} × €{record.item_price.toFixed(2)}
                      </div>
                    </div>
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => onDeleteRecord(record.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 py-2 bg-muted/20 border-t">
              <p className="text-xs text-muted-foreground italic">💡 Add to guest bill at checkout</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function MinibarTrackingView() {
  const { t, language } = useTranslation();
  const { user, profile } = useAuth();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [usageRecords, setUsageRecords] = useState<MinibarUsageRecord[]>([]);
  const [summary, setSummary] = useState<MinibarSummary>({
    totalRevenue: 0,
    totalItems: 0,
    roomsWithUsage: 0,
    avgPerRoom: 0,
  });
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState<string>('');
  const [clearAllDialogOpen, setClearAllDialogOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [qrManagementOpen, setQrManagementOpen] = useState(false);
  const [manageItemsOpen, setManageItemsOpen] = useState(false);
  const [searchRoom, setSearchRoom] = useState('');
  const [minibarLogoUrl, setMinibarLogoUrl] = useState('');
  const [minibarLogoUploading, setMinibarLogoUploading] = useState(false);
  useEffect(() => {
    fetchUserRole();
    fetchMinibarData();
    fetchMinibarLogo();
  }, [selectedDate]);

  const fetchUserRole = async () => {
    if (user?.id) {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      setUserRole(data?.role || '');
    }
  };

  const fetchMinibarLogo = async () => {
    if (!profile?.assigned_hotel) return;
    const { data } = await supabase
      .from('hotel_configurations')
      .select('minibar_logo_url' as any)
      .or(`hotel_id.eq.${profile.assigned_hotel},hotel_name.eq.${profile.assigned_hotel}`)
      .limit(1);
    if (data && data.length > 0) {
      setMinibarLogoUrl((data[0] as any)?.minibar_logo_url || '');
    }
  };

  const handleMinibarLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile?.assigned_hotel) return;
    setMinibarLogoUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `minibar-logo-${profile.assigned_hotel}-${Date.now()}.${fileExt}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('hotel-assets')
        .upload(fileName, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('hotel-assets').getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;
      const { error: updateError } = await (supabase
        .from('hotel_configurations')
        .update({ minibar_logo_url: publicUrl } as any)
        .or(`hotel_id.eq.${profile.assigned_hotel},hotel_name.eq.${profile.assigned_hotel}`) as any);
      if (updateError) throw updateError;
      setMinibarLogoUrl(publicUrl);
      toast({ title: 'Success', description: 'Minibar logo updated successfully' });
    } catch (error: any) {
      console.error('Error uploading minibar logo:', error);
      toast({ title: 'Error', description: 'Failed to upload minibar logo', variant: 'destructive' });
    } finally {
      setMinibarLogoUploading(false);
    }
  };

  const handleDeleteRecord = async (recordId: string) => {
    if (!confirm('Are you sure you want to delete this minibar record?')) return;
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from('room_minibar_usage')
        .delete()
        .eq('id', recordId);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Minibar record deleted successfully',
      });

      fetchMinibarData();
    } catch (error: any) {
      console.error('Error deleting record:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete minibar record',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const canDelete = ['admin', 'manager', 'housekeeping_manager'].includes(userRole);
  const isSuperAdmin = profile?.is_super_admin || false;
  const canClearAll = ['admin'].includes(userRole) || isSuperAdmin;
  const canQuickAdd = ['admin', 'manager', 'housekeeping_manager', 'reception'].includes(userRole);
  const canManageQR = ['admin'].includes(userRole) || isSuperAdmin;
  const canManageItems = ['admin', 'manager', 'housekeeping_manager'].includes(userRole);

  const handleClearAllRecords = async () => {
    setLoading(true);
    try {
      // Get all rooms for this hotel
      const { data: hotelRooms } = await supabase
        .from('rooms')
        .select('id')
        .eq('hotel', profile?.assigned_hotel || '');
      
      if (hotelRooms && hotelRooms.length > 0) {
        const roomIds = hotelRooms.map(r => r.id);
        
        // Calculate previous day's date range
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const startOfYesterday = startOfDay(yesterday);
        const endOfYesterday = endOfDay(yesterday);
        
        const { error } = await supabase
          .from('room_minibar_usage')
          .update({ is_cleared: true })
          .in('room_id', roomIds)
          .eq('is_cleared', false)
          .gte('usage_date', startOfYesterday.toISOString())
          .lte('usage_date', endOfYesterday.toISOString());

        if (error) throw error;

        toast({
          title: 'Success',
          description: 'Previous day minibar records cleared successfully',
        });

        fetchMinibarData();
      } else {
        toast({
          title: 'Info',
          description: 'No records found to clear',
        });
      }
    } catch (error: any) {
      console.error('Error clearing all records:', error);
      toast({
        title: 'Error',
        description: 'Failed to clear minibar records',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      setClearAllDialogOpen(false);
    }
  };

  const fetchMinibarData = async () => {
    setLoading(true);
    try {
      const userHotel = profile?.assigned_hotel;

      // Resolve hotel name for filtering
      let hotelNameToFilter = userHotel || '';
      if (userHotel) {
        const { data: hotelConfig } = await supabase
          .from('hotel_configurations')
          .select('hotel_name')
          .eq('hotel_id', userHotel)
          .single();
        hotelNameToFilter = hotelConfig?.hotel_name || userHotel;
      }

      const startDate = startOfDay(selectedDate);
      const endDate = endOfDay(selectedDate);

      const { data, error } = await supabase
        .from('room_minibar_usage')
        .select(`
          id,
          quantity_used,
          usage_date,
          room_id,
          recorded_by,
          minibar_item_id,
          source,
          is_cleared,
          rooms (
            room_number,
            hotel,
            guest_nights_stayed
          ),
          minibar_items (
            name,
            price
          ),
          profiles (
            full_name
          )
        `)
        .gte('usage_date', startDate.toISOString())
        .lte('usage_date', endDate.toISOString())
        .order('usage_date', { ascending: false });

      if (error) throw error;

      // Filter by user's assigned hotel using joined rooms.hotel
      let filteredData = data || [];
      if (userHotel && filteredData.length > 0) {
        filteredData = filteredData.filter((record: any) =>
          record.rooms?.hotel === userHotel ||
          record.rooms?.hotel === hotelNameToFilter
        );
      }

      // Auto-detect multi-day stays: for rooms with guest_nights_stayed > 1,
      // fetch additional usage records going back N days
      const multiDayRooms = new Map<string, number>();
      for (const record of filteredData) {
        const nights = (record as any).rooms?.guest_nights_stayed || 1;
        if (nights > 1) {
          multiDayRooms.set(record.room_id, Math.min(nights, 30));
        }
      }

      let fullStayRecords: any[] = [];
      if (multiDayRooms.size > 0) {
        const roomIds = Array.from(multiDayRooms.keys());
        const maxNights = Math.max(...Array.from(multiDayRooms.values()));
        const stayStart = startOfDay(subDays(selectedDate, maxNights - 1));

        const { data: stayData } = await supabase
          .from('room_minibar_usage')
          .select(`
            id, quantity_used, usage_date, room_id, recorded_by, minibar_item_id, source, is_cleared,
            rooms (room_number, hotel, guest_nights_stayed),
            minibar_items (name, price),
            profiles (full_name)
          `)
          .in('room_id', roomIds)
          .gte('usage_date', stayStart.toISOString())
          .lt('usage_date', startDate.toISOString())
          .order('usage_date', { ascending: false });

        if (stayData) {
          // Filter by each room's actual nights stayed
          fullStayRecords = stayData.filter((r: any) => {
            const nights = multiDayRooms.get(r.room_id) || 1;
            const roomStayStart = startOfDay(subDays(selectedDate, nights - 1));
            return new Date(r.usage_date) >= roomStayStart;
          });
          // Apply same hotel filter
          if (userHotel) {
            fullStayRecords = fullStayRecords.filter((r: any) =>
              r.rooms?.hotel === userHotel || r.rooms?.hotel === hotelNameToFilter
            );
          }
        }
      }

      // Merge today's records with full-stay records, deduplicate by id
      const allRecordIds = new Set(filteredData.map((r: any) => r.id));
      for (const r of fullStayRecords) {
        if (!allRecordIds.has(r.id)) {
          filteredData.push(r);
          allRecordIds.add(r.id);
        }
      }

      // Transform data
      const records: MinibarUsageRecord[] = filteredData.map((record: any) => ({
        id: record.id,
        room_number: record.rooms?.room_number || 'N/A',
        hotel: record.rooms?.hotel || 'N/A',
        item_name: record.minibar_items?.name || 'Unknown',
        quantity_used: record.quantity_used,
        item_price: record.minibar_items?.price || 0,
        total_price: (record.minibar_items?.price || 0) * record.quantity_used,
        usage_date: record.usage_date,
        recorded_by_name: record.profiles?.full_name || ((record as any).source === 'guest' ? 'Guest (QR Scan)' : 'Unknown'),
        source: (record as any).source || 'staff',
        is_cleared: record.is_cleared || false,
        guest_nights_stayed: record.rooms?.guest_nights_stayed || 1,
      }));

      setUsageRecords(records);

      // Calculate summary
      const totalRevenue = records.reduce((sum, record) => sum + record.total_price, 0);
      const totalItems = records.reduce((sum, record) => sum + record.quantity_used, 0);
      const uniqueRooms = new Set(records.map(r => r.room_number)).size;

      setSummary({
        totalRevenue,
        totalItems,
        roomsWithUsage: uniqueRooms,
        avgPerRoom: uniqueRooms > 0 ? totalRevenue / uniqueRooms : 0,
      });
    } catch (error) {
      console.error('Error fetching minibar data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Date Picker */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t('minibar.tracking')}</h2>
          <p className="text-muted-foreground">{t('minibar.history')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search room or item..."
              value={searchRoom}
              onChange={(e) => setSearchRoom(e.target.value)}
              className="pl-8 w-[200px]"
            />
          </div>
          {canQuickAdd && (
            <Button onClick={() => setQuickAddOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Record Usage
            </Button>
          )}
          {canManageQR && (
            <Button variant="outline" onClick={() => setQrManagementOpen(true)} className="gap-2">
              <QrCode className="h-4 w-4" />
              QR Codes
            </Button>
          )}
          {canManageItems && (
            <Button variant="outline" onClick={() => setManageItemsOpen(true)} className="gap-2">
              <Settings className="h-4 w-4" />
              Manage Items
            </Button>
          )}
          {canClearAll && (
            <Button 
              variant="destructive" 
              onClick={() => setClearAllDialogOpen(true)}
              className="gap-2"
            >
              <AlertTriangle className="h-4 w-4" />
              Clear All Records
            </Button>
          )}
          {/* Full Stay toggle removed - auto-detected from PMS data */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-[240px] justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(selectedDate, 'PPP')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => date && setSelectedDate(date)}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('minibar.totalRevenue')}</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">€{summary.totalRevenue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">
              {format(selectedDate, 'MMMM d, yyyy')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('minibar.items')}</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalItems}</div>
            <p className="text-xs text-muted-foreground">Items consumed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('minibar.roomsWithUsage')}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.roomsWithUsage}</div>
            <p className="text-xs text-muted-foreground">Rooms with charges</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg per Room</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">€{summary.avgPerRoom.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">Average spend</p>
          </CardContent>
        </Card>
      </div>

      {/* Room-Grouped Cards */}
      <RoomGroupedView
        records={usageRecords}
        searchTerm={searchRoom}
        loading={loading}
        canDelete={canDelete}
        onDeleteRecord={handleDeleteRecord}
        t={t}
      />

      {/* Minibar Branding Section */}
      {userRole === 'admin' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Image className="h-4 w-4" />
              Minibar Guest Page Logo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Upload a custom logo for the guest minibar page. This logo will be shown to guests when they scan the room QR code.
            </p>
            <div className="flex items-center gap-4">
              {minibarLogoUrl && (
                <img src={minibarLogoUrl} alt="Minibar logo" className="h-12 w-auto object-contain border rounded-lg p-1" />
              )}
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleMinibarLogoUpload}
                  disabled={minibarLogoUploading}
                />
                <div className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-muted transition-colors text-sm">
                  {minibarLogoUploading ? (
                    <><span className="animate-spin">⏳</span> Uploading...</>
                  ) : (
                    <><Upload className="h-4 w-4" /> {minibarLogoUrl ? 'Change Logo' : 'Upload Logo'}</>
                  )}
                </div>
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Clear All Confirmation Dialog */}
      <AlertDialog open={clearAllDialogOpen} onOpenChange={setClearAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Previous Day's Minibar Records?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark all minibar records from yesterday for your hotel as cleared. This action cannot be undone.
              This should only be used in emergency situations or when resetting data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearAllRecords} className="bg-destructive hover:bg-destructive/90">
              Clear All Records
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Quick Add Dialog */}
      <MinibarQuickAdd
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        onRecorded={fetchMinibarData}
        source={userRole === 'reception' ? 'reception' : 'staff'}
      />

      {/* QR Code Management */}
      <MinibarQRManagement open={qrManagementOpen} onOpenChange={setQrManagementOpen} />

      {/* Manage Minibar Items */}
      {canManageItems && (
        <MinimBarManagement open={manageItemsOpen} onOpenChange={setManageItemsOpen} />
      )}
    </div>
  );
}
