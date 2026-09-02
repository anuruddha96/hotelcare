import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { resolveHotelKeys } from "@/lib/hotelKeys";

/** Roles allowed to see portfolio (org-wide) PMS data when no property is selected. */
const PORTFOLIO_ROLES = ["admin", "top_management", "top_management_manager"];

/** Roles allowed to trigger a Previo reservation sync. */
const SYNC_ROLES = [
  "admin",
  "manager",
  "reception",
  "front_office",
  "top_management",
  "top_management_manager",
];

export interface OperationalHotel {
  /** The tab-scoped selected property (profiles.assigned_hotel). */
  hotelId: string | null;
  /** All key variants (slug + display name) the data tables may use. */
  hotelKeys: string[];
  /** True when an executive/admin is browsing without a property selected. */
  isPortfolio: boolean;
  orgSlug: string | null;
  role: string | null;
  canSync: boolean;
  ready: boolean;
}

/**
 * Central property context for PMS surfaces. Operational roles are always
 * pinned to their assigned hotel; executives/admins use the tab-selected
 * property and may fall back to portfolio (org-wide) when none is selected.
 */
export function useOperationalHotel(): OperationalHotel {
  const { profile } = useAuth();
  const hotelId = profile?.assigned_hotel ?? null;
  const role = profile?.role ?? null;
  const [hotelKeys, setHotelKeys] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setReady(false);
    if (!hotelId) {
      setHotelKeys([]);
      setReady(true);
      return;
    }
    resolveHotelKeys(hotelId)
      .then((keys) => {
        if (!alive) return;
        setHotelKeys(keys.length ? keys : [hotelId]);
        setReady(true);
      })
      .catch(() => {
        if (!alive) return;
        setHotelKeys([hotelId]);
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [hotelId]);

  return useMemo(
    () => ({
      hotelId,
      hotelKeys,
      isPortfolio: !hotelId && !!role && PORTFOLIO_ROLES.includes(role),
      orgSlug: profile?.organization_slug ?? null,
      role,
      canSync: !!role && SYNC_ROLES.includes(role),
      ready,
    }),
    [hotelId, hotelKeys, role, profile?.organization_slug, ready],
  );
}
