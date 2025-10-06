import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfDay, endOfDay } from 'date-fns';
import { Calendar as CalendarIcon, DollarSign, Package, TrendingUp } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
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
}

interface MinibarSummary {
  totalRevenue: number;
  totalItems: number;
  roomsWithUsage: number;
}

export function MinibarTrackingView() {
  const { t } = useTranslation();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [usageRecords, setUsageRecords] = useState<MinibarUsageRecord[]>([]);
  const [summary, setSummary] = useState<MinibarSummary>({
    totalRevenue: 0,
    totalItems: 0,
    roomsWithUsage: 0,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchMinibarData();
  }, [selectedDate]);

  const fetchMinibarData = async () => {
    setLoading(true);
    try {
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

      // Transform data
      const records: MinibarUsageRecord[] = (data || []).map((record: any) => ({
        id: record.id,
        room_number: record.rooms?.room_number || 'N/A',
        hotel: record.rooms?.hotel || 'N/A',
        item_name: record.minibar_items?.name || 'Unknown',
        quantity_used: record.quantity_used,
        item_price: record.minibar_items?.price || 0,
        total_price: (record.minibar_items?.price || 0) * record.quantity_used,
        usage_date: record.usage_date,
        recorded_by_name: record.profiles?.full_name || 'Unknown',
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t('minibar.tracking')}</h2>
          <p className="text-muted-foreground">{t('minibar.history')}</p>
        </div>
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
          ) : usageRecords.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t('minibar.noData')}
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
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usageRecords.map((record) => (
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
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(record.usage_date), 'HH:mm')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
