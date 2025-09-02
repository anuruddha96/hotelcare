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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { User, Edit, Trash2, UserPlus } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '@/hooks/use-toast';

interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: 'housekeeping' | 'reception' | 'maintenance' | 'manager' | 'admin' | 'marketing' | 'control_finance' | 'hr' | 'front_office' | 'top_management' | 'housekeeping_manager' | 'maintenance_manager' | 'marketing_manager' | 'reception_manager' | 'back_office_manager' | 'control_manager' | 'finance_manager' | 'top_management_manager';
  created_at: string;
  assigned_hotel?: string;
}

interface UserManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserManagementDialog({ open, onOpenChange }: UserManagementDialogProps) {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [newUserData, setNewUserData] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'housekeeping' as const,
    assigned_hotel: '',
  });
  const [hotels, setHotels] = useState<any[]>([]);

  useEffect(() => {
    if (open) {
      fetchUsers();
      fetchHotels();
    }
  }, [open]);

  const fetchHotels = async () => {
    try {
      const { data, error } = await supabase
        .from('hotels')
        .select('*')
        .order('name');

      if (error) throw error;
      setHotels(data || []);
    } catch (error: any) {
      console.error('Error fetching hotels:', error);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch users',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: newUserData.email,
        password: newUserData.password,
        user_metadata: {
          full_name: newUserData.full_name,
        },
        email_confirm: true,
      });

      if (authError) throw authError;

      // Update profile with role and hotel
      if (authData.user) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({ 
            role: newUserData.role,
            assigned_hotel: newUserData.assigned_hotel || null
          })
          .eq('id', authData.user.id);

        if (profileError) throw profileError;
      }

      toast({
        title: 'Success',
        description: 'User created successfully',
      });

      setNewUserData({
        email: '',
        password: '',
        full_name: '',
        role: 'housekeeping',
        assigned_hotel: '',
      });
      
      fetchUsers();
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

  const handleUpdateUserRole = async (userId: string, newRole: Profile['role']) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', userId);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'User role updated',
      });

      fetchUsers();
      setSelectedUser(null);
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

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-500 text-white';
      case 'manager': return 'bg-blue-500 text-white';
      case 'maintenance': return 'bg-green-500 text-white';
      case 'reception': return 'bg-purple-500 text-white';
      case 'housekeeping': return 'bg-orange-500 text-white';
      case 'marketing': return 'bg-pink-500 text-white';
      case 'housekeeping_manager': return 'bg-orange-600 text-white';
      case 'maintenance_manager': return 'bg-green-600 text-white';
      case 'marketing_manager': return 'bg-pink-600 text-white';
      case 'reception_manager': return 'bg-purple-600 text-white';
      case 'back_office_manager': return 'bg-cyan-600 text-white';
      case 'control_manager': return 'bg-emerald-600 text-white';
      case 'finance_manager': return 'bg-teal-600 text-white';
      case 'top_management_manager': return 'bg-violet-600 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'housekeeping': return 'Housekeeping';
      case 'reception': return 'Reception';
      case 'maintenance': return 'Maintenance';
      case 'manager': return 'Manager';
      case 'admin': return 'Admin';
      case 'marketing': return 'Marketing';
      case 'housekeeping_manager': return 'Housekeeping Manager';
      case 'maintenance_manager': return 'Maintenance Manager';
      case 'marketing_manager': return 'Marketing Manager';
      case 'reception_manager': return 'Reception Manager';
      case 'back_office_manager': return 'Back Office Manager';
      case 'control_manager': return 'Control Manager';
      case 'finance_manager': return 'Finance Manager';
      case 'top_management_manager': return 'Top Management Manager';
      default: return role.replace('_', ' ').toUpperCase();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            User Management
          </DialogTitle>
          <DialogDescription>
            Manage user accounts and roles for the maintenance management system.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="users" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="users">All Users</TabsTrigger>
            <TabsTrigger value="create">Create User</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : (
              <div className="grid gap-4">
                {users.map((user) => (
                  <Card key={user.id}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-4">
                        <Avatar>
                          <AvatarFallback>
                            {user.full_name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <h4 className="font-semibold">{user.full_name}</h4>
                          <p className="text-sm text-muted-foreground">{user.email}</p>
                          {user.assigned_hotel && (
                            <p className="text-xs text-blue-600">Hotel: {user.assigned_hotel}</p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Joined {format(new Date(user.created_at), 'MMM dd, yyyy')}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Badge className={getRoleColor(user.role)} variant="secondary">
                          {getRoleLabel(user.role)}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedUser(user)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="create">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5" />
                  Create New User
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreateUser} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="full_name">Full Name</Label>
                      <Input
                        id="full_name"
                        value={newUserData.full_name}
                        onChange={(e) => setNewUserData({ ...newUserData, full_name: e.target.value })}
                        placeholder="Enter full name"
                        required
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={newUserData.email}
                        onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
                        placeholder="Enter email address"
                        required
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        value={newUserData.password}
                        onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })}
                        placeholder="Enter password"
                        minLength={6}
                        required
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="role">Role</Label>
                      <Select 
                        value={newUserData.role} 
                        onValueChange={(value: any) => setNewUserData({ ...newUserData, role: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="housekeeping">Housekeeping</SelectItem>
                          <SelectItem value="reception">Reception</SelectItem>
                          <SelectItem value="maintenance">Maintenance</SelectItem>
                          <SelectItem value="marketing">Marketing</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="housekeeping_manager">Housekeeping Manager</SelectItem>
                          <SelectItem value="maintenance_manager">Maintenance Manager</SelectItem>
                          <SelectItem value="marketing_manager">Marketing Manager</SelectItem>
                          <SelectItem value="reception_manager">Reception Manager</SelectItem>
                          <SelectItem value="back_office_manager">Back Office Manager</SelectItem>
                          <SelectItem value="control_manager">Control Manager</SelectItem>
                          <SelectItem value="finance_manager">Finance Manager</SelectItem>
                          <SelectItem value="top_management_manager">Top Management Manager</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="hotel">Assigned Hotel</Label>
                      <Select 
                        value={newUserData.assigned_hotel} 
                        onValueChange={(value: string) => setNewUserData({ ...newUserData, assigned_hotel: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select hotel (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">No specific hotel</SelectItem>
                          {hotels.map((hotel) => (
                            <SelectItem key={hotel.id} value={hotel.name}>
                              {hotel.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div className="flex justify-end">
                    <Button type="submit" disabled={loading}>
                      {loading ? 'Creating...' : 'Create User'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Edit User Dialog */}
        {selectedUser && (
          <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit User Role</DialogTitle>
                <DialogDescription>
                  Update the role for {selectedUser.full_name}
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Current Role</Label>
                  <Badge className={getRoleColor(selectedUser.role)} variant="secondary">
                    {getRoleLabel(selectedUser.role)}
                  </Badge>
                </div>
                
                <div className="space-y-2">
                  <Label>New Role</Label>
                  <Select 
                    value={selectedUser.role}
                    onValueChange={(value: Profile['role']) => handleUpdateUserRole(selectedUser.id, value)}
                    disabled={loading}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="housekeeping">Housekeeping</SelectItem>
                      <SelectItem value="reception">Reception</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                      <SelectItem value="marketing">Marketing</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="housekeeping_manager">Housekeeping Manager</SelectItem>
                      <SelectItem value="maintenance_manager">Maintenance Manager</SelectItem>
                      <SelectItem value="marketing_manager">Marketing Manager</SelectItem>
                      <SelectItem value="reception_manager">Reception Manager</SelectItem>
                      <SelectItem value="back_office_manager">Back Office Manager</SelectItem>
                      <SelectItem value="control_manager">Control Manager</SelectItem>
                      <SelectItem value="finance_manager">Finance Manager</SelectItem>
                      <SelectItem value="top_management_manager">Top Management Manager</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}