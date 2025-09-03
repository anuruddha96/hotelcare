import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { Ticket, UserPlus, Users, Trash2 } from 'lucide-react';

interface TicketPermission {
  id: string;
  role?: string;
  user_id?: string;
  can_create: boolean;
  full_name?: string; // For user permissions
}

interface TicketPermissionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const USER_ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'housekeeping', label: 'Housekeeping' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'reception', label: 'Reception' },
  { value: 'front_office', label: 'Front Office' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'control_finance', label: 'Control Finance' },
  { value: 'hr', label: 'HR' },
  { value: 'top_management', label: 'Top Management' },
];

export function TicketPermissionDialog({ open, onOpenChange }: TicketPermissionDialogProps) {
  const [permissions, setPermissions] = useState<TicketPermission[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [roleEnabled, setRoleEnabled] = useState(true);
  const [userEnabled, setUserEnabled] = useState(true);

  const fetchPermissions = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ticket_creation_config')
        .select('*')
        .order('role', { ascending: true });

      if (error) throw error;
      setPermissions(data || []);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch ticket permissions',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .order('full_name');

      if (error) throw error;
      setUsers(data || []);
    } catch (error: any) {
      console.error('Error fetching users:', error);
    }
  };

  useEffect(() => {
    if (open) {
      fetchPermissions();
      fetchUsers();
    }
  }, [open]);

  const handleAddRolePermission = async () => {
    if (!selectedRole) {
      toast({
        title: 'Error',
        description: 'Please select a role',
        variant: 'destructive',
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('ticket_creation_config')
        .insert({
          role: selectedRole as any,
          can_create: roleEnabled
        });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Role permission added successfully',
      });

      setSelectedRole('');
      setRoleEnabled(true);
      fetchPermissions();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to add role permission',
        variant: 'destructive',
      });
    }
  };

  const handleAddUserPermission = async () => {
    if (!selectedUser) {
      toast({
        title: 'Error',
        description: 'Please select a user',
        variant: 'destructive',
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('ticket_creation_config')
        .insert({
          user_id: selectedUser,
          can_create: userEnabled
        });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'User permission added successfully',
      });

      setSelectedUser('');
      setUserEnabled(true);
      fetchPermissions();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to add user permission',
        variant: 'destructive',
      });
    }
  };

  const handleDeletePermission = async (id: string) => {
    try {
      const { error } = await supabase
        .from('ticket_creation_config')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Permission deleted successfully',
      });

      fetchPermissions();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to delete permission',
        variant: 'destructive',
      });
    }
  };

  const handleTogglePermission = async (id: string, currentValue: boolean) => {
    try {
      const { error } = await supabase
        .from('ticket_creation_config')
        .update({ can_create: !currentValue })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Permission updated successfully',
      });

      fetchPermissions();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to update permission',
        variant: 'destructive',
      });
    }
  };

  const getRoleLabel = (role: string) => {
    return USER_ROLES.find(r => r.value === role)?.label || role;
  };

  const getUserName = (userId: string) => {
    const user = users.find(u => u.id === userId);
    return user ? `${user.full_name} (${user.email})` : 'Unknown User';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-4xl h-[95vh] max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0 pb-4">
          <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
            <Ticket className="h-5 w-5" />
            <span className="hidden sm:inline">Ticket Creation Permissions</span>
            <span className="sm:hidden">Ticket Permissions</span>
          </DialogTitle>
          <DialogDescription className="text-sm">
            Configure which roles and users can create tickets. User-specific permissions override role permissions.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto space-y-4 sm:space-y-6 pr-2">
          {/* Add Role Permission */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                <Users className="h-4 w-4 sm:h-5 sm:w-5" />
                Role Permissions
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Set ticket creation permissions for entire user roles
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Label className="text-sm">Role</Label>
                  <Select value={selectedRole} onValueChange={setSelectedRole}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {USER_ROLES.map((role) => (
                        <SelectItem key={role.value} value={role.value}>
                          {role.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between sm:justify-start space-x-2">
                  <Label htmlFor="role-enabled" className="text-sm">Can Create Tickets</Label>
                  <Switch
                    id="role-enabled"
                    checked={roleEnabled}
                    onCheckedChange={setRoleEnabled}
                  />
                </div>
                <Button 
                  onClick={handleAddRolePermission} 
                  disabled={!selectedRole}
                  className="w-full sm:w-auto"
                >
                  <span className="sm:hidden">Add Role Permission</span>
                  <span className="hidden sm:inline">Add Role Rule</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Add User Permission */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                <UserPlus className="h-4 w-4 sm:h-5 sm:w-5" />
                User Permissions
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Override role permissions for specific users
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Label className="text-sm">User</Label>
                  <Select value={selectedUser} onValueChange={setSelectedUser}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select user" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          <span className="block truncate">{user.full_name} ({user.email})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between sm:justify-start space-x-2">
                  <Label htmlFor="user-enabled" className="text-sm">Can Create Tickets</Label>
                  <Switch
                    id="user-enabled"
                    checked={userEnabled}
                    onCheckedChange={setUserEnabled}
                  />
                </div>
                <Button 
                  onClick={handleAddUserPermission} 
                  disabled={!selectedUser}
                  className="w-full sm:w-auto"
                >
                  <span className="sm:hidden">Add User Permission</span>
                  <span className="hidden sm:inline">Add User Rule</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Current Permissions */}
          <div className="space-y-4">
            <h3 className="text-base sm:text-lg font-semibold">Current Permissions</h3>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              </div>
            ) : (
              <div className="space-y-3">
                {permissions.map((permission) => (
                  <div
                    key={permission.id}
                    className="p-3 sm:p-4 bg-muted rounded-lg"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                        {permission.role ? (
                          <Badge variant="outline" className="text-xs w-fit">
                            Role: {getRoleLabel(permission.role)}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs w-fit">
                            <span className="truncate max-w-[200px]">User: {getUserName(permission.user_id!)}</span>
                          </Badge>
                        )}
                        <Badge variant={permission.can_create ? 'default' : 'destructive'} className="text-xs w-fit">
                          {permission.can_create ? 'Can Create' : 'Cannot Create'}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-2">
                        <Switch
                          checked={permission.can_create}
                          onCheckedChange={() => handleTogglePermission(permission.id, permission.can_create)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeletePermission(permission.id)}
                          className="text-destructive hover:text-destructive h-8 w-8 p-0"
                        >
                          <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {permissions.length === 0 && (
                  <p className="text-center text-muted-foreground py-8 text-sm">
                    No custom permissions configured. All users can create tickets by default.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}