import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from 'sonner';
import { Shirt, Plus, Minus, CheckCircle } from 'lucide-react';

interface DirtyLinenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
  roomNumber: string;
  assignmentId?: string;
}

interface LinenItem {
  id: string;
  name: string;
  display_name: string;
  sort_order: number;
}

interface LinenCount {
  linen_item_id: string;
  count: number;
}

export function DirtyLinenDialog({ open, onOpenChange, roomId, roomNumber, assignmentId }: DirtyLinenDialogProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [linenItems, setLinenItems] = useState<LinenItem[]>([]);
  const [linenCounts, setLinenCounts] = useState<LinenCount[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [autoSaveTimeout, setAutoSaveTimeout] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (open) {
      fetchLinenItems();
      fetchExistingCounts();
      
      // Set up real-time subscription for all changes
      const channel = supabase
        .channel('dirty-linen-changes')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'dirty_linen_counts',
            filter: `room_id=eq.${roomId}`
          },
          () => {
            console.log('Real-time: INSERT detected, refetching counts');
            fetchExistingCounts();
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'dirty_linen_counts',
            filter: `room_id=eq.${roomId}`
          },
          () => {
            console.log('Real-time: UPDATE detected, refetching counts');
            fetchExistingCounts();
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'DELETE',
            schema: 'public',
            table: 'dirty_linen_counts',
            filter: `room_id=eq.${roomId}`
          },
          () => {
            console.log('Real-time: DELETE detected, refetching counts');
            fetchExistingCounts();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [open, roomId]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
      }
    };
  }, [autoSaveTimeout]);

  const fetchLinenItems = async () => {
    try {
      const { data, error } = await supabase
        .from('dirty_linen_items')
        .select('id, name, display_name, sort_order')
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;
      setLinenItems(data || []);
    } catch (error) {
      console.error('Error fetching linen items:', error);
      toast.error('Failed to load linen items');
    }
  };

  const fetchExistingCounts = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('dirty_linen_counts')
        .select('linen_item_id, count')
        .eq('housekeeper_id', user.id)
        .eq('room_id', roomId)
        .eq('work_date', today);

      if (error) throw error;
      setLinenCounts(data || []);
    } catch (error) {
      console.error('Error fetching existing counts:', error);
    }
  }, [user?.id, roomId]);

  const autoSave = useCallback(async (counts: LinenCount[]) => {
    if (!user?.id || autoSaving) return;
    
    setAutoSaving(true);
    const today = new Date().toISOString().split('T')[0];
    
    try {
      // Handle each count individually to avoid batch operation issues
      for (const count of counts) {
        if (count.count > 0) {
          // Use upsert with proper on_conflict handling
          const { error } = await supabase
            .from('dirty_linen_counts')
            .upsert({
              housekeeper_id: user.id,
              room_id: roomId,
              assignment_id: assignmentId || null,
              linen_item_id: count.linen_item_id,
              count: count.count,
              work_date: today,
            }, {
              onConflict: 'housekeeper_id,room_id,linen_item_id,work_date',
              ignoreDuplicates: false
            });
            
          if (error) {
            console.error('Upsert error for linen item:', count.linen_item_id, error);
            throw error;
          }
        } else {
          // Delete zero counts - don't throw on errors for non-existent records
          const { error } = await supabase
            .from('dirty_linen_counts')
            .delete()
            .eq('housekeeper_id', user.id)
            .eq('room_id', roomId)
            .eq('linen_item_id', count.linen_item_id)
            .eq('work_date', today);
            
          if (error) {
            console.warn('Delete error for linen item:', count.linen_item_id, error);
          }
        }
      }
      
      setLastSaved(new Date());
      console.log('Auto-save completed successfully');
      
    } catch (error) {
      console.error('Auto-save error:', error);
      toast.error('Auto-save failed: ' + (error as any)?.message || 'Unknown error');
    } finally {
      setAutoSaving(false);
    }
  }, [user?.id, roomId, assignmentId]);

  const updateCount = (linenItemId: string, newCount: number) => {
    // Allow zero but not negative values
    if (newCount < 0) newCount = 0;
    
    const updatedCounts = (() => {
      const existing = linenCounts.find(c => c.linen_item_id === linenItemId);
      if (existing) {
        // Update existing count
        return linenCounts.map(c => 
          c.linen_item_id === linenItemId ? { ...c, count: newCount } : c
        );
      } else if (newCount > 0) {
        // Add new count only if greater than 0
        return [...linenCounts, { linen_item_id: linenItemId, count: newCount }];
      } else {
        // If newCount is 0 and no existing record, don't add anything
        return linenCounts;
      }
    })();
    
    setLinenCounts(updatedCounts);

    // Auto-save with debounce
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }
    
    const timeout = setTimeout(() => {
      // Include all items for save, even zero counts (will be deleted server-side)
      const allCounts = linenItems.map(item => ({
        linen_item_id: item.id,
        count: getCountFromUpdated(item.id, updatedCounts)
      }));
      autoSave(allCounts);
    }, 1500); // 1.5 second delay
    
    setAutoSaveTimeout(timeout);
  };

  // Helper function to get count from updated array
  const getCountFromUpdated = (linenItemId: string, counts: LinenCount[]): number => {
    const item = counts.find(count => count.linen_item_id === linenItemId);
    return item ? item.count : 0;
  };

  const getCount = (linenItemId: string): number => {
    const item = linenCounts.find(count => count.linen_item_id === linenItemId);
    return item ? item.count : 0;
  };

  const getTotalItems = () => {
    return linenCounts.reduce((total, item) => total + item.count, 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shirt className="h-5 w-5" />
            {t('dirtyLinen.title')} - {t('common.room')} {roomNumber}
          </DialogTitle>
        </DialogHeader>

        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center justify-between">
              {t('dirtyLinen.todaysCount')}
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {getTotalItems()} {t('dirtyLinen.items')}
                </Badge>
                {autoSaving && (
                  <div className="flex items-center gap-1">
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary"></div>
                    <span className="text-xs text-muted-foreground">Saving...</span>
                  </div>
                )}
                {lastSaved && !autoSaving && (
                  <div className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-green-500" />
                    <span className="text-xs text-muted-foreground">Saved</span>
                  </div>
                )}
              </div>
            </CardTitle>
          </CardHeader>
        </Card>

        <div className="space-y-3">
          {linenItems.map((item) => (
            <Card key={item.id} className="p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  {item.display_name}
                </Label>
                
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => updateCount(item.id, Math.max(0, getCount(item.id) - 1))}
                    disabled={getCount(item.id) === 0}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  
                  <Input
                    type="number"
                    min="0"
                    value={getCount(item.id)}
                    onChange={(e) => updateCount(item.id, parseInt(e.target.value) || 0)}
                    className="h-8 w-16 text-center"
                  />
                  
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => updateCount(item.id, getCount(item.id) + 1)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="flex gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
            {t('common.close')}
          </Button>
          <div className="flex-1 text-center">
            <p className="text-xs text-muted-foreground">
              {t('dirtyLinen.autoSave')}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}