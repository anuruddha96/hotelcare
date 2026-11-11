import { supabase } from "@/integrations/supabase/client";

const base = import.meta.env.VITE_SUPABASE_URL
  || (import.meta.env.VITE_SUPABASE_PROJECT_ID
    ? `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : "");

export const INSUITE_DEVICE_KEY = "hotelcare:insuite:device-token";

export type InSuiteContent = {
  hotel_name?: string; welcome?: string; address?: string; reception_phone?: string;
  guest_wifi_ssid?: string; guest_wifi_password?: string; checkout_time?: string;
  breakfast_hours?: string; restaurant_hours?: string; contact_email?: string;
  logo_url?: string; hero_url?: string; primary_color?: string;
  house_rules?: string; transport_info?: string; facilities_info?: string;
  minibar_info?: string; sustainability_info?: string;
  services?: Record<string, boolean>;
};
export type InSuiteRequest = {
  id: string; client_request_id: string; room_id?: string;
  request_type: string; quantity: number; detail?: string; priority?: string; department?: string;
  status: string; assigned_to?: string | null; created_at: string; updated_at?: string;
};
export type InSuiteMessage = {
  id: string; room_id?: string; device_id?: string; sender: "guest" | "reception";
  body: string; created_at: string;
};

async function call(action: string, body: Record<string, unknown>, headers: Record<string, string>) {
  if (!base) throw Error("HotelCare server is not configured");
  const res = await fetch(`${base}/functions/v1/insuite-api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ action, ...body }),
    cache: "no-store",
  });
  let data: any;
  try { data = await res.json(); } catch { throw Error("HotelCare could not read the response"); }
  if (!res.ok) throw Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export async function inSuiteGuest(action: string, body: Record<string, unknown> = {}, token?: string) {
  const t = token || localStorage.getItem(INSUITE_DEVICE_KEY);
  if (!t && action !== "pair") throw Error("Tablet not paired");
  return call(action, body, t ? { "x-insuite-device": t } : {});
}
export async function inSuiteStaff(action: string, hotelId: string, body: Record<string, unknown> = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw Error("Staff sign-in required");
  return call(action, { hotel_id: hotelId, ...body }, {
    Authorization: `Bearer ${data.session.access_token}`,
  });
}
