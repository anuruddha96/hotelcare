import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Hotel, Plus, AlertCircle } from 'lucide-react';
import { HotelOnboarding } from './HotelOnboarding';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface HotelConfig {
  id: string;
  hotel_id: string;
  hotel_name: string;
  organization_id: string;
  is_active: boolean;
  created_at: string;
  organizations: {
    name: string;
    slug: string;
  };
}

export const HotelManagementView = () => {
  const [hotels, setHotels] = useState<HotelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    fetchHotels();
  }, []);

  const fetchHotels = async () => {
    try {
      const { data, error } = await supabase
        .from('hotel_configurations')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Fetch organizations separately and merge
      const { data: orgsData } = await supabase
        .from('organizations')
        .select('id, name, slug');
      
      const orgsMap = new Map(orgsData?.map(org => [org.id, org]) || []);
      
      const hotelsWithOrgs = (data || []).map(hotel => ({
        ...hotel,
        organizations: orgsMap.get(hotel.organization_id) || { name: 'Unknown', slug: 'unknown' }
      }));
      
      setHotels(hotelsWithOrgs);
    } catch (error: any) {
      toast.error('Failed to fetch hotels');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (showOnboarding) {
    return (
      <div>
        <Button 
          variant="ghost" 
          onClick={() => {
            setShowOnboarding(false);
            fetchHotels();
          }}
          className="mb-4"
        >
          ← Back to Hotels
        </Button>
        <HotelOnboarding />
      </div>
    );
  }

  if (loading) {
    return <div className="p-8">Loading hotels...</div>;
  }

  return (
    <div className="space-y-6">
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>Data Isolation:</strong> Each hotel's data (rooms, assignments, tickets, PMS uploads) is completely isolated. 
          Creating a new hotel or organization will NOT affect existing data. All data is scoped by organization_slug and hotel_id.
        </AlertDescription>
      </Alert>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Hotel Management</h2>
          <p className="text-muted-foreground">Manage all hotels across organizations</p>
        </div>
        <Button onClick={() => setShowOnboarding(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add New Hotel
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {hotels.map((hotel) => (
          <Card key={hotel.id} className="p-6">
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Hotel className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{hotel.hotel_name}</h3>
                    <p className="text-sm text-muted-foreground">ID: {hotel.hotel_id}</p>
                  </div>
                </div>
                {hotel.is_active ? (
                  <Badge variant="default">Active</Badge>
                ) : (
                  <Badge variant="secondary">Inactive</Badge>
                )}
              </div>

              <div className="bg-muted p-3 rounded-lg">
                <p className="text-xs text-muted-foreground">Organization</p>
                <p className="text-sm font-medium">{hotel.organizations.name}</p>
                <p className="text-xs text-muted-foreground">/{hotel.organizations.slug}</p>
              </div>

              <div className="text-xs text-muted-foreground">
                Created: {new Date(hotel.created_at).toLocaleDateString()}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {hotels.length === 0 && (
        <div className="text-center py-12">
          <Hotel className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">No hotels yet. Add your first one!</p>
          <Button onClick={() => setShowOnboarding(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add First Hotel
          </Button>
        </div>
      )}
    </div>
  );
};
