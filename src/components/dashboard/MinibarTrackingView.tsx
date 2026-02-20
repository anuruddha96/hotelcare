import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfDay, endOfDay } from 'date-fns';
import { Calendar as CalendarIcon, DollarSign, Package, TrendingUp, Trash2, AlertTriangle, Plus, QrCode, Settings, Search, Upload, Image } from 'lucide-react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
}

interface MinibarSummary {
  totalRevenue: number;
  totalItems: number;
  roomsWithUsage: number;
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
      const startDate = startOfDay(selectedDate);
      const endDate = endOfDay(selectedDate);

      // Get user's hotel for filtering
      const userHotel = profile?.assigned_hotel;

      const { data, error } = await supabase
        .from('room_minibar_usage')
        .select(`
          id,
          quantity_used,
          usage_date,
          room_id,
          recorded_by,
          minibar_item_id,
          rooms (
            room_number,
            hotel
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
        .eq('is_cleared', false)
        .order('usage_date', { ascending: false });

      if (error) throw error;

      // Filter by user's assigned hotel
      let filteredData = data || [];
      if (userHotel && filteredData.length > 0) {
        // Get hotel name from ID if needed
        const { data: hotelConfig } = await supabase
          .from('hotel_configurations')
          .select('hotel_name')
          .eq('hotel_id', userHotel)
          .single();
        
        const hotelNameToFilter = hotelConfig?.hotel_name || userHotel;
        filteredData = filteredData.filter((record: any) => 
          record.rooms?.hotel === userHotel || 
          record.rooms?.hotel === hotelNameToFilter
        );
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
              placeholder="Search room..."
              value={searchRoom}
              onChange={(e) => setSearchRoom(e.target.value)}
              className="pl-8 w-[160px]"
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
      <div className="grid gap-4 md:grid-cols-3">
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
            <p className="text-xs text-muted-foreground">{t('linen.total')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('minibar.roomsWithUsage')}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.roomsWithUsage}</div>
            <p className="text-xs text-muted-foreground">{t('team.rooms')}</p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Records Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t('minibar.summary')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">{t('common.loading')}</div>
          ) : (() => {
            const filteredRecords = usageRecords.filter(record =>
              !searchRoom || record.room_number.toLowerCase().includes(searchRoom.toLowerCase())
            );
            return filteredRecords.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchRoom ? 'No records found for this room' : t('minibar.noData')}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common.room')}</TableHead>
                    <TableHead>{t('common.hotel')}</TableHead>
                    <TableHead>{t('minibar.items')}</TableHead>
                    <TableHead className="text-right">{t('linen.count')}</TableHead>
                    <TableHead className="text-right">{t('pms.processedRooms')}</TableHead>
                    <TableHead className="text-right">{t('linen.total')}</TableHead>
                    <TableHead>Recorded By</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Time</TableHead>
                    {canDelete && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRecords.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">{record.room_number}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{record.hotel}</Badge>
                      </TableCell>
                      <TableCell>{record.item_name}</TableCell>
                      <TableCell className="text-right">{record.quantity_used}</TableCell>
                      <TableCell className="text-right">€{record.item_price.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-semibold">
                        €{record.total_price.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {record.recorded_by_name}
                      </TableCell>
                      <TableCell>
                        <Badge variant={record.source === 'guest' ? 'secondary' : record.source === 'reception' ? 'outline' : 'default'} className="text-xs capitalize">
                          {record.source || 'staff'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(record.usage_date), 'HH:mm')}
                      </TableCell>
                      {canDelete && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteRecord(record.id)}
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          );
          })()}
        </CardContent>
      </Card>

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
