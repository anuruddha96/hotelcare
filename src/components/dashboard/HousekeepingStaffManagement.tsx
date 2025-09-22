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
import { UserPlus, Users, Edit } from 'lucide-react';
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
}

export function HousekeepingStaffManagement() {
  const [staff, setStaff] = useState<HousekeepingStaff[]>([]);
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [hotels, setHotels] = useState<any[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [newStaffData, setNewStaffData] = useState({
    full_name: '',
    phone_number: '',
    email: '',
    assigned_hotel: '',
  });
  const [generatedCredentials, setGeneratedCredentials] = useState<{username: string, password: string, email: string} | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editData, setEditData] = useState({ id: '', full_name: '', phone_number: '', email: '', assigned_hotel: 'none' });

  useEffect(() => {
    fetchCurrentUserRole();
    fetchHousekeepingStaff();
    fetchHotels();
  }, []);

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

  const fetchHousekeepingStaff = async () => {
    setLoading(true);
    try {
      // Use the hotel-filtered function to ensure managers only see their hotel's staff
      const { data, error } = await supabase
        .rpc('get_employees_by_hotel');

      if (error) throw error;
      
      // Filter only housekeeping staff from the result
      const housekeepingStaff = (data || []).filter(staff => staff.role === 'housekeeping');
      setStaff(housekeepingStaff);
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
      console.log('Creating staff with data:', newStaffData);
      
      // Call edge function which creates auth user and profile atomically
      const { data, error } = await supabase.functions.invoke('create-housekeeper', {
        body: {
          full_name: newStaffData.full_name,
          role: 'housekeeping',
          email: newStaffData.email || null,
          phone_number: newStaffData.phone_number || null,
          assigned_hotel: newStaffData.assigned_hotel || null,
        },
      });

      console.log('Function result:', { data, error });

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
      
      console.log('Parsed result:', result);
      
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
  const openEdit = (member: HousekeepingStaff) => {
    setEditData({
      id: member.id,
      full_name: member.full_name,
      phone_number: member.phone_number || '',
      email: member.email || '',
      assigned_hotel: member.assigned_hotel || 'none',
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
        assigned_hotel: editData.assigned_hotel === 'none' ? null : editData.assigned_hotel,
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
                <div className="space-y-2">
                  <Label htmlFor="staff_full_name">Full Name *</Label>
                  <Input
                    id="staff_full_name"
                    value={newStaffData.full_name}
                    onChange={(e) => setNewStaffData({ ...newStaffData, full_name: e.target.value })}
                    placeholder="Enter full name"
                    required
                  />
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
                  <p className="text-xs text-muted-foreground">
                    Email can be added later to enable notifications and login access
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="staff_hotel">Assigned Hotel</Label>
                  <Select 
                    value={newStaffData.assigned_hotel} 
                    onValueChange={(value) => setNewStaffData({ ...newStaffData, assigned_hotel: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select hotel" />
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
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="text-green-800 flex items-center gap-2">
              ✅ Housekeeper Created Successfully
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-green-700">
              Please provide these login credentials to the new housekeeper:
            </p>
            <div className="space-y-2 bg-white p-4 rounded border">
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
            
            <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2">
              <Badge className="bg-orange-500 text-white text-xs" variant="secondary">
                {t('staff.housekeeper')}
              </Badge>
              <Button size="sm" variant="outline" onClick={() => openEdit(member)}>
                <Edit className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="ml-1 sm:hidden">{t('staff.edit')}</span>
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
                  <SelectItem value="none">All Hotels</SelectItem>
                  {hotels.map((hotel) => (
                    <SelectItem key={hotel.id} value={hotel.name}>{hotel.name}</SelectItem>
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
    </div>
  );
}
