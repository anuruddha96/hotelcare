import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Shield, Plus, Trash2, LockKeyhole } from 'lucide-react';

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
  const { profile } = useAuth();
  const [configs, setConfigs] = useState<AccessConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');
  const [selectedScope, setSelectedScope] = useState<string>('');
  const [canManageAll, setCanManageAll] = useState(false);

  const canMutatePolicies = profile?.is_super_admin === true;
  const canEnableManageAll = selectedDepartment === 'all' && selectedScope === 'all_hotels';

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase.rpc as any)('admin_list_access_rules');

      if (error) throw error;
      setConfigs((data || []) as AccessConfig[]);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to fetch access configurations',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void fetchConfigs();
    }
  }, [open]);

  useEffect(() => {
    if (!canEnableManageAll && canManageAll) {
      setCanManageAll(false);
    }
  }, [canEnableManageAll, canManageAll]);

  const handleAddConfig = async () => {
    if (!canMutatePolicies) {
      toast({
        title: 'Super admin required',
        description: 'Global access policies can only be changed by a super admin.',
        variant: 'destructive',
      });
      return;
    }

    if (!selectedRole || !selectedDepartment || !selectedScope) {
      toast({
        title: 'Error',
        description: 'Please fill all fields',
        variant: 'destructive',
      });
      return;
    }

    setPendingAction('create');
    try {
      const { error } = await (supabase.rpc as any)('admin_create_access_rule', {
        p_role: selectedRole,
        p_department: selectedDepartment,
        p_access_scope: selectedScope,
        p_can_manage_all: canManageAll,
        p_request_id: crypto.randomUUID(),
      });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Access configuration added securely',
      });

      setSelectedRole('');
      setSelectedDepartment('');
      setSelectedScope('');
      setCanManageAll(false);

      await fetchConfigs();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to add access configuration',
        variant: 'destructive',
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleDeleteConfig = async (config: AccessConfig) => {
    if (!canMutatePolicies) {
      toast({
        title: 'Super admin required',
        description: 'Global access policies can only be changed by a super admin.',
        variant: 'destructive',
      });
      return;
    }

    const confirmed = window.confirm(
      `Delete the ${config.role.replace('_', ' ')} → ${config.department.replace('_', ' ')} access rule?`
    );
    if (!confirmed) return;

    setPendingAction(config.id);
    try {
      const { error } = await (supabase.rpc as any)('admin_delete_access_rule', {
        p_rule_id: config.id,
        p_request_id: crypto.randomUUID(),
      });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Access configuration deleted securely',
      });

      await fetchConfigs();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete access configuration',
        variant: 'destructive',
      });
    } finally {
      setPendingAction(null);
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
            Global role access policies. Changes are server-authorized and audit logged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {canMutatePolicies ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Add New Access Rule</CardTitle>
                <CardDescription>
                  These rules are global across HotelCare organizations. Only super admins can change them.
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
                    <Button
                      onClick={handleAddConfig}
                      className="w-full"
                      disabled={pendingAction !== null}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {pendingAction === 'create' ? 'Adding…' : 'Add Rule'}
                    </Button>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="can-manage-all"
                    checked={canManageAll}
                    disabled={!canEnableManageAll || pendingAction !== null}
                    onChange={(e) => setCanManageAll(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="can-manage-all" className="text-sm">
                    Grant global all-department/all-hotel management access
                  </label>
                </div>
                {!canEnableManageAll && (
                  <p className="text-xs text-muted-foreground">
                    Global management access is only valid with Department = ALL and Access Scope = All Hotels.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <LockKeyhole className="h-4 w-4" />
                  Read-only access
                </CardTitle>
                <CardDescription>
                  Access policies are global across HotelCare. Only a super admin can add or delete rules.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

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
                            className="flex items-center justify-between gap-3 p-3 bg-muted rounded-lg"
                          >
                            <div className="flex flex-wrap items-center gap-2">
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
                                  Global Management
                                </Badge>
                              )}
                            </div>
                            {canMutatePolicies && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={pendingAction !== null}
                                onClick={() => handleDeleteConfig(config)}
                                className="text-destructive hover:text-destructive"
                                aria-label={`Delete ${config.role} ${config.department} access rule`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
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
