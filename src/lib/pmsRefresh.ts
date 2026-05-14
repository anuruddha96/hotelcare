// Shared PMS refresh routine used by both the manual PmsRefreshButton and
// the LiveSync auto-sync on login. Pulls today's snapshot from Previo and
// updates only PMS-derived fields on `rooms` — never touches assignments.

import { supabase } from "@/integrations/supabase/client";
import { resolveHotelKeys } from "@/lib/hotelKeys";

export type PmsSyncStatus = "success" | "partial" | "error" | "idle";

export interface PmsSyncResult {
  status: PmsSyncStatus;
  updated: number;
  total: number;
  notFound: number;
  checkouts: number;
  errors: string[];
}

const extractRoomNumber = (raw: string): string => {
  const m = String(raw).match(/\d+/);
  return m ? m[0] : String(raw).trim();
};

const excelTimeToString = (val: any): string | null => {
  if (val === null || val === undefined || val === "") return null;
  const s = String(val).trim();
  return s.length > 0 ? s : null;
};

const parseNightTotal = (val: any): { currentNight: number; totalNights: number } | null => {
  if (!val) return null;
  const m = String(val).match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  return { currentNight: parseInt(m[1], 10), totalNights: parseInt(m[2], 10) };
};

export async function runPmsRefresh(hotelId: string): Promise<PmsSyncResult> {
  // Step 1 — sync rooms catalog (non-fatal).
  try {
    await supabase.functions.invoke("previo-sync-rooms", {
      body: { hotelId, importLocal: true },
    });
  } catch (e) {
    console.warn("[pmsRefresh] catalog sync warning:", e);
  }

  // Step 2 — pull today's PMS snapshot.
  const { data, error } = await supabase.functions.invoke("previo-pms-sync", {
    body: { hotelId },
  });
  if (error || (data && (data as any).ok === false)) {
    throw new Error((data as any)?.error || error?.message || "PMS sync failed");
  }
  const rows: any[] = (data as any)?.rows || [];
  if (rows.length === 0) {
    return { status: "success", updated: 0, total: 0, notFound: 0, checkouts: 0, errors: [] };
  }

  const keys = await resolveHotelKeys(hotelId);
  const hotelKeys = keys.length ? keys : [hotelId];

  let updated = 0;
  let notFound = 0;
  let checkouts = 0;
  const errors: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  for (const row of rows) {
    try {
      const rawRoomName = String(row.Room ?? "").trim();
      if (!rawRoomName) continue;
      const roomNumber = extractRoomNumber(rawRoomName);

      const lookup = async (matcher: (q: any) => any) => {
        const q = supabase.from("rooms").select("id, room_number").in("hotel", hotelKeys);
        return await matcher(q);
      };

      let { data: rooms } = await lookup((q) => q.eq("room_number", rawRoomName));
      if ((!rooms || rooms.length === 0) && rawRoomName !== roomNumber) {
        ({ data: rooms } = await lookup((q) => q.ilike("room_number", rawRoomName)));
      }
      if ((!rooms || rooms.length === 0) && roomNumber && roomNumber !== rawRoomName) {
        ({ data: rooms } = await lookup((q) => q.eq("room_number", roomNumber)));
      }
      if (!rooms || rooms.length === 0) {
        notFound++;
        continue;
      }
      const room = rooms[0];

      const departureParsed = excelTimeToString(row.Departure);
      const isCheckout = departureParsed !== null;

      const nightTotal = parseNightTotal(row["Night / Total"]);
      let guestNightsStayed = 0;
      let towel = false;
      let linen = false;
      if (nightTotal) {
        guestNightsStayed = nightTotal.currentNight;
        if (guestNightsStayed >= 3) {
          const cyc = (guestNightsStayed - 3) % 4;
          if (cyc === 0) towel = true;
          else if (cyc === 2) linen = true;
        }
      }

      const updateData: Record<string, any> = {
        is_checkout_room: isCheckout,
        checkout_time: isCheckout ? new Date().toISOString() : null,
        guest_count: row.People ?? 0,
        guest_nights_stayed: guestNightsStayed,
        towel_change_required: towel,
        linen_change_required: linen,
        updated_at: new Date().toISOString(),
      };
      if (towel) updateData.last_towel_change = today;
      if (linen) updateData.last_linen_change = today;
      if (row.Note) updateData.notes = String(row.Note);

      const { error: updErr } = await supabase
        .from("rooms")
        .update(updateData)
        .eq("id", room.id);
      if (updErr) {
        errors.push(`Room ${rawRoomName}: ${updErr.message}`);
      } else {
        updated++;
        if (isCheckout) checkouts++;
      }
    } catch (e: any) {
      errors.push(`Row error: ${e?.message || String(e)}`);
    }
  }

  const status: PmsSyncStatus = errors.length ? "partial" : "success";

  // Log sync history (non-fatal).
  try {
    await supabase.from("pms_sync_history").insert({
      hotel_id: hotelId,
      sync_type: "rooms_refresh",
      sync_status: status,
      error_message: errors.length ? errors.slice(0, 5).join(" | ") : null,
      data: { updated, notFound, total: rows.length, checkouts },
    } as any);
  } catch {
    /* non-fatal */
  }

  return { status, updated, total: rows.length, notFound, checkouts, errors };
}
