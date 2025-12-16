import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { UserPlus, Users, Edit, Key, Trash2, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { TrainingAssignmentManager } from '@/components/training';

interface HousekeepingStaff {
  id: string;
  email?: string;
  full_name: string;
  phone_number?: string;
  role: string;
  created_at: string;
  assigned_hotel?: string;
  nickname?: string;
  organization_slug?: string;
}

export function HousekeepingStaffManagement() {
  const [staff, setStaff] = useState<HousekeepingStaff[]>([]);
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [hotels, setHotels] = useState<any[]>([]);
  const [allHotels, setAllHotels] = useState<any[]>([]);
  const [hotelsLoading, setHotelsLoading] = useState(true);
  const [editHotels, setEditHotels] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [currentUserOrgSlug, setCurrentUserOrgSlug] = useState<string>('');
  const [currentUserHotel, setCurrentUserHotel] = useState<string>('');
  
  const [newStaffData, setNewStaffData] = useState({
    full_name: '',
    phone_number: '',
    email: '',
    assigned_hotel: '',
    username: '',
    organization_slug: '',
    use_custom_password: false,
    custom_password: '',
    role: 'housekeeping' as 'housekeeping' | 'maintenance' | 'manager',
  });
  
  // Username validation state
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [existingUsernameCount, setExistingUsernameCount] = useState(0);
  const [previewUsername, setPreviewUsername] = useState('');
  
  const [generatedCredentials, setGeneratedCredentials] = useState<{username: string, password: string, email: string} | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editData, setEditData] = useState({ 
    id: '', 
    full_name: '', 
    phone_number: '', 
    email: '', 
    assigned_hotel: '',
    nickname: '',
    organization_slug: ''
  });
  
  // Password reset state
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string>('');
  const [resetPasswordUserName, setResetPasswordUserName] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [generatedPassword, setGeneratedPassword] = useState<string>('');
  
  // Delete state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<string>('');
  const [deleteUserName, setDeleteUserName] = useState<string>('');

  useEffect(() => {
    fetchCurrentUserRole();
    fetchHousekeepingStaff();
    fetchOrganizations();
    fetchAllHotels();
  }, []);

  const fetchCurrentUserRole = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role, is_super_admin, organization_slug, assigned_hotel')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      if (error) throw error;
      setCurrentUserRole(data?.role || '');
      setIsSuperAdmin(data?.is_super_admin || false);
      setCurrentUserOrgSlug(data?.organization_slug || '');
      setCurrentUserHotel(data?.assigned_hotel || '');
      
      // Set organization for non-super-admins immediately
      if (!data?.is_super_admin && data?.role !== 'admin' && data?.organization_slug) {
        setNewStaffData(prev => ({
          ...prev,
          organization_slug: data.organization_slug
        }));
      }
    } catch (error: any) {
      console.error('Error fetching current user role:', error);
    }
  };

  const fetchOrganizations = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, slug')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setOrganizations(data || []);
    } catch (error: any) {
      console.error('Error fetching organizations:', error);
    }
  };

  const fetchAllHotels = async () => {
    setHotelsLoading(true);
    try {
      const { data: hotelsData, error: hotelsError } = await supabase
        .from('hotel_configurations')
        .select('hotel_id, hotel_name, organization_id')
        .eq('is_active', true)
        .order('hotel_name');

      if (hotelsError) throw hotelsError;

      // Try to get organizations - may fail for managers due to RLS
      const { data: orgsData } = await supabase
        .from('organizations')
        .select('id, slug')
        .eq('is_active', true);

      const orgMap = new Map(orgsData?.map(org => [org.id, org.slug]) || []);

      const enrichedHotels = (hotelsData || []).map(hotel => ({
        ...hotel,
        organization_slug: hotel.organization_id ? orgMap.get(hotel.organization_id) : null
      }));

      setAllHotels(enrichedHotels);
    } catch (error: any) {
      console.error('Error fetching all hotels:', error);
    } finally {
      setHotelsLoading(false);
    }
  };

  // Fetch hotels for managers using the secure RPC function
  const fetchHotelsForManager = useCallback(async (orgSlug: string) => {
    if (!orgSlug) return;
    
    try {
      // Use the new RPC function to get hotels for user's organization
      const { data: hotelsData, error: hotelsError } = await supabase
        .rpc('get_user_organization_hotels');

      if (hotelsError) {
        console.error('Error fetching hotels via RPC:', hotelsError);
        return;
      }

      const mappedHotels = (hotelsData || []).map((h: any) => ({
        hotel_id: h.hotel_id,
        hotel_name: h.hotel_name,
        organization_slug: orgSlug
      }));
      setHotels(mappedHotels);
    } catch (error) {
      console.error('Error fetching hotels for manager:', error);
    }
  }, []);

  // Filter hotels based on organization for new staff form
  useEffect(() => {
    const isManager = !isSuperAdmin && currentUserRole !== 'admin';
    
    // For managers: fetch hotels using the secure RPC function
    if (isManager && currentUserOrgSlug) {
      fetchHotelsForManager(currentUserOrgSlug);
      setHotelsLoading(false);
      return;
    }
    
    // For admins/super-admins: use the existing allHotels filtering logic
    if (!isManager) {
      if (hotelsLoading) return;
      
      const orgToUse = newStaffData.organization_slug;
      
      if (orgToUse && allHotels.length > 0) {
        const filteredHotels = allHotels.filter((hotel: any) => 
          hotel.organization_slug === orgToUse
        );
        setHotels(filteredHotels);
      } else {
        setHotels([]);
      }
    }
  }, [newStaffData.organization_slug, currentUserOrgSlug, allHotels, isSuperAdmin, currentUserRole, hotelsLoading, fetchHotelsForManager]);

  // Check username availability when full_name changes
  const checkUsernameAvailability = useCallback(async (fullName: string, orgSlug: string) => {
    if (!fullName.trim() || !orgSlug) {
      setUsernameStatus('idle');
      setPreviewUsername('');
      return;
    }

    const firstName = fullName.trim().split(' ')[0];
    if (!firstName) {
      setUsernameStatus('idle');
      setPreviewUsername('');
      return;
    }

    setUsernameStatus('checking');
    
    try {
      // Check for existing usernames with the same first name pattern in this organization
      const { data, error } = await supabase
        .from('profiles')
        .select('nickname')
        .eq('organization_slug', orgSlug)
        .ilike('nickname', `${firstName}_%`);

      if (error) throw error;

      const count = data?.length || 0;
      setExistingUsernameCount(count);
      
      // Generate preview username (next available number)
      const nextNumber = String(count + 1).padStart(3, '0');
      setPreviewUsername(`${firstName}_${nextNumber}`);
      setUsernameStatus('available');
    } catch (error) {
      console.error('Error checking username:', error);
      setUsernameStatus('idle');
    }
  }, []);

  // Debounced username check
  useEffect(() => {
    const orgSlug = newStaffData.organization_slug || currentUserOrgSlug;
    const timer = setTimeout(() => {
      checkUsernameAvailability(newStaffData.full_name, orgSlug);
    }, 500);

    return () => clearTimeout(timer);
  }, [newStaffData.full_name, newStaffData.organization_slug, currentUserOrgSlug, checkUsernameAvailability]);

  const fetchHousekeepingStaff = async () => {
    setLoading(true);
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('assigned_hotel, organization_slug')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();

      // Fetch staff directly from profiles with organization filtering
      let query = supabase
        .from('profiles')
        .select('id, email, full_name, phone_number, role, created_at, assigned_hotel, nickname, organization_slug')
        .in('role', ['housekeeping', 'maintenance', 'manager', 'housekeeping_manager']);

      // Filter by organization
      if (profileData?.organization_slug) {
        query = query.eq('organization_slug', profileData.organization_slug);
      }

      // For managers, also filter by hotel if they have one assigned
      if (profileData?.assigned_hotel && !['admin', 'top_management'].includes(currentUserRole)) {
        query = query.eq('assigned_hotel', profileData.assigned_hotel);
      }

      const { data, error } = await query.order('full_name');

      if (error) throw error;
      
      setStaff((data || []).map(staff => ({
        ...staff,
        created_at: staff.created_at || new Date().toISOString()
      })));
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to fetch housekeeping staff',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      // Get org slug (use manager's org if not admin)
      const orgSlug = newStaffData.organization_slug || currentUserOrgSlug;
      
      // Validate organization_slug
      if (!orgSlug) {
        toast({
          title: 'Error',
          description: 'Please select an organization',
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }

      // Validate hotel selection (required for housekeepers)
      if (!newStaffData.assigned_hotel) {
        toast({
          title: 'Error',
          description: 'Please select a hotel for the housekeeper',
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }

      // Validate custom password if enabled
      if (newStaffData.use_custom_password && newStaffData.custom_password.length < 6) {
        toast({
          title: 'Error',
          description: 'Password must be at least 6 characters',
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }

      // Call edge function which creates auth user and profile atomically
      const { data, error } = await supabase.functions.invoke('create-housekeeper', {
        body: {
          full_name: newStaffData.full_name,
          role: newStaffData.role || 'housekeeping',
          email: newStaffData.email || null,
          phone_number: newStaffData.phone_number || null,
          assigned_hotel: newStaffData.assigned_hotel,
          organization_slug: orgSlug,
          password: newStaffData.use_custom_password ? newStaffData.custom_password : null,
        },
      });

      if (error) {
        const serverMsg = (data as any)?.error || (data as any)?.message;
        throw new Error(serverMsg || error.message || 'Edge function failed');
      }
      
      const result = data as { 
        success: boolean; 
        error?: string; 
        message?: string;
        username?: string;
        password?: string;
        email?: string;
      };
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to create staff member');
      }

      // Show generated credentials
      if (result.username && result.password) {
        setGeneratedCredentials({
          username: result.username,
          password: result.password,
          email: result.email || ''
        });
      }

      const roleLabel = newStaffData.role === 'maintenance' ? 'Maintenance' : 
                       newStaffData.role === 'manager' ? 'Manager' : 'Housekeeping';
      toast({
        title: 'Success',
        description: `${roleLabel} staff member created successfully`,
      });

      setNewStaffData({
        full_name: '',
        phone_number: '',
        email: '',
        assigned_hotel: '',
        username: '',
        organization_slug: isSuperAdmin ? '' : currentUserOrgSlug,
        use_custom_password: false,
        custom_password: '',
        role: 'housekeeping',
      });
      setUsernameStatus('idle');
      setPreviewUsername('');
      setShowCreateForm(false);
      
      fetchHousekeepingStaff();
    } catch (error: any) {
      console.error('Error creating staff:', error);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Edit handlers
  const openEdit = async (member: HousekeepingStaff) => {
    // Get current user's org if not already loaded
    let userOrgSlug = currentUserOrgSlug;
    if (!userOrgSlug) {
      const { data: userData } = await supabase
        .from('profiles')
        .select('organization_slug')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .single();
      userOrgSlug = userData?.organization_slug || '';
    }

    // Fetch housekeeper's profile with organization_slug
    const { data: profileData } = await supabase
      .from('profiles')
      .select('organization_slug')
      .eq('id', member.id)
      .single();

    // Use housekeeper's org, fallback to current user's org
    const orgSlug = profileData?.organization_slug || userOrgSlug;
    
    // Fetch hotels and organizations to filter by org
    const [hotelsResult, orgsResult] = await Promise.all([
      supabase
        .from('hotel_configurations')
        .select('hotel_id, hotel_name, organization_id')
        .eq('is_active', true),
      supabase
        .from('organizations')
        .select('id, slug')
        .eq('is_active', true)
    ]);

    const orgMap = new Map(orgsResult.data?.map(org => [org.id, org.slug]) || []);
    
    // Enrich hotels with organization_slug and filter by the relevant org
    const enrichedHotels = (hotelsResult.data || [])
      .map(hotel => ({
        ...hotel,
        organization_slug: hotel.organization_id ? orgMap.get(hotel.organization_id) : null
      }))
      .filter((hotel: any) => hotel.organization_slug === orgSlug);
    
    setEditHotels(enrichedHotels);

    setEditData({
      id: member.id,
      full_name: member.full_name,
      phone_number: member.phone_number || '',
      email: member.email || '',
      assigned_hotel: member.assigned_hotel || '',
      nickname: member.nickname || '',
      organization_slug: orgSlug
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editData.id) return;
    setLoading(true);
    try {
      const payload: any = {
        full_name: editData.full_name,
        phone_number: editData.phone_number || null,
        email: editData.email || '',
        assigned_hotel: editData.assigned_hotel || null,
        nickname: editData.nickname || null,
      };
      const { error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('id', editData.id);
      if (error) throw error;
      toast({ title: 'Updated', description: 'Staff member updated successfully' });
      setEditOpen(false);
      fetchHousekeepingStaff();
    } catch (err: any) {
      console.error('Update failed:', err);
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Password reset handlers
  const openResetPassword = (member: HousekeepingStaff) => {
    setResetPasswordUserId(member.id);
    setResetPasswordUserName(member.full_name);
    setNewPassword('');
    setGeneratedPassword('');
    setResetPasswordOpen(true);
  };

  const handleResetPassword = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('manager-reset-password', {
        body: {
          target_user_id: resetPasswordUserId,
          new_password: newPassword || null,
        },
      });

      if (error) throw new Error(error.message);
      
      const result = data as { success: boolean; password?: string; error?: string };
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to reset password');
      }

      setGeneratedPassword(result.password || '');
      toast({ 
        title: 'Password Reset', 
        description: `Password has been reset for ${resetPasswordUserName}` 
      });
    } catch (err: any) {
      console.error('Password reset failed:', err);
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Delete handlers
  const openDeleteConfirm = (member: HousekeepingStaff) => {
    setDeleteUserId(member.id);
    setDeleteUserName(member.full_name);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteUser = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-delete-user', {
        body: {
          target_user_id: deleteUserId,
          soft_delete: true, // Archive data for 30 days
        },
      });

      if (error) throw new Error(error.message);
      
      const result = data as { success: boolean; error?: string };
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete user');
      }

      toast({ 
        title: 'User Deleted', 
        description: `${deleteUserName} has been removed. Data will be kept for 30 days.` 
      });
      setDeleteConfirmOpen(false);
      fetchHousekeepingStaff();
    } catch (err: any) {
      console.error('Delete failed:', err);
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Allow access for admins, top management, managers, and housekeeping managers
  if (!['admin', 'top_management', 'manager', 'housekeeping_manager'].includes(currentUserRole)) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p className="text-sm">{t('staff.accessRestricted')}</p>
      </div>
    );
  }

  // Check if hotels are ready for display
  const isHotelsReady = !hotelsLoading && hotels.length > 0;
  const showSelectOrgFirst = (isSuperAdmin || currentUserRole === 'admin') && !newStaffData.organization_slug;

  return (
    <div className="space-y-4 sm:space-y-6 p-4 sm:p-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 sm:h-5 sm:w-5" />
          <h3 className="text-base sm:text-lg sm:text-xl font-semibold">{t('staff.staffManagement')}</h3>
        </div>
        <Button 
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="w-full sm:w-auto text-sm"
        >
          <UserPlus className="h-3 w-3 sm:h-4 sm:w-4 mr-2" />
          <span className="sm:hidden">{t('staff.addStaff')}</span>
          <span className="hidden sm:inline">{t('staff.addNewStaff')}</span>
        </Button>
      </div>

      {showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Add New Staff Member
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateStaff} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Organization Selector - only for super admins and admins */}
                {(isSuperAdmin || currentUserRole === 'admin') && (
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="staff_organization">Organization *</Label>
                    <Select 
                      value={newStaffData.organization_slug} 
                      onValueChange={(value) => {
                        setNewStaffData({ 
                          ...newStaffData, 
                          organization_slug: value,
                          assigned_hotel: '' // Reset hotel when org changes
                        });
                      }}
                      disabled={!isSuperAdmin && currentUserRole !== 'admin'}
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
                    <p className="text-xs text-muted-foreground">
                      Select which organization this housekeeper belongs to
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="staff_full_name">Full Name *</Label>
                  <Input
                    id="staff_full_name"
                    value={newStaffData.full_name}
                    onChange={(e) => setNewStaffData({ ...newStaffData, full_name: e.target.value })}
                    placeholder="Enter full name"
                    required
                  />
                  <div className="flex items-center gap-2 text-xs">
                    {usernameStatus === 'checking' && (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        <span className="text-muted-foreground">Checking username...</span>
                      </>
                    )}
                    {usernameStatus === 'available' && previewUsername && (
                      <>
                        <CheckCircle2 className="h-3 w-3 text-green-600" />
                        <span className="text-green-600">
                          Username will be: <strong>{previewUsername}</strong>
                          {existingUsernameCount > 0 && (
                            <span className="text-muted-foreground ml-1">
                              ({existingUsernameCount} existing with same first name)
                            </span>
                          )}
                        </span>
                      </>
                    )}
                    {usernameStatus === 'idle' && (
                      <span className="text-muted-foreground">
                        Username will be auto-generated as: FirstName_XXX
                      </span>
                    )}
                  </div>
                </div>

                {/* Role Selector */}
                <div className="space-y-2">
                  <Label htmlFor="staff_role">Role *</Label>
                  <Select 
                    value={newStaffData.role} 
                    onValueChange={(value: 'housekeeping' | 'maintenance' | 'manager') => 
                      setNewStaffData({ ...newStaffData, role: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="housekeeping">Housekeeper</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {newStaffData.role === 'housekeeping' && 'Housekeepers can clean rooms and mark tasks complete'}
                    {newStaffData.role === 'maintenance' && 'Maintenance staff can handle repair tickets'}
                    {newStaffData.role === 'manager' && 'Managers can oversee staff and approve work'}
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="staff_phone">Phone Number (Optional)</Label>
                  <Input
                    id="staff_phone"
                    type="tel"
                    value={newStaffData.phone_number}
                    onChange={(e) => setNewStaffData({ ...newStaffData, phone_number: e.target.value })}
                    placeholder="Enter phone number"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="staff_email">Email (Optional)</Label>
                  <Input
                    id="staff_email"
                    type="email"
                    value={newStaffData.email}
                    onChange={(e) => setNewStaffData({ ...newStaffData, email: e.target.value })}
                    placeholder="Enter email address"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="staff_hotel">Assigned Hotel *</Label>
                  <Select 
                    value={newStaffData.assigned_hotel} 
                    onValueChange={(value) => setNewStaffData({ ...newStaffData, assigned_hotel: value })}
                    disabled={hotelsLoading || showSelectOrgFirst}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={
                        hotelsLoading ? "Loading hotels..." : 
                        showSelectOrgFirst ? "Select organization first" :
                        hotels.length > 0 ? "Select hotel" : "No hotels available"
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      {hotels.map((hotel) => (
                        <SelectItem key={hotel.hotel_id} value={hotel.hotel_name}>
                          {hotel.hotel_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {showSelectOrgFirst && (
                    <p className="text-xs text-muted-foreground">
                      Please select an organization first
                    </p>
                  )}
                </div>

                {/* Custom Password Section */}
                <div className="space-y-3 md:col-span-2 pt-2 border-t">
                  <div className="flex items-center gap-3">
                    <Switch 
                      id="use_custom_password"
                      checked={newStaffData.use_custom_password}
                      onCheckedChange={(checked) => setNewStaffData({
                        ...newStaffData, 
                        use_custom_password: checked,
                        custom_password: checked ? newStaffData.custom_password : ''
                      })}
                    />
                    <Label htmlFor="use_custom_password" className="cursor-pointer">
                      Set custom password
                    </Label>
                  </div>
                  
                  {newStaffData.use_custom_password && (
                    <div className="space-y-2">
                      <Input
                        type="text"
                        value={newStaffData.custom_password}
                        onChange={(e) => setNewStaffData({...newStaffData, custom_password: e.target.value})}
                        placeholder="Enter custom password (min 6 characters)"
                        minLength={6}
                      />
                      <p className="text-xs text-muted-foreground">
                        Enter a simple password for the housekeeper to remember (e.g., hk2024)
                      </p>
                    </div>
                  )}
                  
                  {!newStaffData.use_custom_password && (
                    <p className="text-xs text-muted-foreground">
                      A secure password will be auto-generated if custom password is not set
                    </p>
                  )}
                </div>
              </div>
              
              <div className="flex gap-2 pt-4">
                <Button type="submit" disabled={loading}>
                  {loading ? 'Creating...' : `Create ${newStaffData.role === 'maintenance' ? 'Maintenance Staff' : newStaffData.role === 'manager' ? 'Manager' : 'Housekeeper'}`}
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {generatedCredentials && (
        <Card className="border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
          <CardHeader>
            <CardTitle className="text-green-800 dark:text-green-200 flex items-center gap-2">
              ✅ Housekeeper Created Successfully
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-green-700 dark:text-green-300">
              Please provide these login credentials to the new housekeeper:
            </p>
            <div className="space-y-2 bg-background p-4 rounded border">
              <div>
                <Label className="font-semibold">Username:</Label>
                <Input 
                  value={generatedCredentials.username} 
                  readOnly 
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="font-semibold">Password:</Label>
                <Input 
                  value={generatedCredentials.password} 
                  readOnly 
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="font-semibold">Email:</Label>
                <Input 
                  value={generatedCredentials.email} 
                  readOnly 
                  className="mt-1"
                />
              </div>
            </div>
            <Button 
              onClick={() => setGeneratedCredentials(null)}
              variant="outline"
              className="w-full"
            >
              Close
            </Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : (
        <div className="grid gap-3 sm:gap-4">
          {staff.map((member) => (
            <Card key={member.id}>
              <CardContent className="p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <Avatar className="w-10 h-10 sm:w-12 sm:h-12">
                      <AvatarFallback className="text-sm sm:text-base">
                        {member.full_name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-sm sm:text-base truncate">{member.full_name}</h4>
                      {member.nickname && (
                        <p className="text-xs font-medium text-primary">@{member.nickname}</p>
                      )}
                      <p className="text-xs sm:text-sm text-muted-foreground truncate">
                        {member.email || t('staff.noEmailProvided')}
                      </p>
                      {member.phone_number && (
                        <p className="text-xs text-muted-foreground">{member.phone_number}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 items-start sm:items-end">
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="secondary" className="text-xs">
                        {member.role}
                      </Badge>
                      {member.assigned_hotel && (
                        <Badge variant="outline" className="text-xs">
                          {member.assigned_hotel}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('staff.joined')}: {format(new Date(member.created_at), 'PP')}
                    </p>
                    <div className="flex gap-1">
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        onClick={() => openEdit(member)}
                        className="h-7 px-2"
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        onClick={() => openResetPassword(member)}
                        className="h-7 px-2"
                      >
                        <Key className="h-3 w-3" />
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        onClick={() => openDeleteConfirm(member)}
                        className="h-7 px-2 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {staff.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{t('staff.noHousekeepingStaff')}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Staff Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input
                value={editData.full_name}
                onChange={(e) => setEditData({ ...editData, full_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Nickname (Username)</Label>
              <Input
                value={editData.nickname}
                onChange={(e) => setEditData({ ...editData, nickname: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Phone Number</Label>
              <Input
                value={editData.phone_number}
                onChange={(e) => setEditData({ ...editData, phone_number: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                value={editData.email}
                onChange={(e) => setEditData({ ...editData, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Assigned Hotel</Label>
              <Select 
                value={editData.assigned_hotel} 
                onValueChange={(value) => setEditData({ ...editData, assigned_hotel: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select hotel" />
                </SelectTrigger>
                <SelectContent>
                  {editHotels.map((hotel) => (
                    <SelectItem key={hotel.hotel_id} value={hotel.hotel_name}>
                      {hotel.hotel_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Password Reset Dialog */}
      <Dialog open={resetPasswordOpen} onOpenChange={setResetPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password for {resetPasswordUserName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>New Password (leave empty to auto-generate)</Label>
              <Input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password or leave empty"
              />
              <p className="text-xs text-muted-foreground">
                Enter a custom password or leave empty to generate a secure one
              </p>
            </div>
            {generatedPassword && (
              <div className="p-4 bg-green-50 dark:bg-green-950 rounded border border-green-200 dark:border-green-800">
                <Label className="text-green-800 dark:text-green-200">New Password:</Label>
                <Input 
                  value={generatedPassword} 
                  readOnly 
                  className="mt-1 bg-background"
                />
                <p className="text-xs text-green-700 dark:text-green-300 mt-2">
                  Please provide this password to the staff member
                </p>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setResetPasswordOpen(false)}>Close</Button>
            {!generatedPassword && (
              <Button onClick={handleResetPassword} disabled={loading}>
                {loading ? 'Resetting...' : 'Reset Password'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteUserName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive the staff member's data for 30 days before permanent deletion.
              Their room assignments and performance data will be preserved for reporting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteUser}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {loading ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Training Assignment Section */}
      {currentUserOrgSlug && (
        <TrainingAssignmentManager 
          organizationSlug={currentUserOrgSlug}
          hotelFilter={currentUserHotel}
        />
      )}
    </div>
  );
}
