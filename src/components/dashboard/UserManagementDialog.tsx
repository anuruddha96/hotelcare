import { useState, useEffect } from 'react';
import { useTenantFeatures } from '@/hooks/useTenantFeatures';
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
import { Checkbox } from '@/components/ui/checkbox';
import { User, Edit, Trash2, UserPlus, Shield, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '@/hooks/use-toast';

interface Profile {
  id: string;
  email: string;
  full_name: string;
  nickname?: string;
  phone_number?: string;
  role: 'housekeeping' | 'reception' | 'maintenance' | 'manager' | 'admin' | 'marketing' | 'control_finance' | 'hr' | 'front_office' | 'top_management' | 'housekeeping_manager' | 'maintenance_manager' | 'marketing_manager' | 'reception_manager' | 'back_office' | 'back_office_manager' | 'control_manager' | 'finance_manager' | 'top_management_manager' | 'breakfast_staff' | 'supervisor';
  created_at: string;
  assigned_hotel?: string;
  is_super_admin?: boolean;
  organization_slug?: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
  deleted_by_name?: string | null;
}

interface UserManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserManagementDialog({ open, onOpenChange }: UserManagementDialogProps) {
  const { scopedStaffEnabled } = useTenantFeatures();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringUserId, setRestoringUserId] = useState<string | null>(null);
  const [showDeletedOnly, setShowDeletedOnly] = useState(false);
  const [editError, setEditError] = useState('');
  const [editingOriginal, setEditingOriginal] = useState<Profile | null>(null);
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
    is_super_admin: false,
    organization_slug: '',
    acts_as_housekeeper: false,
  });
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [currentUserIsSuperAdmin, setCurrentUserIsSuperAdmin] = useState(false);
  const [currentUserOrgSlug, setCurrentUserOrgSlug] = useState<string>('');
  const isTopManager = ['top_management', 'top_management_manager'].includes(currentUserRole);
  const canEditUsers = currentUserIsSuperAdmin || currentUserRole === 'admin' || isTopManager;
  const canEditTarget = (user: Profile) => canEditUsers && !user.deleted_at && (currentUserIsSuperAdmin || (
    !!currentUserOrgSlug && user.organization_slug === currentUserOrgSlug && !user.is_super_admin && user.role !== 'admin' &&
    (!isTopManager || !['top_management', 'top_management_manager'].includes(user.role))
  ));
  const [hotels, setHotels] = useState<any[]>([]);
  const [editHotels, setEditHotels] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [selectedOrgSlug, setSelectedOrgSlug] = useState<string>('');
  const [generatedCredentials, setGeneratedCredentials] = useState<{username: string; password: string; email: string} | null>(null);
  useEffect(() => {
    if (open) {
      fetchCurrentUserRole();
    }
  }, [open]);

  useEffect(() => {
    if (open && currentUserOrgSlug) {
      fetchUsers();
      fetchOrganizations();
      fetchHotels();
    }
  }, [open, currentUserOrgSlug, selectedOrgSlug]);

  const fetchCurrentUserRole = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role, is_super_admin, organization_slug')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      if (error) throw error;
      setCurrentUserRole(data?.role || '');
      setCurrentUserIsSuperAdmin(data?.is_super_admin || false);
      setCurrentUserOrgSlug(data?.organization_slug || '');
      setSelectedOrgSlug(data?.organization_slug || '');
    } catch (error: any) {
      console.error('Error fetching current user role:', error);
    }
  };

  const fetchOrganizations = async () => {
    try {
      if (currentUserIsSuperAdmin || currentUserRole === 'admin') {
        const { data, error } = await supabase
          .from('organizations')
          .select('*')
          .eq('is_active', true)
          .order('name');

        if (error) throw error;
        setOrganizations(data || []);
      }
    } catch (error: any) {
      console.error('Error fetching organizations:', error);
    }
  };

  const fetchHotels = async () => {
    try {
      // Determine which organization to filter by
      const orgToFilter = (currentUserIsSuperAdmin || currentUserRole === 'admin') && selectedOrgSlug 
        ? selectedOrgSlug 
        : currentUserOrgSlug;

      // Query hotel_configurations which has organization relationships
      let query = supabase
        .from('hotel_configurations')
        .select('hotel_id, hotel_name, organization_id')
        .eq('is_active', true);

      // Filter by organization if specified
      if (orgToFilter) {
        // Get organization ID from slug
        const { data: orgData } = await supabase
          .from('organizations')
          .select('id')
          .eq('slug', orgToFilter)
          .single();
        
        if (orgData) {
          query = query.eq('organization_id', orgData.id);
        }
      }
      
      const { data, error } = await query.order('hotel_name');
      
      if (error) throw error;
      
      // Transform to match expected format (id, name)
      const transformedHotels = (data || []).map(hotel => ({
        id: hotel.hotel_id,
        name: hotel.hotel_name
      }));
      
      setHotels(transformedHotels);
    } catch (error: any) {
      console.error('Error fetching hotels:', error);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      let query = supabase.from('profiles').select('*').order('created_at', { ascending: false });
      if (!currentUserIsSuperAdmin) query = query.eq('organization_slug', currentUserOrgSlug);
      const { data, error } = await query;

      if (error) {
        console.error('Access denied - insufficient permissions to view user profiles');
        throw error;
      }

      let rows = (data as any[]) || [];

      // Existing profiles RLS intentionally hides archived accounts from ordinary
      // organization admins. Fetch only the permitted archived rows through an
      // authenticated, tenant-scoped Edge Function; never relax global RLS.
      if (currentUserIsSuperAdmin || currentUserRole === 'admin') {
        const { data: archivedResult, error: archivedError } = await supabase.functions.invoke(
          'admin-list-deleted-users',
          { body: { organization_slug: currentUserIsSuperAdmin ? (selectedOrgSlug || undefined) : undefined } },
        );
        if (archivedError) throw archivedError;
        if (!archivedResult?.success) throw new Error(archivedResult?.error || 'Unable to load archived users');
        const knownIds = new Set(rows.map((profile: any) => profile.id));
        rows = [
          ...rows,
          ...((archivedResult.users || []) as any[]).filter(profile => !knownIds.has(profile.id)),
        ];
      }

      // For admins only, resolve deleted_by → full_name for display.
      const deleterIds = Array.from(
        new Set(rows.map(r => r.deleted_by).filter(Boolean))
      ) as string[];
      let deleterMap: Record<string, string> = {};
      if (deleterIds.length && (currentUserRole === 'admin' || currentUserIsSuperAdmin)) {
        const { data: deleters } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', deleterIds);
        (deleters || []).forEach((d: any) => { deleterMap[d.id] = d.full_name; });
      }

      const enriched = rows.map(r => ({
        ...r,
        deleted_by_name: r.deleted_by ? (deleterMap[r.deleted_by] || null) : null,
      })) as Profile[];

      setUsers(enriched);
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
    
    // Validate organization is selected
    if (!selectedOrgSlug) {
      toast({
        title: 'Error',
        description: 'Please select an organization',
        variant: 'destructive',
      });
      return;
    }
    
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
          organization_slug: selectedOrgSlug,
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

  const handleRestoreUser = async (userId: string, userName: string) => {
    setRestoringUserId(userId);
    try {
      // The edge function verifies the caller's administrator role and tenant scope.
      const { data, error } = await supabase.functions.invoke('admin-restore-user', {
        body: { target_user_id: userId },
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string; message?: string };
      if (!result?.success || result.error) {
        throw new Error(result?.error || 'Unable to restore user');
      }
      toast({
        title: 'Account restored',
        description: result.message || `${userName} can sign in with their existing credentials.`,
      });
      await fetchUsers();
    } catch (error: any) {
      toast({
        title: 'Restoration failed',
        description: error.message || 'The account was not restored.',
        variant: 'destructive',
      });
    } finally {
      setRestoringUserId(null);
    }
  };

  const handleEditUser = async (user: Profile) => {
    if (!canEditTarget(user)) return;
    const userOrgSlug = user.organization_slug || currentUserOrgSlug;
    setEditError('');
    setEditingOriginal(user);
    
    setEditUserData({
      id: user.id,
      full_name: user.full_name,
      nickname: user.nickname || '',
      email: user.email || '',
      password: '',
      phone_number: user.phone_number || '',
      role: user.role,
      assigned_hotel: user.assigned_hotel || 'none',
      is_super_admin: user.is_super_admin || false,
      organization_slug: userOrgSlug,
      acts_as_housekeeper: !!(user as any).acts_as_housekeeper,
    });
    
    // Fetch hotels for this organization
    await fetchHotelsForOrg(userOrgSlug);
    setEditDialogOpen(true);
  };
  
  const fetchHotelsForOrg = async (orgSlug: string) => {
    try {
      if (!orgSlug) {
        setEditHotels([]);
        return;
      }
      
      // Get organization ID from slug
      const { data: orgData } = await supabase
        .from('organizations')
        .select('id')
        .eq('slug', orgSlug)
        .single();
      
      if (!orgData) {
        setEditHotels([]);
        return;
      }
      
      const { data, error } = await supabase
        .from('hotel_configurations')
        .select('hotel_id, hotel_name')
        .eq('is_active', true)
        .eq('organization_id', orgData.id)
        .order('hotel_name');
      
      if (error) throw error;
      
      const transformedHotels = (data || []).map(hotel => ({
        id: hotel.hotel_id,
        name: hotel.hotel_name
      }));
      
      setEditHotels(transformedHotels);
    } catch (error: any) {
      console.error('Error fetching hotels for org:', error);
      setEditHotels([]);
    }
  };

  const handleUpdateUser = async () => {
    if (!editUserData.id || !editingOriginal || !canEditTarget(editingOriginal) || loading) return;
    setEditError('');
    if (editingOriginal.email && !editUserData.email.trim()) {
      setEditError('Email cannot be removed from an existing login. Enter a valid email address.');
      return;
    }
    if (!editUserData.full_name.trim() || !editUserData.assigned_hotel) {
      setEditError('Enter a full name and select a hotel or All Hotels.');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-update-user', {
        body: {
          target_user_id: editUserData.id,
          new_email: editUserData.email.trim() !== (editingOriginal.email || '') ? editUserData.email.trim() : undefined,
          new_password: editUserData.password || undefined,
          full_name: editUserData.full_name,
          nickname: editUserData.nickname,
          phone_number: editUserData.phone_number,
          role: editUserData.role,
          assigned_hotel: editUserData.assigned_hotel === 'none' ? null : editUserData.assigned_hotel,
          acts_as_housekeeper: editUserData.acts_as_housekeeper,
          ...(currentUserIsSuperAdmin ? { organization_slug: editUserData.organization_slug, is_super_admin: editUserData.is_super_admin } : {}),
        },
      });
      if (error) {
        let message = error.message;
        try {
          const body = await error.context?.json();
          message = body?.error || message;
        } catch { /* Keep the transport error if the response is not JSON. */ }
        throw new Error(message || 'Unable to save user details.');
      }
      if (!data?.success) throw new Error(data?.error || 'Unable to save user details.');
      toast({ title: 'Success', description: 'User updated successfully' });
      setEditDialogOpen(false);
      setEditingOriginal(null);
      setEditUserData(prev => ({ ...prev, password: '' }));
      await fetchUsers();
    } catch (error: any) {
      setEditError(error.message || 'Unable to save user details.');
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
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
      case 'breakfast_staff': return 'bg-amber-500 text-white';
      case 'supervisor': return 'bg-indigo-600 text-white';
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
      case 'breakfast_staff': return 'Breakfast Staff';
      case 'supervisor': return 'Supervisor';
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
            {(currentUserIsSuperAdmin || currentUserRole === 'admin') && (
              <div className="flex items-center gap-2 pb-3 px-1">
                <Checkbox
                  id="show-deleted-users-only"
                  checked={showDeletedOnly}
                  onCheckedChange={checked => setShowDeletedOnly(checked === true)}
                />
                <Label htmlFor="show-deleted-users-only" className="text-sm cursor-pointer">
                  Deleted users only ({users.filter(user => !!user.deleted_at).length})
                </Label>
              </div>
            )}
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : (
              <div className="space-y-3 pr-2">
                {users.filter(user => !showDeletedOnly || !!user.deleted_at).map((user) => (
                  <Card key={user.id} className={user.deleted_at ? 'opacity-60' : ''}>
                    <CardContent className="p-3 sm:p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-start gap-3">
                          <Avatar className="w-10 h-10 flex-shrink-0">
                            <AvatarFallback className="text-sm">
                              {user.full_name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-sm sm:text-base truncate">
                              {user.full_name}
                              {user.deleted_at && (
                                <span className="ml-2 text-xs font-normal text-destructive">(deleted)</span>
                              )}
                            </h4>
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
                            {user.deleted_at && (
                              <p className="text-xs text-destructive mt-1">
                                Deleted {format(new Date(user.deleted_at), 'MMM dd, yyyy')}
                                {user.deleted_by_name ? ` by ${user.deleted_by_name}` : ''}
                              </p>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2">
                          <div className="flex flex-wrap gap-1">
                            <Badge className={`${getRoleColor(user.role)} text-xs`} variant="secondary">
                              {getRoleLabel(user.role)}
                            </Badge>
                            {user.is_super_admin && (
                              <Badge variant="destructive" className="text-xs flex items-center gap-1">
                                <Shield className="h-3 w-3" />
                                Super Admin
                              </Badge>
                            )}
                            {user.deleted_at && (
                              <Badge variant="outline" className="text-xs border-destructive text-destructive">
                                Deleted
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {user.deleted_at && (currentUserIsSuperAdmin || (
                              currentUserRole === 'admin' &&
                              !user.is_super_admin &&
                              !['admin', 'top_management', 'top_management_manager'].includes(user.role)
                            )) && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={restoringUserId === user.id}
                                    className="h-8 sm:h-9 px-3 gap-1"
                                  >
                                    <RotateCcw className="h-3 w-3 sm:h-4 sm:w-4" />
                                    {restoringUserId === user.id ? 'Restoring...' : 'Restore'}
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent className="w-[95vw] max-w-md">
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Restore user access?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Restore <strong>{user.full_name}</strong> with their original role,
                                      hotel assignment, password, and historical records?
                                      They will be able to sign in again.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel disabled={restoringUserId === user.id}>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      disabled={restoringUserId === user.id}
                                      onClick={() => handleRestoreUser(user.id, user.full_name)}
                                    >
                                      Restore access
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                            {!user.deleted_at && (
                              <>
                                {canEditTarget(user) && (
                                  <Button size="sm" variant="outline" onClick={() => handleEditUser(user)}
                                    className="h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3">
                                    <Edit className="h-3 w-3 sm:h-4 sm:w-4" />
                                    <span className="hidden sm:inline sm:ml-1">Edit</span>
                                  </Button>
                                )}

                                {(currentUserIsSuperAdmin || currentUserRole === 'admin') && (
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
                                        Are you sure you want to delete <strong>{user.full_name}</strong>?
                                        They will lose access immediately.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
                                      <AlertDialogCancel disabled={loading} className="w-full sm:w-auto">Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => handleDeleteUser(user.id, user.full_name)}
                                        disabled={loading}
                                        className="w-full sm:w-auto bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      >
                                        {loading ? 'Deleting...' : 'Delete'}
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                                )}
                              </>
                            )}
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
                                 {scopedStaffEnabled && <SelectItem value="supervisor">Supervisor</SelectItem>}
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
                                 <SelectItem value="breakfast_staff">Breakfast Staff</SelectItem>
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

                     {(currentUserIsSuperAdmin || currentUserRole === 'admin') && (
                       <div className="space-y-2">
                         <Label htmlFor="organization">Organization</Label>
                         <Select 
                           value={selectedOrgSlug} 
                           onValueChange={(value: string) => {
                             setSelectedOrgSlug(value);
                             setNewUserData({ ...newUserData, assigned_hotel: '' });
                           }}
                         >
                           <SelectTrigger>
                             <SelectValue placeholder="Select organization" />
                           </SelectTrigger>
                           <SelectContent>
                             {organizations.map((org) => (
                               <SelectItem key={org.id} value={org.slug}>
                                 {org.name}
                               </SelectItem>
                             ))}
                           </SelectContent>
                         </Select>
                       </div>
                     )}
                     
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

        {/* Authorized user edit dialog */}
        {canEditUsers && (
          <Dialog open={editDialogOpen} onOpenChange={next => { if (!loading) setEditDialogOpen(next); }}>
            <DialogContent className="w-[95vw] max-w-md h-[90vh] max-h-[90vh] flex flex-col">
              <DialogHeader className="flex-shrink-0">
                <DialogTitle>Edit User Details</DialogTitle>
                <DialogDescription>
                  Update user information, role, hotel assignment and credentials
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
                    value={editUserData.email || ''}
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
                      {scopedStaffEnabled && <SelectItem value="supervisor">Supervisor</SelectItem>}
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
                      {!isTopManager && <SelectItem value="top_management_manager">Top Management Manager</SelectItem>}
                      <SelectItem value="breakfast_staff">Breakfast Staff</SelectItem>
                      {currentUserIsSuperAdmin && <SelectItem value="admin">Admin</SelectItem>}
                      {!isTopManager && <SelectItem value="top_management">Top Management</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>

                {['manager','housekeeping_manager','reception_manager','maintenance_manager','marketing_manager','back_office_manager','control_manager','finance_manager','top_management_manager','admin','front_office','hr'].includes(editUserData.role) && (
                  <div className="space-y-2 p-4 border rounded-lg bg-muted/50">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="edit_acts_as_housekeeper"
                        checked={editUserData.acts_as_housekeeper}
                        onCheckedChange={(checked) => setEditUserData({ ...editUserData, acts_as_housekeeper: checked as boolean })}
                      />
                      <Label htmlFor="edit_acts_as_housekeeper" className="text-sm font-semibold cursor-pointer">
                        Also acts as housekeeper (can be assigned rooms)
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground ml-6">
                      Supervisor + housekeeper hybrid: keeps full manager access and appears in auto-assign & manual room assignment pickers. A "My Tasks" tab is shown next to Team View.
                    </p>
                  </div>
                )}

                
                {currentUserIsSuperAdmin && (
                  <div className="space-y-2">
                    <Label htmlFor="edit_organization">Organization</Label>
                    <Select 
                      value={editUserData.organization_slug} 
                      onValueChange={async (value: string) => {
                        setEditUserData({ ...editUserData, organization_slug: value, assigned_hotel: '' });
                        await fetchHotelsForOrg(value);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select organization" />
                      </SelectTrigger>
                      <SelectContent>
                        {organizations.map((org) => (
                          <SelectItem key={org.id} value={org.slug}>
                            {org.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                
                <div className="space-y-2">
                  <Label htmlFor="edit_hotel">Assigned Hotel</Label>
                  <Select value={editUserData.assigned_hotel} onValueChange={(value) => setEditUserData({ ...editUserData, assigned_hotel: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select hotel" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">All Hotels</SelectItem>
                      {editHotels.map((hotel) => (
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
                
                {currentUserIsSuperAdmin && (
                  <div className="space-y-2 p-4 border rounded-lg bg-muted/50">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="edit_super_admin"
                        checked={editUserData.is_super_admin}
                        onCheckedChange={(checked) => setEditUserData({ ...editUserData, is_super_admin: checked as boolean })}
                      />
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-destructive" />
                        <Label htmlFor="edit_super_admin" className="text-sm font-semibold cursor-pointer">
                          Super Admin
                        </Label>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground ml-6">
                      Super Admins can create and manage organizations across the entire system
                    </p>
                  </div>
                )}
              </div>
              
              {editError && <p role="alert" className="text-sm text-destructive">{editError}</p>}
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