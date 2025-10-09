import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shirt, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DateRangeFilter } from './DateRangeFilter';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { DateRange } from 'react-day-picker';

interface LinenItemTotal {
  item_name: string;
  total_count: number;
}

interface HousekeeperData {
  housekeeper_name: string;
  items: { [key: string]: number };
  total: number;
}

export function SimplifiedDirtyLinenManagement() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: new Date()
  });
  const [itemTotals, setItemTotals] = useState<LinenItemTotal[]>([]);
  const [housekeeperData, setHousekeeperData] = useState<HousekeeperData[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);

  const fetchData = async () => {
    if (!dateRange?.from || !dateRange?.to) return;
    
    const startDate = dateRange.from.toISOString().split('T')[0];
    const endDate = dateRange.to.toISOString().split('T')[0];
    
    try {
      const { data, error } = await supabase
        .from('dirty_linen_counts')
        .select(`
          count,
          work_date,
          housekeeper:housekeeper_id (full_name, nickname),
          linen_item:linen_item_id (display_name)
        `)
        .gte('work_date', startDate)
        .lte('work_date', endDate)
        .gt('count', 0);

      if (error) throw error;

      // Calculate totals by item type
      const itemMap = new Map<string, number>();
      const housekeeperMap = new Map<string, { items: Map<string, number>, total: number }>();
      let total = 0;

      data.forEach((record: any) => {
        const itemName = record.linen_item?.display_name || 'Unknown';
        const housekeeperName = record.housekeeper?.nickname || record.housekeeper?.full_name || 'Unknown';
        const count = record.count;

        // Item totals
        itemMap.set(itemName, (itemMap.get(itemName) || 0) + count);

        // Housekeeper data
        if (!housekeeperMap.has(housekeeperName)) {
          housekeeperMap.set(housekeeperName, { items: new Map(), total: 0 });
        }
        const hkData = housekeeperMap.get(housekeeperName)!;
        hkData.items.set(itemName, (hkData.items.get(itemName) || 0) + count);
        hkData.total += count;

        total += count;
      });

      // Convert to arrays
      const itemsArray = Array.from(itemMap.entries()).map(([item_name, total_count]) => ({
        item_name,
        total_count
      }));

      const housekeepersArray = Array.from(housekeeperMap.entries()).map(([housekeeper_name, data]) => ({
        housekeeper_name,
        items: Object.fromEntries(data.items),
        total: data.total
      }));

      setItemTotals(itemsArray);
      setHousekeeperData(housekeepersArray);
      setGrandTotal(total);
    } catch (error) {
      console.error('Error fetching linen data:', error);
      toast.error(t('common.error'));
    }
  };

  useEffect(() => {
    fetchData();
  }, [dateRange]);

  const exportToCSV = () => {
    if (!dateRange?.from || !dateRange?.to) return;
    
    const startDate = dateRange.from.toISOString().split('T')[0];
    const endDate = dateRange.to.toISOString().split('T')[0];
    
    let csv = 'Housekeepers,' + itemTotals.map(i => i.item_name).join(',') + ',Total\n';
    
    housekeeperData.forEach(hk => {
      const row = [
        hk.housekeeper_name,
        ...itemTotals.map(item => hk.items[item.item_name] || 0),
        hk.total
      ];
      csv += row.join(',') + '\n';
    });
    
    csv += '\nTOTAL,' + itemTotals.map(i => i.total_count).join(',') + ',' + grandTotal + '\n';


    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dirty-linen-${startDate}-to-${endDate}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t('linen.management')}</h2>
          <p className="text-muted-foreground">{t('linen.collectionSummary')}</p>
        </div>
        <Button onClick={exportToCSV} variant="outline">
          <Download className="h-4 w-4 mr-2" />
          {t('reports.export')}
        </Button>
      </div>

      <DateRangeFilter
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />

      <Tabs defaultValue="summary" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="summary">{t('linen.collectionSummary')}</TabsTrigger>
          <TabsTrigger value="details">{t('linen.byHousekeeper')}</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4">
          {/* Grand Total */}
          <Card className="p-6 bg-primary/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-primary/10 rounded-lg">
                  <Shirt className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('linen.totalCollected')}</p>
                  <p className="text-3xl font-bold">{grandTotal}</p>
                </div>
              </div>
              <Badge variant="secondary" className="text-lg px-4 py-2">
                {housekeeperData.length} {t('linen.housekeepers')}
              </Badge>
            </div>
          </Card>

          {/* Item Breakdown */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">{t('linen.byItemType')}</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {itemTotals.map((item) => (
                <div key={item.item_name} className="flex flex-col items-center p-4 bg-accent/50 rounded-lg">
                  <Shirt className="h-6 w-6 text-muted-foreground mb-2" />
                  <span className="text-sm text-center font-medium mb-1">{item.item_name}</span>
                  <Badge variant="outline" className="text-lg">
                    {item.total_count}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="details" className="space-y-4">
          <Card className="p-6">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2">
                    <th className="text-left p-3 font-semibold">{t('linen.housekeepers')}</th>
                    {itemTotals.map((item) => (
                      <th key={item.item_name} className="text-center p-3 font-semibold min-w-[100px]">
                        {item.item_name}
                      </th>
                    ))}
                    <th className="text-center p-3 font-semibold bg-primary/5">{t('linen.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {housekeeperData.map((hk, index) => (
                    <tr key={index} className="border-b hover:bg-accent/30 transition">
                      <td className="p-3 font-medium">{hk.housekeeper_name}</td>
                      {itemTotals.map((item) => (
                        <td key={item.item_name} className="text-center p-3">
                          {hk.items[item.item_name] || '-'}
                        </td>
                      ))}
                      <td className="text-center p-3 font-bold bg-primary/5">
                        {hk.total}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 font-bold bg-accent">
                    <td className="p-3">{t('linen.total').toUpperCase()}</td>
                    {itemTotals.map((item) => (
                      <td key={item.item_name} className="text-center p-3">
                        {item.total_count}
                      </td>
                    ))}
                    <td className="text-center p-3 bg-primary/10">
                      {grandTotal}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
