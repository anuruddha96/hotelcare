import { supabase } from "@/integrations/supabase/client";

/** Build-time fail-closed gate. Enable only after the old cron has been retired
 * and both manual and automatic full refresh paths pass Previo parity tests. */
export const PMS_QUEUE_CLIENT_ENABLED = import.meta.env.VITE_PMS_REFRESH_QUEUE_ENABLED === "true";

export async function enqueueFullPmsRefresh(hotelId: string): Promise<string[]> {
  const { data:state,error:stateError } = await supabase.functions.invoke(
    "hotelcare-pms-refresh-queue", { body:{ mode:"state" } },
  );
  if (stateError || state?.enabled !== true) {
    throw new Error("PMS queue is unavailable. Refresh was not started to prevent overlapping Previo syncs.");
  }
  const { data:response,error } = await supabase.functions.invoke(
    "hotelcare-pms-refresh-queue", { body:{ mode:"enqueue",hotel_id:hotelId } },
  );
  if (error || response?.ok !== true || response?.queued !== true || !Array.isArray(response.jobs)) {
    throw new Error(response?.error || error?.message || "Could not queue PMS refresh");
  }
  const ids = response.jobs.map((j:{id?:string}) => String(j.id || "")).filter(Boolean);
  if (!ids.length) throw new Error("PMS queue did not return a job identifier");
  return ids;
}
