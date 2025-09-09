import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Plus, Edit, Trash, Coffee, Utensils, Timer, Clock, Moon } from 'lucide-react';

interface BreakType {
  id: string;
  name: string;
  display_name: string;
  duration_minutes: number;
  icon_name: string;
  is_active: boolean;
}

const iconOptions = [
  { name: 'Coffee', icon: Coffee, label: 'Coffee' },
  { name: 'Utensils', icon: Utensils, label: 'Food/Utensils' },
  { name: 'Timer', icon: Timer, label: 'Timer' },
  { name: 'Clock', icon: Clock, label: 'Clock' },
  { name: 'Moon', icon: Moon, label: 'Rest/Moon' },
];

export const BreakTypesManagement = () => {
  const { toast } = useToast();
  const [breakTypes, setBreakTypes] = useState<BreakType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    display_name: '',
    duration_minutes: 30,
    icon_name: 'Coffee',
    is_active: true
  });

  useEffect(() => {
    fetchBreakTypes();
  }, []);

  const fetchBreakTypes = async () => {
    const { data, error } = await supabase
      .from('break_types')
      .select('*')
      .order('duration_minutes', { ascending: true });

    if (error) {
      toast({
        title: "Error",
        description: "Failed to fetch break types",
        variant: "destructive"
      });
    } else {
      setBreakTypes(data || []);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (editingId) {
        const { error } = await supabase
          .from('break_types')
          .update(formData)
          .eq('id', editingId);

        if (error) throw error;

        toast({
          title: "Success",
          description: "Break type updated successfully"
        });
      } else {
        const { error } = await supabase
          .from('break_types')
          .insert(formData);

        if (error) throw error;

        toast({
          title: "Success", 
          description: "Break type created successfully"
        });
      }

      resetForm();
      fetchBreakTypes();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      display_name: '',
      duration_minutes: 30,
      icon_name: 'Coffee',
      is_active: true
    });
    setEditingId(null);
  };

  const handleEdit = (breakType: BreakType) => {
    setFormData({
      name: breakType.name,
      display_name: breakType.display_name,
      duration_minutes: breakType.duration_minutes,
      icon_name: breakType.icon_name,
      is_active: breakType.is_active
    });
    setEditingId(breakType.id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this break type?')) return;

    const { error } = await supabase
      .from('break_types')
      .delete()
      .eq('id', id);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to delete break type",
        variant: "destructive"
      });
    } else {
      toast({
        title: "Success",
        description: "Break type deleted successfully"
      });
      fetchBreakTypes();
    }
  };

  const getIcon = (iconName: string) => {
    const iconOption = iconOptions.find(option => option.name === iconName);
    return iconOption ? iconOption.icon : Coffee;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            {editingId ? 'Edit Break Type' : 'Add New Break Type'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Internal Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., lunch, coffee"
                  required
                />
              </div>
              <div>
                <Label htmlFor="display_name">Display Name</Label>
                <Input
                  id="display_name"
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                  placeholder="e.g., Lunch Break"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="duration">Duration (minutes)</Label>
                <Input
                  id="duration"
                  type="number"
                  min="1"
                  max="180"
                  value={formData.duration_minutes}
                  onChange={(e) => setFormData({ ...formData, duration_minutes: parseInt(e.target.value) || 30 })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="icon">Icon</Label>
                <Select value={formData.icon_name} onValueChange={(value) => setFormData({ ...formData, icon_name: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {iconOptions.map((option) => {
                      const IconComponent = option.icon;
                      return (
                        <SelectItem key={option.name} value={option.name}>
                          <div className="flex items-center gap-2">
                            <IconComponent className="h-4 w-4" />
                            {option.label}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
              <Label htmlFor="is_active">Active</Label>
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={isLoading}>
                {editingId ? <Edit className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                {editingId ? 'Update' : 'Create'}
              </Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing Break Types</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {breakTypes.map((breakType) => {
              const IconComponent = getIcon(breakType.icon_name);
              return (
                <div
                  key={breakType.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <IconComponent className="h-5 w-5" />
                    <div>
                      <p className="font-medium">{breakType.display_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {breakType.duration_minutes} minutes
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!breakType.is_active && (
                      <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                        Inactive
                      </span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(breakType)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(breakType.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
            {breakTypes.length === 0 && (
              <p className="text-center text-muted-foreground py-4">
                No break types configured yet.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};