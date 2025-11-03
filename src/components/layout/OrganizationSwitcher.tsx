import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { Building, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface Organization {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

export function OrganizationSwitcher() {
  const { profile } = useAuth();
  const { organization } = useTenant();
  const navigate = useNavigate();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOrganizations();
  }, []);

  const fetchOrganizations = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, slug, is_active')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setOrganizations(data || []);
    } catch (error) {
      console.error('Error fetching organizations:', error);
    } finally {
      setLoading(false);
    }
  };

  // Only show for super admin and admin roles
  if (!profile || !['admin'].includes(profile.role) && !profile.is_super_admin) {
    return null;
  }

  // Only show if there are multiple organizations
  if (!loading && organizations.length <= 1) {
    return null;
  }

  const handleSwitchOrganization = async (slug: string) => {
    try {
      const selectedOrg = organizations.find(o => o.slug === slug);
      
      // Update user's organization in profile - set both slug and ID
      const { error } = await supabase
        .from('profiles')
        .update({ 
          organization_slug: slug, 
          organization_id: selectedOrg?.id,
          assigned_hotel: null 
        })
        .eq('id', profile.id);

      if (error) throw error;

      toast.success(`Switched to ${selectedOrg?.name || slug}`);
      
      // Navigate to the new organization
      navigate(`/${slug}`);
      
      // Reload to refresh all data for the new organization
      window.location.reload();
    } catch (error: any) {
      toast.error('Failed to switch organization');
      console.error(error);
    }
  };

  const currentOrgName = organization?.name || 'Organization';

  if (loading) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Building className="h-4 w-4" />
          <span className="hidden sm:inline">{currentOrgName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Switch Organization</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.id}
            onClick={() => handleSwitchOrganization(org.slug)}
            className="cursor-pointer"
          >
            <div className="flex items-center justify-between w-full">
              <span>{org.name}</span>
              {organization?.slug === org.slug && (
                <Check className="h-4 w-4 text-primary" />
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
