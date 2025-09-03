import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { UserPlus, Users, Edit } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '@/hooks/use-toast';

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
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'housekeeping')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setStaff(data || []);
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
      // Use the new v2 function to avoid conflicts
      const { data, error } = await supabase.rpc('create_user_with_profile_v2', {
        p_full_name: newStaffData.full_name,
        p_role: 'housekeeping',
        p_email: newStaffData.email || null,
        p_phone_number: newStaffData.phone_number || null,
        p_assigned_hotel: newStaffData.assigned_hotel || null
      });

      if (error) throw error;
      
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
      });
      setShowCreateForm(false);
      
      fetchHousekeepingStaff();
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

  // Only show for housekeeping managers
  if (currentUserRole !== 'housekeeping_manager') {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          <h3 className="text-lg font-semibold">Housekeeping Staff</h3>
        </div>
        <Button onClick={() => setShowCreateForm(!showCreateForm)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Add Housekeeper
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
        <div className="grid gap-4">
          {staff.map((member) => (
            <Card key={member.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <Avatar>
                    <AvatarFallback>
                      {member.full_name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h4 className="font-semibold">{member.full_name}</h4>
                    <p className="text-sm text-muted-foreground">
                      {member.email || 'No email provided'}
                    </p>
                    {member.phone_number && (
                      <p className="text-sm text-muted-foreground">📞 {member.phone_number}</p>
                    )}
                    <p className="text-xs text-blue-600">
                      Hotel: {member.assigned_hotel || 'All Hotels'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Added {format(new Date(member.created_at), 'MMM dd, yyyy')}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Badge className="bg-orange-500 text-white" variant="secondary">
                    Housekeeper
                  </Badge>
                  <Button size="sm" variant="outline">
                    <Edit className="h-4 w-4" />
                  </Button>
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
    </div>
  );
}
