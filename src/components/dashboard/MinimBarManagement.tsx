import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Trash2, Coffee, Wine, Package } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface MinibarItem {
  id: string;
  name: string;
  category: string;
  price: number;
  is_active: boolean;
  created_at: string;
}

interface MinimBarManagementProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MinimBarManagement({ open, onOpenChange }: MinimBarManagementProps) {
  const [items, setItems] = useState<MinibarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingItem, setEditingItem] = useState<MinibarItem | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    category: 'beverage',
    price: '',
    is_active: true
  });

  useEffect(() => {
    if (open) {
      fetchItems();
    }
  }, [open]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('minibar_items')
        .select('*')
        .order('category', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      setItems(data || []);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch minibar items',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.price) {
      toast({
        title: 'Error',
        description: 'Name and price are required',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const itemData = {
        name: formData.name,
        category: formData.category,
        price: parseFloat(formData.price),
        is_active: formData.is_active
      };

      if (editingItem) {
        const { error } = await supabase
          .from('minibar_items')
          .update(itemData)
          .eq('id', editingItem.id);

        if (error) throw error;

        toast({
          title: 'Success',
          description: 'Minibar item updated successfully',
        });
      } else {
        const { error } = await supabase
          .from('minibar_items')
          .insert(itemData);

        if (error) throw error;

        toast({
          title: 'Success',
          description: 'Minibar item created successfully',
        });
      }

      resetForm();
      fetchItems();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (item: MinibarItem) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      category: item.category,
      price: item.price.toString(),
      is_active: item.is_active
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) {
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('minibar_items')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Minibar item deleted successfully',
      });

      fetchItems();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      category: 'beverage',
      price: '',
      is_active: true
    });
    setEditingItem(null);
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'beverage': return <Coffee className="h-4 w-4" />;
      case 'snack': return <Package className="h-4 w-4" />;
      case 'alcohol': return <Wine className="h-4 w-4" />;
      default: return <Package className="h-4 w-4" />;
    }
  };

  const groupedItems = items.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, MinibarItem[]>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Minibar Management</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Add/Edit Form */}
          <div className="p-4 border rounded-lg bg-muted/20">
            <h3 className="text-lg font-semibold mb-4">
              {editingItem ? 'Edit Item' : 'Add New Item'}
            </h3>
            
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="lg:col-span-2">
                <Label htmlFor="name">Item Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="e.g., Coca Cola"
                  required
                />
              </div>

              <div>
                <Label htmlFor="category">Category</Label>
                <Select value={formData.category} onValueChange={(value) => setFormData({...formData, category: value})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beverage">Beverage</SelectItem>
                    <SelectItem value="snack">Snack</SelectItem>
                    <SelectItem value="alcohol">Alcohol</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="price">Price ($)</Label>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.price}
                  onChange={(e) => setFormData({...formData, price: e.target.value})}
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="flex flex-col justify-end gap-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
                    className="rounded"
                  />
                  <Label htmlFor="is_active" className="text-sm">Active</Label>
                </div>
                
                <div className="flex gap-2">
                  {editingItem && (
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                  )}
                  <Button type="submit" disabled={loading} className="flex-1">
                    <Plus className="h-4 w-4 mr-2" />
                    {editingItem ? 'Update' : 'Add'}
                  </Button>
                </div>
              </div>
            </form>
          </div>

          {/* Items List */}
          <div className="space-y-4">
            {Object.entries(groupedItems).map(([category, categoryItems]) => (
              <div key={category} className="space-y-2">
                <div className="flex items-center gap-2">
                  {getCategoryIcon(category)}
                  <h3 className="text-lg font-semibold capitalize">{category}s</h3>
                  <Badge variant="secondary">{categoryItems.length} items</Badge>
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[100px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categoryItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell>${item.price.toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant={item.is_active ? 'default' : 'secondary'}>
                              {item.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEdit(item)}
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDelete(item.id)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}

            {items.length === 0 && !loading && (
              <div className="text-center py-8 text-muted-foreground">
                No minibar items found. Add your first item above.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}