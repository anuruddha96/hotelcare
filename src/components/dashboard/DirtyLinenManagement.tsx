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
import { Shirt, Calendar, Users, BarChart3, Download } from 'lucide-react';
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
      let query = supabase
        .from('dirty_linen_counts')
        .select(`
          id,
          count,
          work_date,
          created_at,
          profiles!inner(full_name),
          rooms!inner(room_number, hotel),
          dirty_linen_items!inner(display_name)
        `)
        .eq('work_date', selectedDate)
        .order('created_at', { ascending: false });

      if (selectedHousekeeper !== 'all') {
        query = query.eq('housekeeper_id', selectedHousekeeper);
      }

      const { data, error } = await query;
      if (error) throw error;

      const counts: LinenCount[] = (data || []).map((item: any) => ({
        id: item.id,
        housekeeper_name: item.profiles.full_name,
        room_number: item.rooms.room_number,
        hotel: item.rooms.hotel,
        linen_item_name: item.dirty_linen_items.display_name,
        count: item.count,
        work_date: item.work_date,
        created_at: item.created_at,
      }));

      setLinenCounts(counts);

      // Calculate daily totals by linen type
      const totalsMap = new Map<string, number>();
      counts.forEach(item => {
        const existing = totalsMap.get(item.linen_item_name) || 0;
        totalsMap.set(item.linen_item_name, existing + item.count);
      });
      
      const dailyTotals = Array.from(totalsMap.entries()).map(([name, count]) => ({
        linen_item_name: name,
        total_count: count,
      })).sort((a, b) => b.total_count - a.total_count);
      
      setDailyTotals(dailyTotals);

      // Calculate housekeeper totals
      const housekeeperMap = new Map<string, { total_items: number; rooms: Set<string> }>();
      counts.forEach(item => {
        const key = item.housekeeper_name;
        if (!housekeeperMap.has(key)) {
          housekeeperMap.set(key, { total_items: 0, rooms: new Set() });
        }
        const existing = housekeeperMap.get(key)!;
        existing.total_items += item.count;
        existing.rooms.add(item.room_number);
      });

      const housekeeperTotals = Array.from(housekeeperMap.entries()).map(([name, data]) => ({
        housekeeper_name: name,
        total_items: data.total_items,
        room_count: data.rooms.size,
      })).sort((a, b) => b.total_items - a.total_items);
      
      setHousekeeperTotals(housekeeperTotals);
    } catch (error) {
      console.error('Error fetching linen data:', error);
      toast.error('Failed to load linen data');
    } finally {
      setLoading(false);
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
          <h2 className="text-xl font-semibold">Dirty Linen Management</h2>
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
            Export
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="detailed">Detailed Records</TabsTrigger>
          <TabsTrigger value="housekeepers">By Housekeeper</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* Daily Totals */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Daily Totals by Item - {format(new Date(selectedDate), 'MMMM dd, yyyy')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dailyTotals.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {dailyTotals.map((item) => (
                    <Card key={item.linen_item_name} className="p-4">
                      <div className="flex justify-between items-center">
                        <span className="font-medium">{item.linen_item_name}</span>
                        <Badge variant="secondary" className="text-lg font-bold">
                          {item.total_count}
                        </Badge>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Shirt className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No dirty linen recorded for this date</p>
                </div>
              )}
            </CardContent>
          </Card>
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
                      <div className="text-right">
                        <div className="font-medium">{item.linen_item_name}</div>
                        <Badge>{item.count} items</Badge>
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
