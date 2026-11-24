import { useEffect, useState } from 'react';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@/components/ui/breadcrumb';
import { useTenant } from '@/contexts/TenantContext';
import { useAccessPolicy } from '@/hooks/useAccessPolicy';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';

/** Title and breadcrumb styled to match the Housekeeping dashboard heading. */
export function OperationalPageHeading({ section }: { section: string }) {
  const { profile } = useAuth();
  const { hrWorkspace } = useAccessPolicy();
  const { organization } = useTenant();
  const { t } = useTranslation();
  const [hotelDisplayName, setHotelDisplayName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const hotelId = profile?.assigned_hotel;
    if (!hotelId) {
      setHotelDisplayName(null);
      return;
    }
    setHotelDisplayName(hotelId);
    void (async () => {
      const { data } = await supabase
        .from('hotel_configurations')
        .select('hotel_name')
        .eq('hotel_id', hotelId)
        .limit(1);
      if (active) setHotelDisplayName(data?.[0]?.hotel_name || hotelId);
    })();
    return () => { active = false; };
  }, [profile?.assigned_hotel]);

  return (
    <>
      <div className="mb-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage className="text-xs text-primary font-medium">{section}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{hrWorkspace ? t('hr.heading') : hotelDisplayName || t('dashboard.title')}</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          {hrWorkspace ? organization?.name || profile?.organization_slug : hotelDisplayName ? t('dashboard.managementSystem').replace('{hotel}', hotelDisplayName) : t('dashboard.subtitle')}
        </p>
      </div>
    </>
  );
}
