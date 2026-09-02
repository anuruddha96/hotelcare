import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

export type PMSHotelOption = {
  hotel_id: string;
  hotel_name: string;
};

const PORTFOLIO_ROLES = new Set(['admin', 'top_management', 'top_management_manager']);

export function usePMSHotelContext() {
  const { user, profile } = useAuth();
  const [hotels, setHotels] = useState<PMSHotelOption[]>([]);
  const [selectedHotelId, setSelectedHotelIdState] = useState<string | null>(null);
  const [loadingHotels, setLoadingHotels] = useState(true);

  const role = profile?.role || '';
  const canSelectProperty = PORTFOLIO_ROLES.has(role);
  const assignedHotel = profile?.assigned_hotel || null;
  const organizationSlug = profile?.organization_slug || null;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user || !organizationSlug) {
        if (!cancelled) {
          setHotels([]);
          setSelectedHotelIdState(null);
          setLoadingHotels(false);
        }
        return;
      }

      setLoadingHotels(true);
      const { data, error } = await (supabase as any)
        .from('hotel_configurations')
        .select('hotel_id, hotel_name, organizations!inner(slug)')
        .eq('organizations.slug', organizationSlug)
        .order('hotel_name');

      if (cancelled) return;
      const rows = !error && Array.isArray(data)
        ? data.map((row: any) => ({ hotel_id: row.hotel_id, hotel_name: row.hotel_name || row.hotel_id }))
        : [];
      setHotels(rows);

      if (!canSelectProperty) {
        const matched = rows.find((h) => h.hotel_id === assignedHotel || h.hotel_name === assignedHotel);
        setSelectedHotelIdState(matched?.hotel_id || assignedHotel || rows[0]?.hotel_id || null);
      } else {
        const key = `hotelcare:pms-property:${organizationSlug}`;
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
        const candidate = stored && rows.some((h) => h.hotel_id === stored)
          ? stored
          : rows.find((h) => h.hotel_id === assignedHotel || h.hotel_name === assignedHotel)?.hotel_id || rows[0]?.hotel_id || null;
        setSelectedHotelIdState(candidate);
      }
      setLoadingHotels(false);
    };
    load();
    return () => { cancelled = true; };
  }, [user, organizationSlug, assignedHotel, canSelectProperty]);

  const setSelectedHotelId = (hotelId: string) => {
    if (!canSelectProperty && hotelId !== selectedHotelId) return;
    setSelectedHotelIdState(hotelId);
    if (canSelectProperty && organizationSlug && typeof window !== 'undefined') {
      window.localStorage.setItem(`hotelcare:pms-property:${organizationSlug}`, hotelId);
    }
  };

  const selectedHotel = useMemo(
    () => hotels.find((h) => h.hotel_id === selectedHotelId) || null,
    [hotels, selectedHotelId],
  );

  return {
    hotels,
    selectedHotel,
    selectedHotelId,
    setSelectedHotelId,
    canSelectProperty,
    loadingHotels,
  };
}
