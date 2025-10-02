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
import { Shirt, Plus, CheckCircle, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

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

interface LinenRecord {
  id: string;
  linen_item_id: string;
  count: number;
  room_number: string;
  display_name: string;
  work_date: string;
}

export function DirtyLinenDialog({ open, onOpenChange, roomId, roomNumber, assignmentId }: DirtyLinenDialogProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [linenItems, setLinenItems] = useState<LinenItem[]>([]);
  const [linenCounts, setLinenCounts] = useState<LinenCount[]>([]);
  const [myRecords, setMyRecords] = useState<LinenRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [autoSaveTimeout, setAutoSaveTimeout] = useState<NodeJS.Timeout | null>(null);
  const [showMyRecords, setShowMyRecords] = useState(false);

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

  const fetchMyRecords = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('dirty_linen_counts')
        .select(`
          id,
          linen_item_id,
          count,
          work_date,
          room_id,
          created_at,
          rooms(room_number),
          dirty_linen_items(display_name)
        `)
        .eq('housekeeper_id', user.id)
        .eq('work_date', today)
        .gt('count', 0)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      const records = (data || []).map(record => ({
        id: record.id,
        linen_item_id: record.linen_item_id,
        count: record.count,
        work_date: record.work_date,
        room_number: (record.rooms as any)?.room_number || 'Unknown',
        display_name: (record.dirty_linen_items as any)?.display_name || 'Unknown Item'
      }));
      
      setMyRecords(records);
    } catch (error) {
      console.error('Error fetching my records:', error);
    }
  }, [user?.id]);

  useEffect(() => {
    if (open) {
      fetchLinenItems();
      fetchExistingCounts();
      fetchMyRecords();
      
      // Set up real-time subscription for all changes
      const channel = supabase
        .channel('dirty-linen-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'dirty_linen_counts'
          },
          (payload) => {
            console.log('Real-time: dirty linen change detected, refetching');
            // Refetch both current room counts and all user records
            fetchExistingCounts();
            fetchMyRecords();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [open, roomId, fetchExistingCounts, fetchMyRecords]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
      }
    };
  }, [autoSaveTimeout]);

  const autoSave = useCallback(async (counts: LinenCount[]) => {
    if (!user?.id || autoSaving) return;
    
    setAutoSaving(true);
    const today = new Date().toISOString().split('T')[0];
    
    try {
      // Handle each count individually
      for (const count of counts) {
        if (count.count > 0) {
          // Use upsert for positive counts
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
          // Delete zero counts
          await supabase
            .from('dirty_linen_counts')
            .delete()
            .eq('housekeeper_id', user.id)
            .eq('room_id', roomId)
            .eq('linen_item_id', count.linen_item_id)
            .eq('work_date', today);
        }
      }
      
      setLastSaved(new Date());
      console.log('Auto-save completed successfully');
      
      // Refresh the cart immediately after save
      fetchMyRecords();
      
    } catch (error) {
      console.error('Auto-save error:', error);
      toast.error('Auto-save failed: ' + (error as any)?.message || 'Unknown error');
    } finally {
      setAutoSaving(false);
    }
  }, [user?.id, roomId, assignmentId, fetchMyRecords]);

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

    // Clear existing timeout
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }
    
    // Save all updated counts to prevent inconsistencies
    const timeout = setTimeout(() => {
      autoSave(updatedCounts);
    }, 300); // Reduced delay for better UX
    
    setAutoSaveTimeout(timeout);
  };

  const deleteRecord = async (recordId: string) => {
    try {
      const { error } = await supabase
        .from('dirty_linen_counts')
        .delete()
        .eq('id', recordId)
        .eq('housekeeper_id', user?.id); // Security check

      if (error) throw error;
      
      toast.success('Record deleted successfully');
      fetchMyRecords(); // Refresh the list
      fetchExistingCounts(); // Refresh current room counts
    } catch (error) {
      console.error('Error deleting record:', error);
      toast.error('Failed to delete record');
    }
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
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shirt className="h-5 w-5" />
              {t('dirtyLinen.title')} - {t('common.room')} {roomNumber}
            </div>
            <div className="flex gap-2">
              <Button
                variant={showMyRecords ? "default" : "outline"}
                size="sm"
                onClick={() => setShowMyRecords(!showMyRecords)}
                className={showMyRecords ? "bg-primary hover:bg-primary/90 text-primary-foreground" : "border-primary text-primary hover:bg-primary/10"}
              >
                🛒 My Dirty Linen Cart ({myRecords.length})
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        {showMyRecords ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">My Dirty Linen Cart</h3>
              <Badge variant="outline" className="bg-blue-50">
                {myRecords.reduce((total, record) => total + record.count, 0)} Total Items
              </Badge>
            </div>
            
            <p className="text-sm text-muted-foreground">
              Items collected from different rooms today. You can remove items if collected by mistake.
            </p>
            
            {myRecords.length === 0 ? (
              <div className="text-center py-8">
                <div className="bg-muted rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                  <Shirt className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground">No dirty linen collected today</p>
                <p className="text-sm text-muted-foreground mt-1">Start collecting from rooms to see them here</p>
              </div>
            ) : (
              <div className="space-y-2">
                {myRecords.map((record) => (
                  <Card key={record.id} className="p-4 hover:shadow-md transition-shadow">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="default" className="font-mono text-xs">
                              Room {record.room_number}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {new Date(record.work_date).toLocaleDateString()}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-base">{record.display_name}</span>
                            <div className="flex items-center gap-1">
                              <Shirt className="h-4 w-4 text-primary" />
                              <Badge variant="secondary" className="text-sm font-bold">
                                × {record.count}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove from Cart</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to remove "{record.display_name}" from Room {record.room_number}? 
                                This will permanently delete this record.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => deleteRecord(record.id)}
                                className="bg-red-600 hover:bg-red-700"
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
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
          </>
        )}

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