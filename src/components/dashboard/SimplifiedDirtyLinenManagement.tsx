import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shirt, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DateRangeFilter } from './DateRangeFilter';
import { toast } from 'sonner';
import { DateRange } from 'react-day-picker';
import { getLocalDateString } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

interface LinenItem {
  id: string;
  name: string;
  display_name: string;
  sort_order: number;
}

interface HousekeeperData {
  housekeeper_name: string;
  items: { [key: string]: number };
  total: number;
}

export function SimplifiedDirtyLinenManagement() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: new Date()
  });
  const [allLinenItems, setAllLinenItems] = useState<LinenItem[]>([]);
  const [itemTotals, setItemTotals] = useState<Map<string, number>>(new Map());
  const [housekeeperData, setHousekeeperData] = useState<HousekeeperData[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);

  // Fetch ALL active linen items first (regardless of records)
  useEffect(() => {
    const fetchLinenItems = async () => {
      const { data, error } = await supabase
        .from('dirty_linen_items')
        .select('id, name, display_name, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (error) {
        console.error('Error fetching linen items:', error);
        return;
      }

      setAllLinenItems(data || []);
    };

    fetchLinenItems();
  }, []);

  const fetchData = async () => {
    if (!dateRange?.from || allLinenItems.length === 0) return;
    
    const startDate = getLocalDateString(dateRange.from);
    const endDate = getLocalDateString(dateRange.to || dateRange.from);
    
    try {
      const { data: currentProfile } = await supabase
        .from('profiles')
        .select('assigned_hotel')
        .eq('id', profile?.id)
        .single();

      const userHotel = currentProfile?.assigned_hotel;

      // Resolve the display name via hotel_configurations
      let resolvedHotelName = userHotel;
      if (userHotel) {
        const { data: hotelConfig } = await supabase
          .from('hotel_configurations')
          .select('hotel_name')
          .eq('hotel_id', userHotel)
          .maybeSingle();
        if (hotelConfig?.hotel_name) {
          resolvedHotelName = hotelConfig.hotel_name;
        }
      }
      
      const { data: countsData, error: countsError } = await supabase
        .from('dirty_linen_counts')
        .select('id, housekeeper_id, linen_item_id, count, work_date')
        .gte('work_date', startDate)
        .lte('work_date', endDate)
        .gt('count', 0);

      if (countsError) {
        console.error('Error fetching counts:', countsError);
        toast.error(t('common.error'));
        return;
      }

      const itemMap = new Map<string, number>();
      allLinenItems.forEach(item => {
        itemMap.set(item.name, 0);
      });

      if (!countsData || countsData.length === 0) {
        setItemTotals(itemMap);
        setHousekeeperData([]);
        setGrandTotal(0);
        return;
      }

      const housekeeperIds = Array.from(new Set(countsData.map(c => c.housekeeper_id)));
      let housekeepersQuery = supabase
        .from('profiles')
        .select('id, full_name, nickname, assigned_hotel')
        .in('id', housekeeperIds);
      
      if (userHotel) {
        if (resolvedHotelName && resolvedHotelName !== userHotel) {
          housekeepersQuery = housekeepersQuery.or(
            `assigned_hotel.eq.${userHotel},assigned_hotel.eq.${resolvedHotelName}`
          );
        } else {
          housekeepersQuery = housekeepersQuery.eq('assigned_hotel', userHotel);
        }
      }
      
      const { data: housekeepersData } = await housekeepersQuery;

      const housekeepersMap = new Map(
        housekeepersData?.map(h => [h.id, h.nickname || h.full_name]) || []
      );
      
      const linenItemsMap = new Map(
        allLinenItems.map(l => [l.id, l.name])
      );
      
      const validHousekeeperIds = new Set(housekeepersData?.map(h => h.id) || []);

      const housekeeperMap = new Map<string, { items: Map<string, number>, total: number }>();
      let total = 0;

      countsData.forEach((record) => {
        if (!validHousekeeperIds.has(record.housekeeper_id)) return;
        
        const itemName = linenItemsMap.get(record.linen_item_id) || 'Unknown';
        const housekeeperName = housekeepersMap.get(record.housekeeper_id) || 'Unknown';
        const count = record.count;

        itemMap.set(itemName, (itemMap.get(itemName) || 0) + count);

        if (!housekeeperMap.has(housekeeperName)) {
          housekeeperMap.set(housekeeperName, { items: new Map(), total: 0 });
        }
        const hkData = housekeeperMap.get(housekeeperName)!;
        hkData.items.set(itemName, (hkData.items.get(itemName) || 0) + count);
        hkData.total += count;

        total += count;
      });

      const housekeepersArray = Array.from(housekeeperMap.entries())
        .map(([housekeeper_name, data]) => ({
          housekeeper_name,
          items: Object.fromEntries(data.items),
          total: data.total
        }))
        .sort((a, b) => a.housekeeper_name.localeCompare(b.housekeeper_name));

      setItemTotals(itemMap);
      setHousekeeperData(housekeepersArray);
      setGrandTotal(total);
    } catch (error) {
      console.error('Error fetching linen data:', error);
      toast.error(t('common.error'));
    }
  };

  useEffect(() => {
    if (dateRange?.from && allLinenItems.length > 0) {
      fetchData();
    }
  }, [dateRange, allLinenItems]);

  const exportToCSV = () => {
    if (!dateRange?.from) return;
    
    const startDate = getLocalDateString(dateRange.from);
    const endDate = getLocalDateString(dateRange.to || dateRange.from);
    
    let csv = t('linen.housekeepers') + ',' + allLinenItems.map(i => i.display_name).join(',') + ',' + t('linen.total') + '\n';
    
    housekeeperData.forEach(hk => {
      const row = [
        hk.housekeeper_name,
        ...allLinenItems.map(item => hk.items[item.name] || 0),
        hk.total
      ];
      csv += row.join(',') + '\n';
    });
    
    csv += '\n' + t('linen.total').toUpperCase() + ',' + allLinenItems.map(i => itemTotals.get(i.name) || 0).join(',') + ',' + grandTotal + '\n';

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dirty-linen-${startDate}-to-${endDate}.csv`;
    a.click();
  };

  const renderMobileCards = () => (
    <div className="space-y-3">
      {housekeeperData.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground">
          No data available for the selected date range
        </div>
      ) : (
        <>
          {housekeeperData.map((hk, index) => (
            <Card key={index} className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-sm">{hk.housekeeper_name}</h4>
                <Badge variant="default" className="text-xs">{hk.total} total</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {allLinenItems.map((item) => {
                  const count = hk.items[item.name] || 0;
                  return (
                    <div key={item.id} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                      <span className="text-muted-foreground truncate mr-2">{item.display_name}</span>
                      <span className={`font-semibold ${count > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>{count}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}

          {/* Totals Card */}
          <Card className="p-4 border-primary/30 bg-primary/5">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-bold text-sm">{t('linen.total').toUpperCase()}</h4>
              <Badge variant="default" className="text-xs bg-primary">{grandTotal}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {allLinenItems.map((item) => {
                const count = itemTotals.get(item.name) || 0;
                return (
                  <div key={item.id} className="flex items-center justify-between p-2 bg-primary/10 rounded text-sm">
                    <span className="text-muted-foreground truncate mr-2">{item.display_name}</span>
                    <span className="font-bold">{count}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );

  const renderDesktopTable = () => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse border">
        <thead>
          <tr className="bg-muted">
            <th className="border p-3 text-left font-bold min-w-[150px]">{t('linen.housekeepers')}</th>
            {allLinenItems.map((item) => (
              <th key={item.id} className="border p-2 text-center font-bold text-xs sm:text-sm whitespace-nowrap">
                {item.display_name}
              </th>
            ))}
            <th className="border p-3 text-center font-bold bg-primary/10 min-w-[100px]">{t('linen.total').toUpperCase()}</th>
          </tr>
        </thead>
        <tbody>
          {housekeeperData.length === 0 ? (
            <tr>
              <td colSpan={allLinenItems.length + 2} className="border p-8 text-center text-muted-foreground">
                No data available for the selected date range
              </td>
            </tr>
          ) : (
            <>
              {housekeeperData.map((hk, index) => (
                <tr key={index} className="hover:bg-accent/30 transition">
                  <td className="border p-3 font-medium">{hk.housekeeper_name}</td>
                  {allLinenItems.map((item) => (
                    <td key={item.id} className="border p-3 text-center">
                      {hk.items[item.name] || 0}
                    </td>
                  ))}
                  <td className="border p-3 text-center font-bold bg-primary/5">
                    {hk.total}
                  </td>
                </tr>
              ))}
              <tr className="bg-accent font-bold">
                <td className="border p-3">{t('linen.total').toUpperCase()}</td>
                {allLinenItems.map((item) => (
                  <td key={item.id} className="border p-3 text-center">
                    {itemTotals.get(item.name) || 0}
                  </td>
                ))}
                <td className="border p-3 text-center bg-primary/10 text-lg">
                  {grandTotal}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold">{t('linen.management')}</h2>
          <p className="text-muted-foreground">{t('linen.collectionSummary')}</p>
        </div>
        <Button onClick={exportToCSV} variant="outline" disabled={housekeeperData.length === 0}>
          <Download className="h-4 w-4 mr-2" />
          Export to CSV
        </Button>
      </div>

      <DateRangeFilter
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />

      <Card className="p-6">
        {/* Summary Stats */}
        <div className="mb-6 grid grid-cols-2 gap-4">
          <div className="flex items-center gap-3 p-4 bg-primary/5 rounded-lg">
            <Shirt className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Total Collected</p>
              <p className="text-2xl font-bold">{grandTotal}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 bg-secondary/50 rounded-lg">
            <Badge variant="secondary" className="text-lg px-4 py-2">
              {housekeeperData.length} Housekeepers
            </Badge>
          </div>
        </div>

        {(isMobile || (typeof window !== 'undefined' && window.innerWidth < 1024 && allLinenItems.length >= 6)) ? renderMobileCards() : renderDesktopTable()}
      </Card>
    </div>
  );
}
