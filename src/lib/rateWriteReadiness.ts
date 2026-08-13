import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Can this property actually send prices to its PMS?
 *
 * Sending needs an active Previo profile WITH stored credentials — either a
 * classic single `pms_configurations` row, or (for merged properties like SLNT
 * Group) at least one `pms_accounts` row that carries a credentials secret.
 * Without that the push function rejects everything with "PMS is not
 * configured", after the user has already typed a season of prices.
 */
export interface RateWriteReadiness {
  /** null while still loading. */
  ready: boolean | null;
  reason: string;
}

export function useRateWriteReadiness(hotelId: string | null | undefined): RateWriteReadiness {
  const [state, setState] = useState<RateWriteReadiness>({ ready: null, reason: "" });

  useEffect(() => {
    if (!hotelId) { setState({ ready: null, reason: "" }); return; }
    let cancelled = false;
    void (async () => {
      const [{ data: cfg }, { data: accounts }] = await Promise.all([
        supabase.from("pms_configurations")
          .select("is_active, credentials_secret_name").eq("hotel_id", hotelId).maybeSingle(),
        supabase.from("pms_accounts")
          .select("is_active, credentials_secret_name, pms_hotel_id").eq("hotel_id", hotelId),
      ]);
      if (cancelled) return;

      // Previo issued HotelCare a single API login and the property is picked
      // by its Previo hotel id, so an active profile with a `pms_hotel_id` can
      // send prices even when no per-property secret name is stored.
      const accountReady = (accounts ?? []).some((a) => a.is_active && a.pms_hotel_id);
      const configReady = Boolean(cfg?.is_active);

      if (accountReady || configReady) { setState({ ready: true, reason: "" }); return; }

      setState({
        ready: false,
        reason: "Price sending is not set up for this property yet — no active PMS connection was found.",
      });

    })();
    return () => { cancelled = true; };
  }, [hotelId]);

  return state;
}
