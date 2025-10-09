import { useState, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ShoppingCart, Trash2, Shirt } from 'lucide-react';
import { toast } from 'sonner';

interface LinenRecord {
  id: string;
  room_number: string;
  linen_item_name: string;
  count: number;
  work_date: string;
}

interface LinenSummary {
  item_name: string;
  total_count: number;
}

export function DirtyLinenCartBadge() {
  const { t } = useTranslation();
  const [totalItems, setTotalItems] = useState(0);
  const [records, setRecords] = useState<LinenRecord[]>([]);
  const [summary, setSummary] = useState<LinenSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Get current user
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUserId(user.id);
        // Get user profile to check role
        supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()
          .then(({ data }) => {
            setUserRole(data?.role || null);
          });
      }
    });
  }, []);

  const fetchCartData = async () => {
    if (!userId) return;

    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('dirty_linen_counts')
      .select(`
        id,
        count,
        work_date,
        rooms:room_id (room_number),
        dirty_linen_items:linen_item_id (display_name)
      `)
      .eq('housekeeper_id', userId)
      .eq('work_date', today)
      .gt('count', 0);

    if (error) {
      console.error('Error fetching cart data:', error);
      return;
    }

    const formattedRecords = data.map((item: any) => ({
      id: item.id,
      room_number: item.rooms?.room_number || 'Unknown',
      linen_item_name: item.dirty_linen_items?.display_name || 'Unknown',
      count: item.count,
      work_date: item.work_date
    }));

    setRecords(formattedRecords);

    // Calculate total items
    const total = formattedRecords.reduce((sum, record) => sum + record.count, 0);
    setTotalItems(total);

    // Calculate summary by item type
    const summaryMap = new Map<string, number>();
    formattedRecords.forEach(record => {
      const current = summaryMap.get(record.linen_item_name) || 0;
      summaryMap.set(record.linen_item_name, current + record.count);
    });

    const summaryArray = Array.from(summaryMap.entries()).map(([item_name, total_count]) => ({
      item_name,
      total_count
    }));

    setSummary(summaryArray);
  };

  useEffect(() => {
    fetchCartData();

    // Subscribe to real-time updates
    const channel = supabase
      .channel('dirty-linen-cart-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'dirty_linen_counts',
          filter: `housekeeper_id=eq.${userId}`
        },
        () => {
          fetchCartData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const handleDeleteRecord = async (recordId: string) => {
    const { error } = await supabase
      .from('dirty_linen_counts')
      .delete()
      .eq('id', recordId);

    if (error) {
      toast.error(t('common.error'), {
        description: 'Failed to delete item'
      });
      return;
    }

    toast.success(t('common.success'), {
      description: 'Item removed from cart'
    });

    fetchCartData();
  };

  // Only show for housekeeping staff
  if (userRole !== 'housekeeping') {
    return null;
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <ShoppingCart className="h-5 w-5" />
          {totalItems > 0 && (
            <Badge 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
              variant="destructive"
            >
              {totalItems}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:w-[400px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            {t('linen.myCart')}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Summary Section */}
          <div className="bg-primary/5 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{t('linen.todayTotal')}</span>
              <Badge variant="secondary" className="text-lg">
                {totalItems} {t('linen.items')}
              </Badge>
            </div>
            
            {summary.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <span className="text-sm text-muted-foreground">{t('linen.breakdown')}</span>
                {summary.map((item) => (
                  <div key={item.item_name} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <Shirt className="h-4 w-4 text-muted-foreground" />
                      {item.item_name}
                    </span>
                    <span className="font-medium">× {item.total_count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Detailed Records */}
          <div className="space-y-2">
            <h4 className="font-medium text-sm text-muted-foreground">{t('linen.detailedRecords')}</h4>
            <ScrollArea className="h-[calc(100vh-400px)]">
              <div className="space-y-2">
                {records.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <ShoppingCart className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>{t('linen.emptyCart')}</p>
                  </div>
                ) : (
                  records.map((record) => (
                    <div 
                      key={record.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {t('room.label')} {record.room_number}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Shirt className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{record.linen_item_name}</span>
                          <span className="text-muted-foreground">× {record.count}</span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteRecord(record.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
