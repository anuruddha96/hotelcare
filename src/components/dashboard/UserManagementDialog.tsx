import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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
  nickname?: string;
  phone_number?: string;
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
    phone_number: '',
    password: '',
    full_name: '',
    role: 'housekeeping' as const,
    assigned_hotel: '',
  });
  const [editUserData, setEditUserData] = useState({
    id: '',
    full_name: '',
    nickname: '',
    email: '',
    password: '',
    phone_number: '',
    role: 'housekeeping' as Profile['role'],
    assigned_hotel: '',
  });
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [hotels, setHotels] = useState<any[]>([]);
  const [generatedCredentials, setGeneratedCredentials] = useState<{username: string; password: string; email: string} | null>(null);
  useEffect(() => {
    if (open) {
      fetchUsers();
      fetchHotels();
      fetchCurrentUserRole();
    }
  }, [open]);

  const fetchCurrentUserRole = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      if (error) throw error;
      setCurrentUserRole(data?.role || '');
    } catch (error: any) {
      console.error('Error fetching current user role:', error);
    }
  };

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
      // Only allow admins and HR to fetch all users for management
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Access denied - insufficient permissions to view user profiles');
        throw error;
      }
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
      const { data, error } = await supabase.functions.invoke('create-housekeeper', {
        body: {
          full_name: newUserData.full_name,
          role: newUserData.role,
          email: newUserData.email || null,
          phone_number: newUserData.phone_number || null,
          assigned_hotel: newUserData.assigned_hotel || null,
          password: newUserData.password || null,
        },
      });

      if (error) throw error;

      const result = data as { success: boolean; error?: string; message?: string; username?: string; password?: string; email?: string };
      if (!result.success) {
        throw new Error(result.error || 'Failed to create user');
      }

      if (result.username && result.password) {
        setGeneratedCredentials({ username: result.username, password: result.password, email: result.email || '' });
      }

      toast({ title: 'Success', description: result.message || 'User created successfully' });

      setNewUserData({
        email: '',
        phone_number: '',
        password: '',
        full_name: '',
        role: 'housekeeping',
        assigned_hotel: '',
      });

      fetchUsers();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
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

  const handleUpdateUserHotel = async (userId: string, newHotel: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ assigned_hotel: newHotel === 'none' ? null : newHotel || null })
        .eq('id', userId);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'User hotel assignment updated',
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

  const handleDeleteUser = async (userId: string, userName: string) => {
    try {
      // Prefer edge function (uses service role, bypasses RLS safely)
      const { data, error } = await supabase.functions.invoke('admin-delete-user', {
        body: { target_user_id: userId },
      });

      if (error) throw error;
      const result = data as { success?: boolean; error?: string; message?: string };
      if (result?.success === false || result?.error) {
        throw new Error(result.error || 'Failed to delete user');
      }

      toast({ title: 'Success', description: result?.message || `User ${userName} deleted successfully` });
      fetchUsers();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleEditUser = (user: Profile) => {
    setEditUserData({
      id: user.id,
      full_name: user.full_name,
      nickname: user.nickname || '',
      email: user.email,
      password: '',
      phone_number: user.phone_number || '',
      role: user.role,
      assigned_hotel: user.assigned_hotel || '',
    });
    setEditDialogOpen(true);
  };

  const handleUpdateUser = async () => {
    if (!editUserData.id) return;
    
    setLoading(true);
    try {
      // First, use Edge Function for auth user email/password updates
      if (editUserData.email || editUserData.password) {
        const { data: fnData, error: fnError } = await supabase.functions.invoke('admin-update-user', {
          body: {
            target_user_id: editUserData.id,
            new_email: editUserData.email || undefined,
            new_password: editUserData.password || undefined,
            full_name: editUserData.full_name || undefined,
            nickname: editUserData.nickname || undefined,
          },
        });
        
        if (fnError) throw fnError;
        if ((fnData as any)?.error) throw new Error((fnData as any).error);
      }

      // Then update all profile fields (including role, phone, hotel) via direct update
      const profileUpdates: any = {
        updated_at: new Date().toISOString(),
      };

      if (editUserData.full_name) profileUpdates.full_name = editUserData.full_name;
      if (editUserData.nickname) profileUpdates.nickname = editUserData.nickname;
      if (editUserData.email) profileUpdates.email = editUserData.email;
      if (editUserData.phone_number) profileUpdates.phone_number = editUserData.phone_number;
      if (editUserData.role) profileUpdates.role = editUserData.role;
      if (editUserData.assigned_hotel && editUserData.assigned_hotel !== 'none') {
        profileUpdates.assigned_hotel = editUserData.assigned_hotel;
      } else if (editUserData.assigned_hotel === 'none') {
        profileUpdates.assigned_hotel = null;
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .update(profileUpdates)
        .eq('id', editUserData.id);

      if (profileError) throw profileError;

      toast({
        title: 'Success',
        description: 'User updated successfully',
      });

      fetchUsers();
      setEditDialogOpen(false);
      setEditUserData({
        id: '',
        full_name: '',
        nickname: '',
        email: '',
        password: '',
        phone_number: '',
        role: 'housekeeping',
        assigned_hotel: '',
      });
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
      <DialogContent className="w-[95vw] max-w-4xl h-[95vh] max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0 pb-4">
          <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
            <User className="h-5 w-5" />
            User Management
          </DialogTitle>
          <DialogDescription className="text-sm">
            Manage user accounts and roles for the maintenance management system.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="users" className="w-full flex flex-col flex-1 min-h-0">
            <TabsList className={`grid w-full ${['admin', 'manager', 'housekeeping_manager'].includes(currentUserRole) ? 'grid-cols-2' : 'grid-cols-1'} flex-shrink-0`}>
            <TabsTrigger value="users" className="text-xs sm:text-sm">All Users</TabsTrigger>
            {['admin', 'manager', 'housekeeping_manager'].includes(currentUserRole) && (
              <TabsTrigger value="create" className="text-xs sm:text-sm">Create User</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="users" className="flex-1 min-h-0 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : (
              <div className="space-y-3 pr-2">
                {users.map((user) => (
                  <Card key={user.id}>
                    <CardContent className="p-3 sm:p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-start gap-3">
                          <Avatar className="w-10 h-10 flex-shrink-0">
                            <AvatarFallback className="text-sm">
                              {user.full_name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-sm sm:text-base truncate">{user.full_name}</h4>
                            <p className="text-xs sm:text-sm text-muted-foreground truncate">{user.email || 'No email'}</p>
                            {user.phone_number && (
                              <p className="text-xs sm:text-sm text-muted-foreground">📞 {user.phone_number}</p>
                            )}
                            <p className="text-xs text-blue-600">
                              Hotel: {user.assigned_hotel || 'All Hotels'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Joined {format(new Date(user.created_at), 'MMM dd, yyyy')}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2">
                          <Badge className={`${getRoleColor(user.role)} text-xs`} variant="secondary">
                            {getRoleLabel(user.role)}
                          </Badge>
                          <div className="flex items-center gap-1">
                            {['admin', 'manager', 'housekeeping_manager'].includes(currentUserRole) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEditUser(user)}
                                className="h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3"
                              >
                                <Edit className="h-3 w-3 sm:h-4 sm:w-4" />
                                <span className="hidden sm:inline sm:ml-1">Edit</span>
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedUser(user)}
                                className="h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3"
                              >
                                <Edit className="h-3 w-3 sm:h-4 sm:w-4" />
                                <span className="hidden sm:inline sm:ml-1">Role</span>
                              </Button>
                            )}
                            
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={loading}
                                  className="h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3"
                                >
                                  <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
                                  <span className="hidden sm:inline sm:ml-1">Delete</span>
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="w-[95vw] max-w-md">
                                <AlertDialogHeader>
                                  <AlertDialogTitle className="text-base">Delete User</AlertDialogTitle>
                                  <AlertDialogDescription className="text-sm">
                                    Are you absolutely sure you want to delete <strong>{user.full_name}</strong>? 
                                    This action cannot be undone and will permanently remove the user account and all associated data.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
                                  <AlertDialogCancel disabled={loading} className="w-full sm:w-auto">Cancel</AlertDialogCancel>
                                  <AlertDialogAction 
                                    onClick={() => handleDeleteUser(user.id, user.full_name)}
                                    disabled={loading}
                                    className="w-full sm:w-auto bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    {loading ? 'Deleting...' : 'Delete Permanently'}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {currentUserRole === 'admin' && (
            <TabsContent value="create" className="flex-1 min-h-0 overflow-auto">
            <Card>
              <CardHeader className="flex-shrink-0">
                <CardTitle className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5" />
                  Create New User
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-auto">
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
                       <Label htmlFor="email">
                         Email {newUserData.role === 'housekeeping' ? '(Optional)' : '(Required)'}
                       </Label>
                       <Input
                         id="email"
                         type="email"
                         value={newUserData.email}
                         onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
                         placeholder="Enter email address"
                         required={newUserData.role !== 'housekeeping'}
                       />
                       {newUserData.role === 'housekeeping' && !newUserData.email && (
                         <p className="text-xs text-muted-foreground">
                           Email can be added later to enable notifications
                         </p>
                       )}
                     </div>

                     <div className="space-y-2">
                       <Label htmlFor="phone_number">Phone Number (Optional)</Label>
                       <Input
                         id="phone_number"
                         type="tel"
                         value={newUserData.phone_number}
                         onChange={(e) => setNewUserData({ ...newUserData, phone_number: e.target.value })}
                         placeholder="Enter phone number"
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
                             {/* Only admins can create users */}
                             {currentUserRole === 'admin' && (
                               <>
                                 <SelectItem value="housekeeping">Housekeeping</SelectItem>
                                 <SelectItem value="reception">Reception</SelectItem>
                                 <SelectItem value="maintenance">Maintenance</SelectItem>
                                 <SelectItem value="marketing">Marketing</SelectItem>
                                 <SelectItem value="control_finance">Control & Finance</SelectItem>
                                 <SelectItem value="hr">HR</SelectItem>
                                 <SelectItem value="front_office">Front Office</SelectItem>
                                 <SelectItem value="manager">Manager</SelectItem>
                                 <SelectItem value="housekeeping_manager">Housekeeping Manager</SelectItem>
                                 <SelectItem value="maintenance_manager">Maintenance Manager</SelectItem>
                                 <SelectItem value="marketing_manager">Marketing Manager</SelectItem>
                                 <SelectItem value="reception_manager">Reception Manager</SelectItem>
                                 <SelectItem value="back_office_manager">Back Office Manager</SelectItem>
                                 <SelectItem value="control_manager">Control Manager</SelectItem>
                                 <SelectItem value="finance_manager">Finance Manager</SelectItem>
                                 <SelectItem value="top_management_manager">Top Management Manager</SelectItem>
                                 <SelectItem value="admin">Admin</SelectItem>
                                 <SelectItem value="top_management">Top Management</SelectItem>
                               </>
                             )}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {currentUserRole === 'admin' && 'You can create any user role'}
                        </p>
                     </div>

                    <div className="space-y-2">
                      <Label>Can Create Tickets</Label>
                      <div className="text-sm text-muted-foreground">
                        This setting will be configured through the Admin Settings → Ticket Permissions menu.
                      </div>
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
                          <SelectItem value="none">No specific hotel</SelectItem>
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
          )}
        </Tabs>

        {/* Edit User Dialog */}
        {selectedUser && (
          <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit User</DialogTitle>
                <DialogDescription>
                  Update role and hotel assignment for {selectedUser.full_name}
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
                  <Label>Update Role</Label>
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

                <div className="space-y-2">
                  <Label>Current Hotel Assignment</Label>
                  <p className="text-sm text-muted-foreground">
                    {selectedUser.assigned_hotel || 'All Hotels'}
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label>Update Hotel Assignment</Label>
                  <Select 
                    value={selectedUser.assigned_hotel || 'none'}
                    onValueChange={(value: string) => handleUpdateUserHotel(selectedUser.id, value)}
                    disabled={loading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select hotel assignment" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">All Hotels</SelectItem>
                      {hotels.map((hotel) => (
                        <SelectItem key={hotel.id} value={hotel.name}>
                          {hotel.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Ticket Creation Permissions</Label>
                  <div className="text-sm text-muted-foreground">
                    To modify ticket creation permissions for this user, use the Admin Settings → Ticket Permissions menu.
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
        
        {/* Admin-only User Edit Dialog */}
        {currentUserRole === 'admin' && (
          <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
            <DialogContent className="w-[95vw] max-w-md h-[90vh] max-h-[90vh] flex flex-col">
              <DialogHeader className="flex-shrink-0">
                <DialogTitle>Edit User Details</DialogTitle>
                <DialogDescription>
                  Update user information and credentials (Admin only)
                </DialogDescription>
              </DialogHeader>
              
              <div className="flex-1 overflow-y-auto space-y-4 mt-4 pr-2">
                <div className="space-y-2">
                  <Label htmlFor="edit_full_name">Full Name</Label>
                  <Input
                    id="edit_full_name"
                    value={editUserData.full_name}
                    onChange={(e) => setEditUserData({ ...editUserData, full_name: e.target.value })}
                    placeholder="Enter full name"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="edit_nickname">Username/Nickname</Label>
                  <Input
                    id="edit_nickname"
                    value={editUserData.nickname}
                    onChange={(e) => setEditUserData({ ...editUserData, nickname: e.target.value })}
                    placeholder="Enter username"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="edit_email">Email</Label>
                  <Input
                    id="edit_email"
                    type="email"
                    value={editUserData.email}
                    onChange={(e) => setEditUserData({ ...editUserData, email: e.target.value })}
                    placeholder="Enter email"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="edit_phone">Phone Number</Label>
                  <Input
                    id="edit_phone"
                    value={editUserData.phone_number}
                    onChange={(e) => setEditUserData({ ...editUserData, phone_number: e.target.value })}
                    placeholder="Enter phone number"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="edit_role">Role</Label>
                  <Select value={editUserData.role} onValueChange={(value) => setEditUserData({ ...editUserData, role: value as Profile['role'] })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="housekeeping">Housekeeping</SelectItem>
                      <SelectItem value="reception">Reception</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                      <SelectItem value="marketing">Marketing</SelectItem>
                      <SelectItem value="control_finance">Control & Finance</SelectItem>
                      <SelectItem value="hr">HR</SelectItem>
                      <SelectItem value="front_office">Front Office</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="housekeeping_manager">Housekeeping Manager</SelectItem>
                      <SelectItem value="maintenance_manager">Maintenance Manager</SelectItem>
                      <SelectItem value="marketing_manager">Marketing Manager</SelectItem>
                      <SelectItem value="reception_manager">Reception Manager</SelectItem>
                      <SelectItem value="back_office_manager">Back Office Manager</SelectItem>
                      <SelectItem value="control_manager">Control Manager</SelectItem>
                      <SelectItem value="finance_manager">Finance Manager</SelectItem>
                      <SelectItem value="top_management_manager">Top Management Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="top_management">Top Management</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="edit_hotel">Assigned Hotel</Label>
                  <Select value={editUserData.assigned_hotel} onValueChange={(value) => setEditUserData({ ...editUserData, assigned_hotel: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select hotel" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">All Hotels</SelectItem>
                      {hotels.map((hotel) => (
                        <SelectItem key={hotel.id} value={hotel.name}>{hotel.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="edit_password">New Password (Optional)</Label>
                  <Input
                    id="edit_password"
                    type="password"
                    value={editUserData.password}
                    onChange={(e) => setEditUserData({ ...editUserData, password: e.target.value })}
                    placeholder="Leave blank to keep current password"
                  />
                  <p className="text-xs text-muted-foreground">
                    Password changes take effect immediately for admin overrides
                  </p>
                </div>
              </div>
              
              <div className="flex justify-end gap-2 mt-4 flex-shrink-0 pt-4 border-t">
                <Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={loading}>
                  Cancel
                </Button>
                <Button onClick={handleUpdateUser} disabled={loading}>
                  {loading ? 'Updating...' : 'Update User'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}