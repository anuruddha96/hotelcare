import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Trash2, Coffee, Wine, Package, Star, Upload, X, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface MinibarItem {
  id: string;
  name: string;
  category: string;
  price: number;
  is_active: boolean;
  is_promoted: boolean;
  image_url: string | null;
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
  const [uploadingImage, setUploadingImage] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    category: 'beverage',
    price: '',
    is_active: true,
    is_promoted: false,
    image_url: null as string | null,
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
      setItems((data as any as MinibarItem[]) || []);
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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: 'Error', description: 'Please select an image file', variant: 'destructive' });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Error', description: 'Image must be under 5MB', variant: 'destructive' });
      return;
    }

    setUploadingImage(true);
    try {
      const ext = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('minibar-images')
        .upload(fileName, file, { cacheControl: '3600', upsert: false });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('minibar-images')
        .getPublicUrl(fileName);

      setFormData(prev => ({ ...prev, image_url: urlData.publicUrl }));
      toast({ title: 'Success', description: 'Image uploaded successfully' });
    } catch (error: any) {
      toast({ title: 'Error', description: 'Failed to upload image: ' + error.message, variant: 'destructive' });
    } finally {
      setUploadingImage(false);
    }
  };

  const removeImage = () => {
    setFormData(prev => ({ ...prev, image_url: null }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.price) {
      toast({ title: 'Error', description: 'Name and price are required', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const itemData = {
        name: formData.name,
        category: formData.category,
        price: parseFloat(formData.price),
        is_active: formData.is_active,
        is_promoted: formData.is_promoted,
        image_url: formData.image_url,
      };

      if (editingItem) {
        const { error } = await supabase
          .from('minibar_items')
          .update(itemData as any)
          .eq('id', editingItem.id);

        if (error) throw error;
        toast({ title: 'Success', description: 'Minibar item updated successfully' });
      } else {
        const { error } = await supabase
          .from('minibar_items')
          .insert(itemData as any);

        if (error) throw error;
        toast({ title: 'Success', description: 'Minibar item created successfully' });
      }

      resetForm();
      fetchItems();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
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
      is_active: item.is_active,
      is_promoted: item.is_promoted || false,
      image_url: item.image_url || null,
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;

    setLoading(true);
    try {
      const { error } = await supabase.from('minibar_items').delete().eq('id', id);
      if (error) throw error;
      toast({ title: 'Success', description: 'Minibar item deleted successfully' });
      fetchItems();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', category: 'beverage', price: '', is_active: true, is_promoted: false, image_url: null });
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
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, MinibarItem[]>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0 pb-4">
          <DialogTitle className="text-xl font-semibold">Minibar Management</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 pr-2">
          {/* Add/Edit Form */}
          <div className="p-4 border rounded-lg bg-muted/20">
            <h3 className="text-lg font-semibold mb-4">
              {editingItem ? 'Edit Item' : 'Add New Item'}
            </h3>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="sm:col-span-2 lg:col-span-2">
                  <Label htmlFor="name">Item Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    placeholder="e.g., Coca Cola"
                    required
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="category">Category</Label>
                  <Select value={formData.category} onValueChange={(value) => setFormData({...formData, category: value})}>
                    <SelectTrigger className="mt-1">
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
                  <Label htmlFor="price">Price (€)</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.price}
                    onChange={(e) => setFormData({...formData, price: e.target.value})}
                    placeholder="0.00"
                    required
                    className="mt-1"
                  />
                </div>
              </div>

              {/* Image Upload */}
              <div className="space-y-2">
                <Label>Product Image</Label>
                <div className="flex items-center gap-3">
                  {formData.image_url ? (
                    <div className="relative">
                      <img src={formData.image_url} alt="Product" className="w-16 h-16 rounded-lg object-cover border" />
                      <button
                        type="button"
                        onClick={removeImage}
                        className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 px-3 py-2 border border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                      {uploadingImage ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm text-muted-foreground">
                        {uploadingImage ? 'Uploading...' : 'Upload image'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                        disabled={uploadingImage}
                      />
                    </label>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pt-2">
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

                <div className="flex items-center space-x-2">
                  <Switch
                    id="is_promoted"
                    checked={formData.is_promoted}
                    onCheckedChange={(checked) => setFormData({...formData, is_promoted: checked})}
                  />
                  <Label htmlFor="is_promoted" className="text-sm flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 text-amber-500" />
                    Featured / Promoted
                  </Label>
                </div>
                
                <div className="flex gap-2 ml-auto">
                  {editingItem && (
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                  )}
                  <Button type="submit" disabled={loading}>
                    <Plus className="h-4 w-4 mr-2" />
                    {editingItem ? 'Update' : 'Add'}
                  </Button>
                </div>
              </div>
            </form>
          </div>

          {/* Items List */}
          <div className="space-y-6">
            {Object.entries(groupedItems).map(([category, categoryItems]) => (
              <div key={category} className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  {getCategoryIcon(category)}
                  <h3 className="text-lg font-semibold capitalize">{category}s</h3>
                  <Badge variant="secondary">{categoryItems.length} items</Badge>
                </div>

                {/* Mobile Card View */}
                <div className="block md:hidden space-y-2">
                  {categoryItems.map((item) => (
                    <div key={item.id} className="p-4 border rounded-lg bg-card">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          {item.image_url && (
                            <img src={item.image_url} alt={item.name} className="w-10 h-10 rounded object-cover border" />
                          )}
                          <div>
                            <div className="flex items-center gap-1">
                              {item.is_promoted && <Star className="h-3 w-3 text-amber-500 fill-amber-500" />}
                              <h4 className="font-medium text-foreground">{item.name}</h4>
                            </div>
                            <p className="text-sm text-muted-foreground">€{item.price.toFixed(2)}</p>
                          </div>
                        </div>
                        <Badge variant={item.is_active ? 'default' : 'secondary'}>
                          {item.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleEdit(item)} className="flex-1">
                          <Edit className="h-3 w-3 mr-1" /> Edit
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleDelete(item.id)} className="text-destructive hover:text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop Table View */}
                <div className="hidden md:block">
                  <div className="overflow-x-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="font-semibold">Image</TableHead>
                          <TableHead className="font-semibold">Name</TableHead>
                          <TableHead className="font-semibold">Price</TableHead>
                          <TableHead className="font-semibold">Status</TableHead>
                          <TableHead className="font-semibold text-center">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {categoryItems.map((item) => (
                          <TableRow key={item.id} className="hover:bg-muted/50">
                            <TableCell>
                              {item.image_url ? (
                                <img src={item.image_url} alt={item.name} className="w-10 h-10 rounded object-cover border" />
                              ) : (
                                <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                                  <Package className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-1">
                                {item.is_promoted && <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />}
                                {item.name}
                              </div>
                            </TableCell>
                            <TableCell className="font-medium text-primary">€{item.price.toFixed(2)}</TableCell>
                            <TableCell>
                              <Badge variant={item.is_active ? 'default' : 'secondary'}>
                                {item.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-2 justify-center">
                                <Button size="sm" variant="outline" onClick={() => handleEdit(item)} className="hover:bg-primary hover:text-primary-foreground">
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => handleDelete(item.id)} className="text-destructive hover:bg-destructive hover:text-destructive-foreground">
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
              </div>
            ))}

            {items.length === 0 && !loading && (
              <div className="text-center py-12">
                <div className="mx-auto w-24 h-24 bg-muted rounded-full flex items-center justify-center mb-4">
                  <Package className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">No minibar items</h3>
                <p className="text-muted-foreground">Add your first minibar item using the form above.</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
