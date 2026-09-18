import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';
import { gozsduLinenLabel, loadHotelLinenCatalogue } from '@/lib/gozsduLinenCatalogue';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Settings, Plus, Edit2, Trash2, GripVertical } from 'lucide-react';
import { toast } from 'sonner';

type LinenItem = { id: string; name: string; display_name: string; is_active: boolean; sort_order: number };
type ItemFormData = Pick<LinenItem, 'name' | 'display_name' | 'is_active' | 'sort_order'>;

/** Top-level component, not recreated on every keystroke (preserves focus). */
function LinenItemForm({ formData, setFormData, editing, onSave, onCancel }: {
  formData: ItemFormData; setFormData: Dispatch<SetStateAction<ItemFormData>>;
  editing: boolean; onSave: () => void; onCancel: () => void;
}) {
  return <div className="space-y-4">
    <div className="space-y-2"><Label htmlFor="display_name">Display Name *</Label>
      <Input id="display_name" value={formData.display_name}
        onChange={e => setFormData(old => ({ ...old, display_name: e.target.value }))} placeholder="e.g., Pillow Cases" /></div>
    <div className="space-y-2"><Label htmlFor="name">Internal Name *</Label>
      <Input id="name" value={formData.name}
        onChange={e => setFormData(old => ({ ...old, name: e.target.value }))} placeholder="e.g., pillow_cases" /></div>
    <div className="space-y-2"><Label htmlFor="sort_order">Sort Order</Label>
      <Input id="sort_order" type="number" value={formData.sort_order}
        onChange={e => setFormData(old => ({ ...old, sort_order: parseInt(e.target.value) || 0 }))} /></div>
    <div className="flex items-center gap-2"><Switch checked={formData.is_active}
      onCheckedChange={checked => setFormData(old => ({ ...old, is_active: checked }))} /><Label>Active</Label></div>
    <div className="flex gap-2 pt-4"><Button variant="outline" onClick={onCancel} className="flex-1">Cancel</Button>
      <Button onClick={onSave} className="flex-1">{editing ? 'Update' : 'Add'} Item</Button></div>
  </div>;
}

