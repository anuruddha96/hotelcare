import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Plus, Building2, Settings, Trash2 } from 'lucide-react';

interface Organization {
  id: string;
  name: string;
  slug: string;
  subscription_tier: string;
  is_active: boolean;
  created_at: string;
}

export const OrganizationManagement = () => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');

  useEffect(() => {
    fetchOrganizations();
  }, []);

  const fetchOrganizations = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOrganizations(data || []);
    } catch (error: any) {
      toast.error('Failed to fetch organizations');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateOrganization = async () => {
    if (!newOrgName || !newOrgSlug) {
      toast.error('Please fill in all fields');
      return;
    }

    try {
      const { error } = await supabase
        .from('organizations')
        .insert({
          name: newOrgName,
          slug: newOrgSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          subscription_tier: 'basic',
          is_active: true,
          settings: {}
        });

      if (error) throw error;

      toast.success('Organization created successfully');
      setCreateDialogOpen(false);
      setNewOrgName('');
      setNewOrgSlug('');
      fetchOrganizations();
    } catch (error: any) {
      toast.error(error.message || 'Failed to create organization');
      console.error(error);
    }
  };

  const toggleOrganizationStatus = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ is_active: !currentStatus })
        .eq('id', id);

      if (error) throw error;

      toast.success(`Organization ${!currentStatus ? 'activated' : 'deactivated'}`);
      fetchOrganizations();
    } catch (error: any) {
      toast.error('Failed to update organization status');
      console.error(error);
    }
  };

  if (loading) {
    return <div className="p-8">Loading organizations...</div>;
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Organization Management</h1>
          <p className="text-muted-foreground">Manage all organizations in the platform</p>
        </div>

        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Create Organization
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Organization</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <Label>Organization Name</Label>
                <Input
                  placeholder="e.g., Radisson Hotels"
                  value={newOrgName}
                  onChange={(e) => {
                    setNewOrgName(e.target.value);
                    if (!newOrgSlug) {
                      setNewOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                    }
                  }}
                />
              </div>
              <div>
                <Label>URL Slug</Label>
                <Input
                  placeholder="e.g., radisson"
                  value={newOrgSlug}
                  onChange={(e) => setNewOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Will be accessible at: my.hotelcare.app/{newOrgSlug}
                </p>
              </div>
              <Button onClick={handleCreateOrganization} className="w-full">
                Create Organization
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {organizations.map((org) => (
          <Card key={org.id} className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Building2 className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">{org.name}</h3>
                  <p className="text-sm text-muted-foreground">/{org.slug}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Status</span>
                <Switch
                  checked={org.is_active}
                  onCheckedChange={() => toggleOrganizationStatus(org.id, org.is_active)}
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm">Tier</span>
                <span className="text-sm font-medium capitalize">{org.subscription_tier}</span>
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" size="sm" className="flex-1">
                  <Settings className="w-4 h-4 mr-1" />
                  Configure
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {organizations.length === 0 && (
        <div className="text-center py-12">
          <Building2 className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No organizations yet. Create your first one!</p>
        </div>
      )}
    </div>
  );
};