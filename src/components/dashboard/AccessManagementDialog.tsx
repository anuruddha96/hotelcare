import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Shield, Plus, Trash2 } from 'lucide-react';

interface AccessConfig {
  id: string;
  role: string;
  department: string;
  access_scope: string;
  can_manage_all: boolean;
}

interface AccessManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const USER_ROLES = [
  'admin', 'top_management', 'manager', 'housekeeping', 'maintenance',
  'reception', 'front_office', 'marketing', 'control_finance', 'hr'
];

const DEPARTMENTS = [
  'all', 'housekeeping', 'maintenance', 'reception', 'front_office', 
  'marketing', 'finance', 'hr', 'control'
];

const ACCESS_SCOPES = [
  { value: 'all_hotels', label: 'All Hotels' },
  { value: 'hotel_only', label: 'Assigned Hotel Only' },
  { value: 'assigned_and_created', label: 'Assigned/Created + Hotel Department' }
];

export function AccessManagementDialog({ open, onOpenChange }: AccessManagementDialogProps) {
  const [configs, setConfigs] = useState<AccessConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');
  const [selectedScope, setSelectedScope] = useState<string>('');
  const [canManageAll, setCanManageAll] = useState(false);

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('department_access_config')
        .select('*')
        .order('role', { ascending: true });

      if (error) throw error;
      setConfigs(data || []);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch access configurations',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchConfigs();
    }
  }, [open]);

  const handleAddConfig = async () => {
    if (!selectedRole || !selectedDepartment || !selectedScope) {
      toast({
        title: 'Error',
        description: 'Please fill all fields',
        variant: 'destructive',
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('department_access_config')
        .insert({
          role: selectedRole as any,
          department: selectedDepartment,
          access_scope: selectedScope,
          can_manage_all: canManageAll
        });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Access configuration added successfully',
      });

      // Reset form
      setSelectedRole('');
      setSelectedDepartment('');
      setSelectedScope('');
      setCanManageAll(false);

      fetchConfigs();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to add access configuration',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteConfig = async (id: string) => {
    try {
      const { error } = await supabase
        .from('department_access_config')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Access configuration deleted successfully',
      });

      fetchConfigs();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to delete access configuration',
        variant: 'destructive',
      });
    }
  };

  const groupedConfigs = configs.reduce((acc, config) => {
    if (!acc[config.role]) {
      acc[config.role] = [];
    }
    acc[config.role].push(config);
    return acc;
  }, {} as Record<string, AccessConfig[]>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Access Management
          </DialogTitle>
          <DialogDescription>
            Configure department access permissions for different user roles
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Add New Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Add New Access Rule</CardTitle>
              <CardDescription>
                Define which departments and hotels a role can access
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Role</label>
                  <Select value={selectedRole} onValueChange={setSelectedRole}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {USER_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role.replace('_', ' ').toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Department</label>
                  <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {DEPARTMENTS.map((dept) => (
                        <SelectItem key={dept} value={dept}>
                          {dept.replace('_', ' ').toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Access Scope</label>
                  <Select value={selectedScope} onValueChange={setSelectedScope}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select scope" />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCESS_SCOPES.map((scope) => (
                        <SelectItem key={scope.value} value={scope.value}>
                          {scope.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-end">
                  <Button onClick={handleAddConfig} className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Rule
                  </Button>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="can-manage-all"
                  checked={canManageAll}
                  onChange={(e) => setCanManageAll(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="can-manage-all" className="text-sm">
                  Can manage all (super admin access)
                </label>
              </div>
            </CardContent>
          </Card>

          {/* Current Configurations */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Current Access Rules</h3>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(groupedConfigs).map(([role, roleConfigs]) => (
                  <Card key={role}>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">
                        {role.replace('_', ' ').toUpperCase()}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {roleConfigs.map((config) => (
                          <div
                            key={config.id}
                            className="flex items-center justify-between p-3 bg-muted rounded-lg"
                          >
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">
                                {config.department.replace('_', ' ').toUpperCase()}
                              </Badge>
                              <Badge 
                                variant={config.access_scope === 'all_hotels' ? 'default' : 'secondary'}
                              >
                                {ACCESS_SCOPES.find(s => s.value === config.access_scope)?.label}
                              </Badge>
                              {config.can_manage_all && (
                                <Badge variant="destructive">
                                  Super Admin
                                </Badge>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteConfig(config.id)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}