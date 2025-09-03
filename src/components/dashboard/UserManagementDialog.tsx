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
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [hotels, setHotels] = useState<any[]>([]);

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
      // Use the new secure function instead of admin API
      const { data, error } = await supabase.rpc('create_user_with_profile', {
        p_email: newUserData.email || null,
        p_password: newUserData.password,
        p_full_name: newUserData.full_name,
        p_role: newUserData.role,
        p_phone_number: newUserData.phone_number || null,
        p_assigned_hotel: newUserData.assigned_hotel || null
      });

      if (error) throw error;
      
      const result = data as { success: boolean; error?: string; message?: string };
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to create user');
      }

      toast({
        title: 'Success',
        description: result.message || 'User created successfully',
      });

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
      // Use the new secure function instead of admin API
      const { data, error } = await supabase.rpc('delete_user_profile', {
        p_user_id: userId
      });

      if (error) throw error;
      
      const result = data as { success: boolean; error?: string; message?: string };
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete user');
      }

      toast({
        title: 'Success',
        description: `User ${userName} deleted successfully`,
      });

      fetchUsers();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
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
                           <p className="text-sm text-muted-foreground">{user.email || 'No email'}</p>
                           {user.phone_number && (
                             <p className="text-sm text-muted-foreground">📞 {user.phone_number}</p>
                           )}
                           <p className="text-xs text-blue-600">
                             Hotel: {user.assigned_hotel || 'All Hotels'}
                           </p>
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
                        
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={loading}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete User</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you absolutely sure you want to delete <strong>{user.full_name}</strong>? 
                                This action cannot be undone and will permanently remove the user account and all associated data.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => handleDeleteUser(user.id, user.full_name)}
                                disabled={loading}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {loading ? 'Deleting...' : 'Delete Permanently'}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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
                           {/* Housekeeping managers can only create housekeeping staff */}
                           {currentUserRole === 'housekeeping_manager' && (
                             <SelectItem value="housekeeping">Housekeeping</SelectItem>
                           )}
                           
                           {/* Maintenance managers can create maintenance staff */}
                           {currentUserRole === 'maintenance_manager' && (
                             <SelectItem value="maintenance">Maintenance</SelectItem>
                           )}
                           
                           {/* Reception managers can create reception staff */}
                           {currentUserRole === 'reception_manager' && (
                             <SelectItem value="reception">Reception</SelectItem>
                           )}
                           
                           {/* Marketing managers can create marketing staff */}
                           {currentUserRole === 'marketing_manager' && (
                             <SelectItem value="marketing">Marketing</SelectItem>
                           )}
                           
                           {/* Other managers can create their department staff */}
                           {(currentUserRole === 'back_office_manager' || 
                             currentUserRole === 'control_manager' || 
                             currentUserRole === 'finance_manager') && (
                             <>
                               <SelectItem value="control_finance">Control & Finance</SelectItem>
                               <SelectItem value="hr">HR</SelectItem>
                               <SelectItem value="front_office">Front Office</SelectItem>
                             </>
                           )}
                           
                           {/* General managers can create most roles */}
                           {currentUserRole === 'manager' && (
                             <>
                               <SelectItem value="housekeeping">Housekeeping</SelectItem>
                               <SelectItem value="reception">Reception</SelectItem>
                               <SelectItem value="maintenance">Maintenance</SelectItem>
                               <SelectItem value="marketing">Marketing</SelectItem>
                               <SelectItem value="control_finance">Control & Finance</SelectItem>
                               <SelectItem value="hr">HR</SelectItem>
                               <SelectItem value="front_office">Front Office</SelectItem>
                             </>
                           )}
                           
                           {/* Top management and admins can create any role */}
                           {(currentUserRole === 'admin' || currentUserRole === 'top_management' || currentUserRole === 'top_management_manager') && (
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
                               {currentUserRole === 'admin' && <SelectItem value="admin">Admin</SelectItem>}
                             </>
                           )}
                         </SelectContent>
                       </Select>
                       <p className="text-xs text-muted-foreground">
                         {currentUserRole === 'housekeeping_manager' && 'You can only create housekeeping staff profiles'}
                         {(currentUserRole === 'admin' || currentUserRole === 'top_management') && 'You can create any user role'}
                         {(!['admin', 'top_management', 'housekeeping_manager'].includes(currentUserRole)) && 'Available roles based on your permissions'}
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
      </DialogContent>
    </Dialog>
  );
}