import React, { useState, useEffect } from 'react';
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
import { UserPlus, Users, Edit, Key, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';

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
  });
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
      
      // Set organization for non-super-admins
      if (!data?.is_super_admin && data?.organization_slug) {
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
    try {
      const { data: hotelsData, error: hotelsError } = await supabase
        .from('hotel_configurations')
        .select('hotel_id, hotel_name, organization_id')
        .eq('is_active', true)
        .order('hotel_name');

      if (hotelsError) throw hotelsError;

      const { data: orgsData, error: orgsError } = await supabase
        .from('organizations')
        .select('id, slug')
        .eq('is_active', true);

      if (orgsError) throw orgsError;

      const orgMap = new Map(orgsData?.map(org => [org.id, org.slug]) || []);

      const enrichedHotels = (hotelsData || []).map(hotel => ({
        ...hotel,
        organization_slug: hotel.organization_id ? orgMap.get(hotel.organization_id) : null
      }));

      setAllHotels(enrichedHotels);
    } catch (error: any) {
      console.error('Error fetching all hotels:', error);
    }
  };

  // Filter hotels based on organization for new staff form
  // For managers: use currentUserOrgSlug directly since they don't see org selector
  // For admins: use newStaffData.organization_slug from the selector
  useEffect(() => {
    const isManager = !isSuperAdmin && currentUserRole !== 'admin';
    const orgToUse = isManager ? currentUserOrgSlug : newStaffData.organization_slug;
    
    if (orgToUse && allHotels.length > 0) {
      const filteredHotels = allHotels.filter((hotel: any) => 
        hotel.organization_slug === orgToUse
      );
      setHotels(filteredHotels);
      
      // For managers, also ensure organization_slug is set in newStaffData
      if (isManager && currentUserOrgSlug && !newStaffData.organization_slug) {
        setNewStaffData(prev => ({
          ...prev,
          organization_slug: currentUserOrgSlug
        }));
      }
    } else {
      setHotels([]);
    }
  }, [newStaffData.organization_slug, currentUserOrgSlug, allHotels, isSuperAdmin, currentUserRole]);

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
        .in('role', ['housekeeping']);

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
      // Validate organization_slug
      if (!newStaffData.organization_slug) {
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

      // Call edge function which creates auth user and profile atomically
      const { data, error } = await supabase.functions.invoke('create-housekeeper', {
        body: {
          full_name: newStaffData.full_name,
          role: 'housekeeping',
          email: newStaffData.email || null,
          phone_number: newStaffData.phone_number || null,
          assigned_hotel: newStaffData.assigned_hotel,
          organization_slug: newStaffData.organization_slug,
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

      toast({
        title: 'Success',
        description: 'Housekeeping staff member created successfully',
      });

      setNewStaffData({
        full_name: '',
        phone_number: '',
        email: '',
        assigned_hotel: '',
        username: '',
        organization_slug: isSuperAdmin ? '' : currentUserOrgSlug,
      });
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

  return (
    <div className="space-y-4 sm:space-y-6 p-4 sm:p-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 sm:h-5 sm:w-5" />
          <h3 className="text-base sm:text-lg sm:text-xl font-semibold">{t('staff.housekeepingStaff')}</h3>
        </div>
        <Button 
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="w-full sm:w-auto text-sm"
        >
          <UserPlus className="h-3 w-3 sm:h-4 sm:w-4 mr-2" />
          <span className="sm:hidden">{t('staff.addNewHousekeeper')}</span>
          <span className="hidden sm:inline">{t('staff.addHousekeeper')}</span>
        </Button>
      </div>

      {showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Add New Housekeeper
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
                  <p className="text-xs text-muted-foreground">
                    Username will be auto-generated as: FirstName_XXX
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
                    disabled={hotels.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={hotels.length > 0 ? "Select hotel" : "Loading hotels..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {hotels.map((hotel) => (
                        <SelectItem key={hotel.hotel_id} value={hotel.hotel_name}>
                          {hotel.hotel_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {hotels.length === 0 && (isSuperAdmin || currentUserRole === 'admin') && !newStaffData.organization_slug && (
                    <p className="text-xs text-muted-foreground">
                      Please select an organization first
                    </p>
                  )}
                </div>
              </div>
              
              <div className="flex gap-2 pt-4">
                <Button type="submit" disabled={loading}>
                  {loading ? 'Creating...' : 'Create Housekeeper'}
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
                        <p className="text-xs sm:text-sm text-muted-foreground">📞 {member.phone_number}</p>
                      )}
                      <p className="text-xs text-blue-600">
                        Hotel: {member.assigned_hotel || t('staff.allHotels')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('staff.added')} {format(new Date(member.created_at), 'MMM dd, yyyy')}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <Badge className="bg-blue-500 text-white text-xs" variant="secondary">
                      {t('staff.housekeeper')}
                    </Badge>
                    <Button size="sm" variant="outline" onClick={() => openEdit(member)}>
                      <Edit className="h-3 w-3 sm:h-4 sm:w-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openResetPassword(member)}>
                      <Key className="h-3 w-3 sm:h-4 sm:w-4" />
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => openDeleteConfirm(member)}>
                      <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          
          {staff.length === 0 && (
            <Card>
              <CardContent className="text-center py-8">
                <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="font-medium mb-2">No housekeeping staff yet</h3>
                <p className="text-muted-foreground">
                  Use the "Add Housekeeper" button above to get started
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Housekeeper</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit_full_name">Full Name</Label>
              <Input id="edit_full_name" value={editData.full_name} onChange={(e) => setEditData({ ...editData, full_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_nickname">Username</Label>
              <Input id="edit_nickname" value={editData.nickname} onChange={(e) => setEditData({ ...editData, nickname: e.target.value })} placeholder="e.g., Nam_024" />
              <p className="text-xs text-muted-foreground">This is the login username</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_phone">Phone</Label>
              <Input id="edit_phone" value={editData.phone_number} onChange={(e) => setEditData({ ...editData, phone_number: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_email">Email</Label>
              <Input id="edit_email" type="email" value={editData.email} onChange={(e) => setEditData({ ...editData, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_hotel">Assigned Hotel</Label>
              <Select value={editData.assigned_hotel} onValueChange={(v) => setEditData({ ...editData, assigned_hotel: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select hotel" />
                </SelectTrigger>
                <SelectContent>
                  {editHotels.map((hotel: any) => (
                    <SelectItem key={hotel.hotel_id} value={hotel.hotel_name}>{hotel.hotel_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button onClick={saveEdit} disabled={loading}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Password Reset Dialog */}
      <Dialog open={resetPasswordOpen} onOpenChange={setResetPasswordOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password for {resetPasswordUserName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!generatedPassword ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="new_password">New Password (Optional)</Label>
                  <Input 
                    id="new_password" 
                    type="text"
                    value={newPassword} 
                    onChange={(e) => setNewPassword(e.target.value)} 
                    placeholder="Leave blank to auto-generate"
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to generate a random password automatically
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setResetPasswordOpen(false)}>Cancel</Button>
                  <Button onClick={handleResetPassword} disabled={loading}>
                    {loading ? 'Resetting...' : 'Reset Password'}
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
                  <p className="text-sm text-green-700 dark:text-green-300 mb-2">Password reset successfully!</p>
                  <div className="space-y-2">
                    <Label>New Password:</Label>
                    <Input value={generatedPassword} readOnly className="font-mono" />
                  </div>
                </div>
                <Button className="w-full" onClick={() => {
                  setResetPasswordOpen(false);
                  setGeneratedPassword('');
                }}>
                  Close
                </Button>
              </div>
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
              This will remove the housekeeper from the system. Their performance data and photos will be archived for 30 days before permanent deletion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {loading ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
