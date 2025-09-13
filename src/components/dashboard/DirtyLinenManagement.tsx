import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shirt, Calendar, Users, BarChart3, Download, Home, TrendingUp, Trash2 } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { toast } from 'sonner';

interface LinenCount {
  id: string;
  housekeeper_name: string;
  room_number: string;
  hotel: string;
  linen_item_name: string;
  count: number;
  work_date: string;
  created_at: string;
}

interface DailyTotal {
  linen_item_name: string;
  total_count: number;
}

interface HousekeeperTotal {
  housekeeper_name: string;
  total_items: number;
  room_count: number;
}

export function DirtyLinenManagement() {
  const { t } = useTranslation();
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [linenCounts, setLinenCounts] = useState<LinenCount[]>([]);
  const [dailyTotals, setDailyTotals] = useState<DailyTotal[]>([]);
  const [housekeeperTotals, setHousekeeperTotals] = useState<HousekeeperTotal[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedHousekeeper, setSelectedHousekeeper] = useState<string>('all');
  const [housekeepers, setHousekeepers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetchHousekeepers();
    fetchLinenData();
  }, [selectedDate, selectedHousekeeper]);

  const fetchHousekeepers = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'housekeeping')
        .order('full_name');

      if (error) throw error;
      setHousekeepers(data?.map(h => ({ id: h.id, name: h.full_name })) || []);
    } catch (error) {
      console.error('Error fetching housekeepers:', error);
    }
  };

  const fetchLinenData = async () => {
    setLoading(true);
    try {
      // 1) Fetch raw counts without relying on FK relationships
      let countsQuery = supabase
        .from('dirty_linen_counts')
        .select('id, count, work_date, created_at, housekeeper_id, room_id, linen_item_id')
        .eq('work_date', selectedDate)
        .order('created_at', { ascending: false });

      if (selectedHousekeeper !== 'all') {
        countsQuery = countsQuery.eq('housekeeper_id', selectedHousekeeper);
      }

      const { data: countsRows, error: countsError } = await countsQuery;
      if (countsError) throw countsError;

      const countsData = countsRows || [];
      const housekeeperIds = Array.from(new Set(countsData.map((r: any) => r.housekeeper_id)));
      const roomIds = Array.from(new Set(countsData.map((r: any) => r.room_id)));
      const linenIds = Array.from(new Set(countsData.map((r: any) => r.linen_item_id)));

      // 2) Fetch lookups in parallel (only if we have ids)
      const [profilesRes, roomsRes, linenRes] = await Promise.all([
        housekeeperIds.length > 0
          ? supabase.from('profiles').select('id, full_name').in('id', housekeeperIds)
          : Promise.resolve({ data: [], error: null } as any),
        roomIds.length > 0
          ? supabase.from('rooms').select('id, room_number, hotel').in('id', roomIds)
          : Promise.resolve({ data: [], error: null } as any),
        linenIds.length > 0
          ? supabase.from('dirty_linen_items').select('id, display_name').in('id', linenIds)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      if (profilesRes.error) throw profilesRes.error;
      if (roomsRes.error) throw roomsRes.error;
      if (linenRes.error) throw linenRes.error;

      const profileMap = new Map<string, string>((profilesRes.data || []).map((p: any) => [p.id, p.full_name]));
      const roomMap = new Map<string, { room_number: string; hotel: string }>((roomsRes.data || []).map((r: any) => [r.id, { room_number: r.room_number, hotel: r.hotel }]));
      const linenMap = new Map<string, string>((linenRes.data || []).map((l: any) => [l.id, l.display_name]));

      // 3) Build view models
      const counts: LinenCount[] = countsData.map((row: any) => {
        const room = roomMap.get(row.room_id) || { room_number: '—', hotel: '—' };
        return {
          id: row.id,
          housekeeper_name: profileMap.get(row.housekeeper_id) || 'Unknown',
          room_number: room.room_number,
          hotel: room.hotel,
          linen_item_name: linenMap.get(row.linen_item_id) || 'Item',
          count: row.count,
          work_date: row.work_date,
          created_at: row.created_at,
        };
      });

      setLinenCounts(counts);

      // 4) Aggregations
      const totalsMap = new Map<string, number>();
      counts.forEach(item => {
        totalsMap.set(item.linen_item_name, (totalsMap.get(item.linen_item_name) || 0) + item.count);
      });
      const dailyTotals = Array.from(totalsMap.entries())
        .map(([name, total]) => ({ linen_item_name: name, total_count: total }))
        .sort((a, b) => b.total_count - a.total_count);
      setDailyTotals(dailyTotals);

      const hkMap = new Map<string, { total_items: number; rooms: Set<string> }>();
      counts.forEach(item => {
        if (!hkMap.has(item.housekeeper_name)) hkMap.set(item.housekeeper_name, { total_items: 0, rooms: new Set() });
        const agg = hkMap.get(item.housekeeper_name)!;
        agg.total_items += item.count;
        agg.rooms.add(item.room_number);
      });
      const housekeeperTotals = Array.from(hkMap.entries())
        .map(([name, agg]) => ({ housekeeper_name: name, total_items: agg.total_items, room_count: agg.rooms.size }))
        .sort((a, b) => b.total_items - a.total_items);
      setHousekeeperTotals(housekeeperTotals);
    } catch (error) {
      console.error('Error fetching linen data:', error);
      toast.error('Failed to load linen data');
    } finally {
      setLoading(false);
    }
  };

  const deleteLinenRecord = async (recordId: string) => {
    try {
      const { error } = await supabase
        .from('dirty_linen_counts')
        .delete()
        .eq('id', recordId);

      if (error) throw error;

      toast.success('Record deleted successfully');
      fetchLinenData(); // Refresh data to update all views
    } catch (error) {
      console.error('Error deleting linen record:', error);
      toast.error('Failed to delete record');
    }
  };

  const exportData = () => {
    const csvContent = [
      ['Date', 'Housekeeper', 'Room', 'Hotel', 'Linen Type', 'Count', 'Recorded At'].join(','),
      ...linenCounts.map(item => [
        item.work_date,
        item.housekeeper_name,
        item.room_number,
        item.hotel,
        item.linen_item_name,
        item.count,
        format(new Date(item.created_at), 'yyyy-MM-dd HH:mm:ss')
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dirty-linen-report-${selectedDate}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header with Filters */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-2">
          <Shirt className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-semibold">{t('dirtyLinen.management')}</h2>
        </div>
        
        <div className="flex gap-2">
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-auto"
          />
          <Select value={selectedHousekeeper} onValueChange={setSelectedHousekeeper}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select housekeeper" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Housekeepers</SelectItem>
              {housekeepers.map(hk => (
                <SelectItem key={hk.id} value={hk.id}>{hk.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportData} disabled={linenCounts.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            {t('dirtyLinen.export')}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">{t('dirtyLinen.overview')}</TabsTrigger>
          <TabsTrigger value="detailed">{t('dirtyLinen.detailedRecords')}</TabsTrigger>
          <TabsTrigger value="housekeepers">{t('dirtyLinen.byHousekeeper')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Summary Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Shirt className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Items</p>
                  <p className="text-2xl font-bold">
                    {dailyTotals.reduce((sum, item) => sum + item.total_count, 0)}
                  </p>
                </div>
              </div>
            </Card>
            
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <Users className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active Housekeepers</p>
                  <p className="text-2xl font-bold">{housekeeperTotals.length}</p>
                </div>
              </div>
            </Card>
            
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Home className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Rooms Processed</p>
                  <p className="text-2xl font-bold">
                    {housekeeperTotals.reduce((sum, hk) => sum + hk.room_count, 0)}
                  </p>
                </div>
              </div>
            </Card>
            
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Avg per Room</p>
                  <p className="text-2xl font-bold">
                    {housekeeperTotals.reduce((sum, hk) => sum + hk.room_count, 0) > 0 
                      ? Math.round(dailyTotals.reduce((sum, item) => sum + item.total_count, 0) / housekeeperTotals.reduce((sum, hk) => sum + hk.room_count, 0))
                      : 0}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* Daily Totals Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Daily Totals by Item - {format(new Date(selectedDate), 'MMMM dd, yyyy')}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Comprehensive view of all dirty linen items collected today
              </p>
            </CardHeader>
            <CardContent>
              {dailyTotals.length > 0 ? (
                <>
                  {/* Visual Bar Chart */}
                  <div className="space-y-4 mb-6">
                    {dailyTotals
                      .sort((a, b) => b.total_count - a.total_count)
                      .map((item, index) => {
                        const maxCount = Math.max(...dailyTotals.map(d => d.total_count));
                        const percentage = (item.total_count / maxCount) * 100;
                        return (
                          <div key={item.linen_item_name} className="space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="font-medium text-sm">{item.linen_item_name}</span>
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="font-bold">
                                  {item.total_count}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {Math.round((item.total_count / dailyTotals.reduce((sum, d) => sum + d.total_count, 0)) * 100)}%
                                </span>
                              </div>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-3">
                              <div 
                                className={`h-3 rounded-full transition-all duration-500 ${
                                  index === 0 ? 'bg-blue-600' :
                                  index === 1 ? 'bg-green-600' :
                                  index === 2 ? 'bg-purple-600' : 'bg-gray-600'
                                }`}
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  {/* Detailed Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {dailyTotals.map((item) => (
                      <Card key={item.linen_item_name} className="p-4 hover:shadow-md transition-shadow">
                        <div className="space-y-2">
                          <div className="flex justify-between items-start">
                            <span className="font-medium text-sm">{item.linen_item_name}</span>
                            <Badge variant="secondary" className="text-lg font-bold">
                              {item.total_count}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {Math.round((item.total_count / dailyTotals.reduce((sum, d) => sum + d.total_count, 0)) * 100)}% of total
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Shirt className="h-16 w-16 mx-auto mb-4 opacity-30" />
                  <h3 className="text-lg font-medium mb-2">No Data Available</h3>
                  <p className="text-sm">No dirty linen has been recorded for {format(new Date(selectedDate), 'MMMM dd, yyyy')}</p>
                  <p className="text-xs mt-2">Data will appear here once housekeepers start logging dirty linen items</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Performance Insights */}
          {housekeeperTotals.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Team Performance Overview
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Housekeeper productivity and workload distribution
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Top Performers */}
                  <div>
                    <h4 className="font-medium mb-3 text-sm">Top Performers (by items processed)</h4>
                    <div className="space-y-3">
                      {housekeeperTotals
                        .sort((a, b) => b.total_items - a.total_items)
                        .slice(0, 3)
                        .map((hk, index) => (
                          <div key={hk.housekeeper_name} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <div className="flex items-center gap-3">
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                                index === 0 ? 'bg-yellow-500' :
                                index === 1 ? 'bg-gray-400' : 'bg-orange-500'
                              }`}>
                                {index + 1}
                              </div>
                              <span className="font-medium">{hk.housekeeper_name}</span>
                            </div>
                            <div className="text-right">
                              <div className="font-bold">{hk.total_items} items</div>
                              <div className="text-xs text-muted-foreground">{hk.room_count} rooms</div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Workload Distribution */}
                  <div>
                    <h4 className="font-medium mb-3 text-sm">Workload Distribution</h4>
                    <div className="space-y-2">
                      {housekeeperTotals.map((hk) => {
                        const maxItems = Math.max(...housekeeperTotals.map(h => h.total_items));
                        const percentage = maxItems > 0 ? (hk.total_items / maxItems) * 100 : 0;
                        return (
                          <div key={hk.housekeeper_name} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span>{hk.housekeeper_name}</span>
                              <span className="font-medium">{hk.total_items} items</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div 
                                className="h-2 bg-blue-600 rounded-full transition-all duration-500"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="detailed" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Detailed Records</CardTitle>
            </CardHeader>
            <CardContent>
              {linenCounts.length > 0 ? (
                <div className="space-y-3">
                  {linenCounts.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.housekeeper_name}</span>
                          <Badge variant="outline">Room {item.room_number}</Badge>
                          <span className="text-sm text-muted-foreground">{item.hotel}</span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {format(new Date(item.created_at), 'HH:mm:ss')}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="font-medium">{item.linen_item_name}</div>
                          <Badge>{item.count} items</Badge>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => deleteLinenRecord(item.id)}
                          className="text-xs"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No records found for this date</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="housekeepers" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Performance by Housekeeper
              </CardTitle>
            </CardHeader>
            <CardContent>
              {housekeeperTotals.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {housekeeperTotals.map((hk) => (
                    <Card key={hk.housekeeper_name} className="p-4">
                      <div className="space-y-2">
                        <div className="font-medium">{hk.housekeeper_name}</div>
                        <div className="flex justify-between text-sm">
                          <span>Total Items:</span>
                          <Badge variant="secondary">{hk.total_items}</Badge>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span>Rooms Cleaned:</span>
                          <Badge variant="outline">{hk.room_count}</Badge>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No housekeeper data for this date</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
