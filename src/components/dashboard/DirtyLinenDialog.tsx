import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shirt, Plus, Minus, Save } from 'lucide-react';
import { toast } from 'sonner';

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

export function DirtyLinenDialog({
  open,
  onOpenChange,
  roomId,
  roomNumber,
  assignmentId,
}: DirtyLinenDialogProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [linenItems, setLinenItems] = useState<LinenItem[]>([]);
  const [linenCounts, setLinenCounts] = useState<LinenCount[]>([]);
  const [existingCounts, setExistingCounts] = useState<LinenCount[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      fetchLinenItems();
      fetchExistingCounts();
    }
  }, [open, roomId]);

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

  const fetchExistingCounts = async () => {
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
      
      const existing = data || [];
      setExistingCounts(existing);
      setLinenCounts(existing);
    } catch (error) {
      console.error('Error fetching existing counts:', error);
    }
  };

  const updateCount = (linenItemId: string, newCount: number) => {
    const count = Math.max(0, newCount); // Prevent negative counts
    setLinenCounts(prev => {
      const existing = prev.find(item => item.linen_item_id === linenItemId);
      if (existing) {
        return prev.map(item => 
          item.linen_item_id === linenItemId ? { ...item, count } : item
        );
      } else {
        return [...prev, { linen_item_id: linenItemId, count }];
      }
    });
  };

  const getCount = (linenItemId: string): number => {
    const item = linenCounts.find(count => count.linen_item_id === linenItemId);
    return item ? item.count : 0;
  };

  const handleSave = async () => {
    if (!user?.id) return;

    setSaving(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Delete existing counts for this room and date
      await supabase
        .from('dirty_linen_counts')
        .delete()
        .eq('housekeeper_id', user.id)
        .eq('room_id', roomId)
        .eq('work_date', today);

      // Insert new counts (only for items with count > 0)
      const countsToInsert = linenCounts
        .filter(item => item.count > 0)
        .map(item => ({
          housekeeper_id: user.id,
          room_id: roomId,
          assignment_id: assignmentId || null,
          linen_item_id: item.linen_item_id,
          count: item.count,
          work_date: today,
        }));

      if (countsToInsert.length > 0) {
        const { error } = await supabase
          .from('dirty_linen_counts')
          .insert(countsToInsert);

        if (error) throw error;
      }

      toast.success('Dirty linen count saved successfully');
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving linen counts:', error);
      toast.error('Failed to save linen counts');
    } finally {
      setSaving(false);
    }
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
            Dirty Linen Count - Room {roomNumber}
          </DialogTitle>
        </DialogHeader>

        <Card className="mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center justify-between">
              Today's Count
              <Badge variant="outline">
                {getTotalItems()} items
              </Badge>
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
                    onClick={() => updateCount(item.id, getCount(item.id) - 1)}
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
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save Count'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}