export function DirtyLinenItemsManagement() {
  const { profile } = useAuth();
  const { t, language } = useTranslation();
  const gozsdu = isGozsduCourtHotel(profile?.assigned_hotel);
  const [linenItems, setLinenItems] = useState<LinenItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingItem, setEditingItem] = useState<LinenItem | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [formData, setFormData] = useState<ItemFormData>({ name: '', display_name: '', is_active: true, sort_order: 0 });

  const fetchLinenItems = useCallback(async () => {
    setLoading(true);
    try {
      if (gozsdu) {
        const data = await loadHotelLinenCatalogue(profile?.assigned_hotel);
        setLinenItems(data.map(item => ({ ...item, is_active: true })));
      } else {
        const { data, error } = await (supabase as any).from('dirty_linen_items')
          .select('*').is('hotel_scope', null).order('sort_order');
        if (error) throw error;
        setLinenItems((data || []) as LinenItem[]);
      }
    } catch (error) {
      console.error('[DirtyLinenItemsManagement] failed to load catalogue', error);
      setLinenItems([]);
      toast.error('Failed to load linen items');
    } finally { setLoading(false); }
  }, [gozsdu, profile?.assigned_hotel]);
  useEffect(() => { void fetchLinenItems(); }, [fetchLinenItems]);

  const handleAdd = () => {
    if (gozsdu) return;
    setEditingItem(null);
    setFormData({ name: '', display_name: '', is_active: true,
      sort_order: Math.max(...linenItems.map(item => item.sort_order), 0) + 1 });
    setIsAddDialogOpen(true);
  };
  const handleEdit = (item: LinenItem) => {
    if (gozsdu) return;
    setEditingItem(item);
    setFormData({ name: item.name, display_name: item.display_name, is_active: item.is_active, sort_order: item.sort_order });
    setIsEditDialogOpen(true);
  };
  const handleSave = async () => {
    if (gozsdu) return;
    if (!formData.name.trim() || !formData.display_name.trim()) { toast.error('Please fill in all required fields'); return; }
    try {
      const values = { ...formData, name: formData.name.toLowerCase().replace(/\s+/g, '_') };
      if (editingItem) {
        const { error } = await supabase.from('dirty_linen_items').update(values).eq('id', editingItem.id);
        if (error) throw error;
        setIsEditDialogOpen(false);
      } else {
        const { error } = await supabase.from('dirty_linen_items').insert([values]);
        if (error) throw error;
        setIsAddDialogOpen(false);
      }
      toast.success('Linen item saved');
      setEditingItem(null);
      void fetchLinenItems();
    } catch (error) { console.error('Error saving linen item:', error); toast.error('Failed to save linen item'); }
  };
  const handleDelete = async (item: LinenItem) => {
    if (gozsdu) return;
    try {
      const { error } = await supabase.from('dirty_linen_items').delete().eq('id', item.id);
      if (error) throw error;
      toast.success('Linen item deleted');
      void fetchLinenItems();
    } catch (error) { console.error('Error deleting linen item:', error); toast.error('Failed to delete linen item'); }
  };
  const toggleActive = async (item: LinenItem) => {
    if (gozsdu) return;
    try {
      const { error } = await supabase.from('dirty_linen_items').update({ is_active: !item.is_active }).eq('id', item.id);
      if (error) throw error;
      void fetchLinenItems();
    } catch (error) { console.error('Error updating linen item:', error); toast.error('Failed to update linen item'); }
  };

  return <div className="space-y-6">
    <div className="flex justify-between items-center gap-2">
      <div className="flex items-center gap-2"><Settings className="h-6 w-6 text-primary" /><h2 className="text-xl font-semibold">Linen Items Configuration</h2></div>
      {!gozsdu && <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogTrigger asChild><Button onClick={handleAdd} className="flex items-center gap-2"><Plus className="h-4 w-4" />Add Linen Item</Button></DialogTrigger>
        <DialogContent><DialogHeader><DialogTitle>Add New Linen Item</DialogTitle></DialogHeader>
          <LinenItemForm formData={formData} setFormData={setFormData} editing={false} onSave={handleSave} onCancel={() => setIsAddDialogOpen(false)} />
        </DialogContent>
      </Dialog>}
    </div>
    {gozsdu && <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">
      Gozsdu Court Budapest: fixed 15-item paper-sheet catalogue. Order and categories are shared by housekeepers, Laundryners and managers; other hotels are unaffected.
    </p>}
    <Card><CardHeader><CardTitle>Linen Items</CardTitle></CardHeader><CardContent>
      {loading ? <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        : <div className="space-y-2">{linenItems.map(item => <div key={item.id}
          className={`flex items-center justify-between p-3 border rounded-lg ${!item.is_active ? 'opacity-60 bg-gray-50' : ''}`}>
          <div className="flex items-center gap-3 min-w-0"><GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0"><div className="font-medium">{gozsdu ? gozsduLinenLabel(item, language, t) : item.display_name}</div>
              <div className="text-sm text-muted-foreground">{item.name} • Order: {item.sort_order}</div></div></div>
          {!gozsdu && <div className="flex items-center gap-2">
            <Switch checked={item.is_active} onCheckedChange={() => { void toggleActive(item); }} />
            <Dialog open={isEditDialogOpen && editingItem?.id === item.id} onOpenChange={setIsEditDialogOpen}>
              <DialogTrigger asChild><Button variant="outline" size="sm" onClick={() => handleEdit(item)}><Edit2 className="h-3 w-3" /></Button></DialogTrigger>
              <DialogContent><DialogHeader><DialogTitle>Edit Linen Item</DialogTitle></DialogHeader>
                <LinenItemForm formData={formData} setFormData={setFormData} editing onSave={handleSave} onCancel={() => setIsEditDialogOpen(false)} />
              </DialogContent>
            </Dialog>
            <AlertDialog><AlertDialogTrigger asChild><Button variant="outline" size="sm" className="text-destructive"><Trash2 className="h-3 w-3" /></Button></AlertDialogTrigger>
              <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete Linen Item</AlertDialogTitle>
                <AlertDialogDescription>Delete "{item.display_name}"? Existing count records might prevent this operation.</AlertDialogDescription>
              </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => { void handleDelete(item); }}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialog></div>}
        </div>)}</div>}
    </CardContent></Card>
  </div>;
}
