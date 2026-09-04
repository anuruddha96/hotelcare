import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Minus, Plus, Shirt, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { getLocalDateString } from '@/lib/utils';
import { translateLinenItem } from '@/lib/linen-item-i18n';
import { toast } from 'sonner';

export type PublicLinenArea = 'gym' | 'sauna' | 'jacuzzi';

interface PublicAreaDirtyLinenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  areaType: PublicLinenArea;
  hotel: string;
  taskId?: string | null;
}

interface LinenItem {
  id: string;
  name: string;
  display_name: string;
  sort_order: number;
}

const AREA_META: Record<PublicLinenArea, { label: string; icon: string }> = {
  gym: { label: 'Gym', icon: '🏋️' },
  sauna: { label: 'Sauna', icon: '♨️' },
  jacuzzi: { label: 'Jacuzzi', icon: '🫧' },
};

export function PublicAreaDirtyLinenDialog({
  open,
  onOpenChange,
  areaType,
  hotel,
  taskId,
}: PublicAreaDirtyLinenDialogProps) {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const [items, setItems] = useState<LinenItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [savingItems, setSavingItems] = useState<Set<string>>(new Set());
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const meta = AREA_META[areaType];
  const today = getLocalDateString(new Date());

  const total = useMemo(
    () => Object.values(counts).reduce((sum, value) => sum + value, 0),
    [counts],
  );

  const loadData = async () => {
    if (!user?.id || !hotel) return;
    setLoading(true);
    try {
      const { data: itemRows, error: itemError } = await supabase
        .from('dirty_linen_items')
        .select('id, name, display_name, sort_order')
        .eq('is_active', true)
        .in('name', ['small_towel', 'big_towel'])
        .order('sort_order', { ascending: true });
      if (itemError) throw itemError;

      const towelItems = (itemRows || []) as LinenItem[];
      setItems(towelItems);

      const { data: existingRows, error: countError } = await (supabase as any)
        .from('dirty_linen_public_area_counts')
        .select('linen_item_id, count')
        .eq('housekeeper_id', user.id)
        .eq('hotel', hotel)
        .eq('area_type', areaType)
        .eq('work_date', today);
      if (countError) throw countError;

      const nextCounts: Record<string, number> = {};
      towelItems.forEach(item => { nextCounts[item.id] = 0; });
      (existingRows || []).forEach((row: any) => {
        nextCounts[row.linen_item_id] = row.count || 0;
      });
      setCounts(nextCounts);
    } catch (error) {
      console.error('Failed to load public area linen:', error);
      toast.error('Could not load towel counts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void loadData();
  }, [open, user?.id, hotel, areaType]);

  useEffect(() => {
    if (!open || !user?.id) return;
    const channel = (supabase as any)
      .channel(`public-linen-${user.id}-${areaType}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'dirty_linen_public_area_counts',
        filter: `housekeeper_id=eq.${user.id}`,
      }, () => { void loadData(); })
      .subscribe();

    return () => { (supabase as any).removeChannel(channel); };
  }, [open, user?.id, areaType, hotel]);

  useEffect(() => () => {
    Object.values(saveTimers.current).forEach(timer => clearTimeout(timer));
  }, []);

  const persistCount = async (linenItemId: string, count: number) => {
    if (!user?.id || !hotel) return;
    setSavingItems(prev => new Set(prev).add(linenItemId));
    try {
      if (count <= 0) {
        const { error } = await (supabase as any)
          .from('dirty_linen_public_area_counts')
          .delete()
          .eq('housekeeper_id', user.id)
          .eq('hotel', hotel)
          .eq('area_type', areaType)
          .eq('linen_item_id', linenItemId)
          .eq('work_date', today);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from('dirty_linen_public_area_counts')
          .upsert({
            housekeeper_id: user.id,
            task_id: taskId || null,
            area_type: areaType,
            hotel,
            linen_item_id: linenItemId,
            count,
            work_date: today,
            organization_slug: profile?.organization_slug || null,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'housekeeper_id,hotel,area_type,linen_item_id,work_date',
            ignoreDuplicates: false,
          });
        if (error) throw error;
      }
      setLastSavedAt(new Date());
    } catch (error) {
      console.error('Failed saving public-area linen:', error);
      toast.error('Towel count was not saved. Please try again.');
      void loadData();
    } finally {
      setSavingItems(prev => {
        const next = new Set(prev);
        next.delete(linenItemId);
        return next;
      });
    }
  };

  const changeCount = (linenItemId: string, delta: number) => {
    setCounts(prev => {
      const nextValue = Math.max(0, (prev[linenItemId] || 0) + delta);
      const next = { ...prev, [linenItemId]: nextValue };

      if (saveTimers.current[linenItemId]) clearTimeout(saveTimers.current[linenItemId]);
      setSavingItems(current => new Set(current).add(linenItemId));
      saveTimers.current[linenItemId] = setTimeout(() => {
        void persistCount(linenItemId, nextValue);
      }, 180);

      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <span className="text-xl">{meta.icon}</span>
            {meta.label} dirty linen
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 p-3">
            <div>
              <p className="text-sm font-medium">Towels collected</p>
              <p className="text-xs text-muted-foreground">Tap + or −. Changes save automatically.</p>
            </div>
            <Badge className="text-base px-3 py-1.5">{total}</Badge>
          </div>

          {loading ? (
            <div className="py-10 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Small Towel and Big Towel are not configured as active linen items.
            </div>
          ) : (
            <div className="space-y-3">
              {items.map(item => {
                const count = counts[item.id] || 0;
                const saving = savingItems.has(item.id);
                return (
                  <Card key={item.id} className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Shirt className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{translateLinenItem(item.display_name, t)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {saving ? 'Saving…' : 'Saved automatically'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-10 w-10 rounded-full"
                          onClick={() => changeCount(item.id, -1)}
                          disabled={count === 0}
                          aria-label={`Remove one ${item.display_name}`}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="w-8 text-center text-xl font-bold tabular-nums">{count}</span>
                        <Button
                          type="button"
                          size="icon"
                          className="h-10 w-10 rounded-full"
                          onClick={() => changeCount(item.id, 1)}
                          aria-label={`Add one ${item.display_name}`}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-3">
            <span>{hotel}</span>
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {lastSavedAt ? `Last saved ${lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Live sync ready'}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
