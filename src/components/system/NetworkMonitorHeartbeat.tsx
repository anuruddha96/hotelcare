import { useEffect } from "react";
import { NETWORK_MONITOR_CHANGED, sendNetworkHeartbeat } from "@/lib/networkMonitorClient";

/** Runs outside the operational dashboard so monitoring remains active if
 * reception changes accounts or the user reaches the sign-in screen. */
export function NetworkMonitorHeartbeat() {
  useEffect(() => {
    const beat = () => { void sendNetworkHeartbeat(); };
    const onVisible = () => { if (document.visibilityState === "visible") beat(); };
    beat();
    const timer = window.setInterval(beat, 30_000);
    window.addEventListener("online", beat);
    window.addEventListener("focus", beat);
    window.addEventListener(NETWORK_MONITOR_CHANGED, beat);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", beat);
      window.removeEventListener("focus", beat);
      window.removeEventListener(NETWORK_MONITOR_CHANGED, beat);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
