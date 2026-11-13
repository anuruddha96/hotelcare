import { supabase } from "@/integrations/supabase/client";

export const NETWORK_MONITOR_STORAGE_KEY = "hotelcare-network-monitor-v1";
export const NETWORK_MONITOR_CHANGED = "hotelcare:network-monitor-updated";
export type LocalNetworkMonitor = {
  id: string;
  token: string;
  organizationSlug: string;
  hotelId: string;
  label: string;
};

export function readLocalNetworkMonitor(): LocalNetworkMonitor | null {
  try {
    const raw = window.localStorage.getItem(NETWORK_MONITOR_STORAGE_KEY);
    if (!raw) return null;
    const value: LocalNetworkMonitor = JSON.parse(raw);
    if (!value?.id || !value?.token || !value?.hotelId || !value?.organizationSlug) return null;
    return value;
  } catch {
    return null;
  }
}

export function saveLocalNetworkMonitor(value: LocalNetworkMonitor | null) {
  if (value) window.localStorage.setItem(NETWORK_MONITOR_STORAGE_KEY, JSON.stringify(value));
  else window.localStorage.removeItem(NETWORK_MONITOR_STORAGE_KEY);
  window.dispatchEvent(new Event(NETWORK_MONITOR_CHANGED));
}

export function makeDeviceToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)),
    (value) => value.toString(16).padStart(2, "0")).join("");
}

/** Cloud request deliberately has no user-session dependency. The high-entropy
 * device token can only update the registration's last heartbeat. */
export async function sendNetworkHeartbeat(): Promise<boolean> {
  const monitor = readLocalNetworkMonitor();
  if (!monitor) return false;
  try {
    const { data, error } = await supabase.functions.invoke("network-monitor", {
      body: { action: "heartbeat", monitor_id: monitor.id, token: monitor.token },
    });
    return !error && data?.ok === true;
  } catch {
    // Offline or asleep? Do not remove registration: the cloud watchdog will
    // detect lost heartbeats independently of this browser.
    return false;
  }
}
