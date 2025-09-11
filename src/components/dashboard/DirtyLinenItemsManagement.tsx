import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Settings, Plus, Edit2, Trash2, GripVertical } from 'lucide-react';
import { toast } from 'sonner';

interface LinenItem {
  id: string;
  name: string;
  display_name: string;
  is_active: boolean;
  sort_order: number;
}

export function DirtyLinenItemsManagement() {
  const { t } = useTranslation();
  const [linenItems, setLinenItems] = useState<LinenItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingItem, setEditingItem] = useState<LinenItem | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    display_name: '',
    is_active: true,
    sort_order: 0,
  });

  useEffect(() => {
    fetchLinenItems();
  }, []);

  const fetchLinenItems = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('dirty_linen_items')
        .select('*')
        .order('sort_order');

      if (error) throw error;
      setLinenItems(data || []);
    } catch (error) {
      console.error('Error fetching linen items:', error);
      toast.error('Failed to load linen items');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    const maxSortOrder = Math.max(...linenItems.map(item => item.sort_order), 0);
    setFormData({
      name: '',
      display_name: '',
      is_active: true,
      sort_order: maxSortOrder + 1,
    });
    setIsAddDialogOpen(true);
  };

  const handleEdit = (item: LinenItem) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      display_name: item.display_name,
      is_active: item.is_active,
      sort_order: item.sort_order,
    });
    setIsEditDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.display_name) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      const itemData = {
        name: formData.name.toLowerCase().replace(/\s+/g, '_'),
        display_name: formData.display_name,
        is_active: formData.is_active,
        sort_order: formData.sort_order,
      };

      if (editingItem) {
        const { error } = await supabase
          .from('dirty_linen_items')
          .update(itemData)
          .eq('id', editingItem.id);

        if (error) throw error;
        toast.success('Linen item updated successfully');
        setIsEditDialogOpen(false);
      } else {
        const { error } = await supabase
          .from('dirty_linen_items')
          .insert([itemData]);

        if (error) throw error;
        toast.success('Linen item added successfully');
        setIsAddDialogOpen(false);
      }

      fetchLinenItems();
      setEditingItem(null);
    } catch (error) {
      console.error('Error saving linen item:', error);
      toast.error('Failed to save linen item');
    }
  };

  const handleDelete = async (item: LinenItem) => {
    try {
      const { error } = await supabase
        .from('dirty_linen_items')
        .delete()
        .eq('id', item.id);

      if (error) throw error;
      toast.success('Linen item deleted successfully');
      fetchLinenItems();
    } catch (error) {
      console.error('Error deleting linen item:', error);
      toast.error('Failed to delete linen item');
    }
  };

  const toggleActive = async (item: LinenItem) => {
    try {
      const { error } = await supabase
        .from('dirty_linen_items')
        .update({ is_active: !item.is_active })
        .eq('id', item.id);

      if (error) throw error;
      fetchLinenItems();
    } catch (error) {
      console.error('Error updating linen item:', error);
      toast.error('Failed to update linen item');
    }
  };

  const ItemForm = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="display_name">Display Name *</Label>
        <Input
          id="display_name"
          value={formData.display_name}
          onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
          placeholder="e.g., Pillow Cases"
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="name">Internal Name *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g., pillow_cases (auto-generated if empty)"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sort_order">Sort Order</Label>
        <Input
          id="sort_order"
          type="number"
          value={formData.sort_order}
          onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
        />
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          checked={formData.is_active}
          onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
        />
        <Label>Active</Label>
      </div>

      <div className="flex gap-2 pt-4">
        <Button 
          variant="outline" 
          onClick={() => {
            setIsAddDialogOpen(false);
            setIsEditDialogOpen(false);
          }}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button onClick={handleSave} className="flex-1">
          {editingItem ? 'Update' : 'Add'} Item
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Settings className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-semibold">Linen Items Configuration</h2>
        </div>
        
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleAdd} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Linen Item
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Linen Item</DialogTitle>
            </DialogHeader>
            <ItemForm />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Linen Items</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <div className="space-y-2">
              {linenItems.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between p-3 border rounded-lg ${
                    !item.is_active ? 'opacity-60 bg-gray-50' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{item.display_name}</div>
                      <div className="text-sm text-muted-foreground">
                        {item.name} • Order: {item.sort_order}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={item.is_active}
                      onCheckedChange={() => toggleActive(item)}
                    />
                    
                    <Dialog open={isEditDialogOpen && editingItem?.id === item.id} onOpenChange={setIsEditDialogOpen}>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(item)}
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Edit Linen Item</DialogTitle>
                        </DialogHeader>
                        <ItemForm />
                      </DialogContent>
                    </Dialog>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Linen Item</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{item.display_name}"? 
                            This will also delete all associated count records.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(item)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}