import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface TabConfig {
  id: string;
  label: string;
  order: number;
}

const DEFAULT_TAB_ORDER: TabConfig[] = [
  { id: 'staff-management', label: 'Staff Management', order: 0 },
  { id: 'supervisor', label: 'Pending Approvals', order: 1 },
  { id: 'manage', label: 'Team View', order: 2 },
  { id: 'performance', label: 'Performance', order: 3 },
  { id: 'pms-upload', label: 'PMS Upload', order: 4 },
  { id: 'completion-photos', label: 'Room Photos', order: 5 },
  { id: 'dnd-photos', label: 'DND Photos', order: 6 },
  { id: 'maintenance-photos', label: 'Maintenance', order: 7 },
  { id: 'lost-and-found', label: 'Lost & Found', order: 8 },
  { id: 'dirty-linen', label: 'Dirty Linen', order: 9 },
  { id: 'general-tasks', label: 'General Tasks', order: 10 },
  { id: 'attendance', label: 'HR Management', order: 11 },
  { id: 'minibar', label: 'Minibar Tracking', order: 12 },
];

export function TabOrderManagement() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [tabs, setTabs] = useState<TabConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTabOrder();
  }, [profile?.organization_slug]);

  const loadTabOrder = async () => {
    if (!profile?.organization_slug) {
      setTabs(DEFAULT_TAB_ORDER);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('organization_settings')
        .select('setting_value')
        .eq('organization_slug', profile.organization_slug)
        .eq('setting_key', 'housekeeping_tab_order')
        .maybeSingle();

      if (error) throw error;

      if (data?.setting_value) {
        setTabs(data.setting_value as unknown as TabConfig[]);
      } else {
        setTabs(DEFAULT_TAB_ORDER);
      }
    } catch (error) {
      console.error('Error loading tab order:', error);
      setTabs(DEFAULT_TAB_ORDER);
    } finally {
      setLoading(false);
    }
  };

  const moveTab = (index: number, direction: 'up' | 'down') => {
    const newTabs = [...tabs];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (newIndex < 0 || newIndex >= newTabs.length) return;
    
    // Swap the tabs
    [newTabs[index], newTabs[newIndex]] = [newTabs[newIndex], newTabs[index]];
    
    // Update order numbers
    newTabs.forEach((tab, i) => {
      tab.order = i;
    });
    
    setTabs(newTabs);
  };

  const saveOrder = async () => {
    if (!profile?.organization_slug || !profile?.id) {
      toast.error('Unable to save: Missing organization information');
      return;
    }

    try {
      const { error } = await supabase
        .from('organization_settings')
        .upsert([{
          organization_slug: profile.organization_slug,
          setting_key: 'housekeeping_tab_order',
          setting_value: tabs as any,
          updated_by: profile.id,
        }], {
          onConflict: 'organization_slug,setting_key'
        });

      if (error) throw error;

      toast.success('Tab order saved successfully for all users');
      // Reload the page to apply changes
      setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
      console.error('Error saving tab order:', error);
      toast.error('Failed to save tab order');
    }
  };

  const resetToDefault = async () => {
    if (!profile?.organization_slug) {
      toast.error('Unable to reset: Missing organization information');
      return;
    }

    try {
      const { error } = await supabase
        .from('organization_settings')
        .delete()
        .eq('organization_slug', profile.organization_slug)
        .eq('setting_key', 'housekeeping_tab_order');

      if (error) throw error;

      setTabs(DEFAULT_TAB_ORDER);
      toast.success('Reset to default order');
      // Reload the page to apply changes
      setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
      console.error('Error resetting tab order:', error);
      toast.error('Failed to reset tab order');
    }
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Housekeeping Tab Order</h3>
            <p className="text-sm text-muted-foreground">
              Arrange the tabs in your preferred order (applies to all users)
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={resetToDefault}>
              Reset to Default
            </Button>
            <Button onClick={saveOrder}>
              Save Order
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              className="flex items-center gap-2 p-3 border rounded-lg bg-card hover:bg-accent/50 transition"
            >
              <GripVertical className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1 font-medium">{tab.label}</div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => moveTab(index, 'up')}
                  disabled={index === 0}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => moveTab(index, 'down')}
                  disabled={index === tabs.length - 1}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
