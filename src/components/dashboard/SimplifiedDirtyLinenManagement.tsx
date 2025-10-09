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

interface LinenItemTotal {
  item_name: string;
  total_count: number;
}

interface HousekeeperData {
  housekeeper_name: string;
  items: { [key: string]: number };
  total: number;
}

// Mapping of linen item names to translation keys
const linenItemTranslations: { [key: string]: string } = {
  'Bath Mat': 'linen.bathMat',
  'Bed Sheets Queen Size': 'linen.bedSheetsQueenSize',
  'Bed Sheets Twin Size': 'linen.bedSheetsTwinSize',
  'Big Pillow': 'linen.bigPillow',
  'Big Towel': 'linen.bigTowel',
  'Duvet Covers': 'linen.duvetCovers',
  'Small Towel': 'linen.smallTowel',
};

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

  // Get translated linen item name
  const getTranslatedLinenName = (itemName: string): string => {
    const translationKey = linenItemTranslations[itemName];
    return translationKey ? t(translationKey) : itemName;
  };

  const fetchData = async () => {
    if (!dateRange?.from || !dateRange?.to) return;
    
    const startDate = dateRange.from.toISOString().split('T')[0];
    const endDate = dateRange.to.toISOString().split('T')[0];
    
    try {
      // Step 1: Fetch dirty linen counts without joins
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

      if (!countsData || countsData.length === 0) {
        setItemTotals([]);
        setHousekeeperData([]);
        setGrandTotal(0);
        return;
      }

      // Step 2: Fetch housekeeper profiles separately
      const housekeeperIds = Array.from(new Set(countsData.map(c => c.housekeeper_id)));
      const { data: housekeepersData, error: housekeepersError } = await supabase
        .from('profiles')
        .select('id, full_name, nickname')
        .in('id', housekeeperIds);

      if (housekeepersError) {
        console.error('Error fetching housekeepers:', housekeepersError);
      }

      // Step 3: Fetch linen items separately
      const linenItemIds = Array.from(new Set(countsData.map(c => c.linen_item_id)));
      const { data: linenItemsData, error: linenItemsError } = await supabase
        .from('dirty_linen_items')
        .select('id, display_name')
        .in('id', linenItemIds);

      if (linenItemsError) {
        console.error('Error fetching linen items:', linenItemsError);
      }

      // Step 4: Create lookup maps
      const housekeepersMap = new Map(
        housekeepersData?.map(h => [h.id, h.nickname || h.full_name]) || []
      );
      const linenItemsMap = new Map(
        linenItemsData?.map(l => [l.id, l.display_name]) || []
      );

      // Step 5: Calculate totals by item type and housekeeper
      const itemMap = new Map<string, number>();
      const housekeeperMap = new Map<string, { items: Map<string, number>, total: number }>();
      let total = 0;

      countsData.forEach((record) => {
        const itemName = linenItemsMap.get(record.linen_item_id) || 'Unknown';
        const housekeeperName = housekeepersMap.get(record.housekeeper_id) || 'Unknown';
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
      const itemsArray = Array.from(itemMap.entries())
        .map(([item_name, total_count]) => ({
          item_name,
          total_count
        }))
        .sort((a, b) => a.item_name.localeCompare(b.item_name));

      const housekeepersArray = Array.from(housekeeperMap.entries())
        .map(([housekeeper_name, data]) => ({
          housekeeper_name,
          items: Object.fromEntries(data.items),
          total: data.total
        }))
        .sort((a, b) => a.housekeeper_name.localeCompare(b.housekeeper_name));

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
  }, [dateRange?.from?.toISOString(), dateRange?.to?.toISOString()]); // Watch for actual date changes

  const exportToCSV = () => {
    if (!dateRange?.from || !dateRange?.to) return;
    
    const startDate = dateRange.from.toISOString().split('T')[0];
    const endDate = dateRange.to.toISOString().split('T')[0];
    
    // Header row with translated names
    let csv = t('linen.housekeepers') + ',' + itemTotals.map(i => getTranslatedLinenName(i.item_name)).join(',') + ',' + t('linen.total') + '\n';
    
    housekeeperData.forEach(hk => {
      const row = [
        hk.housekeeper_name,
        ...itemTotals.map(item => hk.items[item.item_name] || 0),
        hk.total
      ];
      csv += row.join(',') + '\n';
    });
    
    csv += '\n' + t('linen.total').toUpperCase() + ',' + itemTotals.map(i => i.total_count).join(',') + ',' + grandTotal + '\n';


    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dirty-linen-${startDate}-to-${endDate}.csv`;
    a.click();
  };

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

        {/* Main Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border">
            <thead>
              <tr className="bg-muted">
                <th className="border p-3 text-left font-bold min-w-[150px]">{t('linen.housekeepers')}</th>
                {itemTotals.map((item) => (
                  <th key={item.item_name} className="border p-3 text-center font-bold min-w-[120px] whitespace-nowrap">
                    {getTranslatedLinenName(item.item_name)}
                  </th>
                ))}
                <th className="border p-3 text-center font-bold bg-primary/10 min-w-[100px]">{t('linen.total').toUpperCase()}</th>
              </tr>
            </thead>
            <tbody>
              {housekeeperData.length === 0 ? (
                <tr>
                  <td colSpan={itemTotals.length + 2} className="border p-8 text-center text-muted-foreground">
                    No data available for the selected date range
                  </td>
                </tr>
              ) : (
                <>
                  {housekeeperData.map((hk, index) => (
                    <tr key={index} className="hover:bg-accent/30 transition">
                      <td className="border p-3 font-medium">{hk.housekeeper_name}</td>
                      {itemTotals.map((item) => (
                        <td key={item.item_name} className="border p-3 text-center">
                          {hk.items[item.item_name] || '-'}
                        </td>
                      ))}
                      <td className="border p-3 text-center font-bold bg-primary/5">
                        {hk.total}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-accent font-bold">
                    <td className="border p-3">{t('linen.total').toUpperCase()}</td>
                    {itemTotals.map((item) => (
                      <td key={item.item_name} className="border p-3 text-center">
                        {item.total_count}
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
      </Card>
    </div>
  );
}
