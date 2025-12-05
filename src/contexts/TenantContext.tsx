import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Organization {
  id: string;
  name: string;
  slug: string;
  settings: any;
  is_active: boolean;
}

interface HotelConfig {
  id: string;
  hotel_name: string;
  hotel_id: string;
  organization_id: string;
  settings: any;
  is_active: boolean;
}

interface TenantContextType {
  organization: Organization | null;
  hotels: HotelConfig[];
  loading: boolean;
  error: string | null;
  refreshTenant: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider: React.FC<{ 
  children: React.ReactNode;
  organizationSlug: string;
}> = ({ children, organizationSlug }) => {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [hotels, setHotels] = useState<HotelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTenantData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Try to fetch organization - may fail for managers due to RLS
      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('slug', organizationSlug)
        .eq('is_active', true)
        .single();

      if (orgError) {
        console.log('Could not fetch organization directly, using RPC function');
        
        // Use the secure RPC function to get hotels for user's organization
        const { data: hotelsData, error: hotelsError } = await supabase
          .rpc('get_user_organization_hotels');

        if (!hotelsError && hotelsData) {
          setHotels(hotelsData as HotelConfig[]);
        }
        
        setLoading(false);
        return;
      }

      setOrganization(orgData);

      // Fetch hotels for this organization
      const { data: hotelsData, error: hotelsError } = await supabase
        .from('hotel_configurations')
        .select('*')
        .eq('organization_id', orgData.id)
        .eq('is_active', true)
        .order('hotel_name');

      if (hotelsError) {
        console.error('Error fetching hotels:', hotelsError);
        setError(hotelsError.message);
      } else {
        setHotels(hotelsData || []);
      }

      setLoading(false);
    } catch (err) {
      console.error('Error in fetchTenantData:', err);
      setError('Failed to load organization data');
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenantData();
  }, [organizationSlug]);

  const refreshTenant = async () => {
    await fetchTenantData();
  };

  return (
    <TenantContext.Provider value={{ organization, hotels, loading, error, refreshTenant }}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};
