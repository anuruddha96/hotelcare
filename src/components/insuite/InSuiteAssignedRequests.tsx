import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, BellRing, CheckCheck, Clock3 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { inSuiteStaff, type InSuiteRequest } from "@/lib/insuiteApi";

const open = (s: string) => !["completed", "unavailable", "cancelled"].includes(s);
const follow: Record<string, string[]> = {
  submitted: ["accepted", "unavailable"],
  accepted: ["in_progress", "completed", "unavailable"],
  in_progress: ["completed", "unavailable"],
};

/**
 * Separate urgent guest delivery work, never changes room cleanliness or existing
 * room_assignments. Server only exposes items assigned to the signed-in cleaner.
 */
export function InSuiteAssignedRequests() {
  const { profile, user } = useAuth();
  const [items, setItems] = useState<InSuiteRequest[]>([]);
  const [roomLabels, setRoomLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const seen = useRef<Set<string> | null>(null);
  const hotelId = profile?.assigned_hotel || "";
  const org = profile?.organization_slug || "";

  const load = useCallback(async () => {
    if (!hotelId || !org || !user || profile?.role !== "housekeeping") return;
    try {
      const result = await inSuiteStaff("staff-dashboard", hotelId);
      const list = (result.requests || []).filter((r: InSuiteRequest) => open(r.status) && r.assigned_to === user.id);
      const next = new Set<string>(list.map((r: InSuiteRequest) => r.id));
      if (seen.current) {
        const added = list.find((r: InSuiteRequest) => !seen.current!.has(r.id));
        if (added) toast.info(`Room ${result.room_labels?.[added.room_id] || "?"}: new guest request`);
      }
      seen.current = next;
      setItems(list); setRoomLabels(result.room_labels || {});
    } catch {
      // Feature may not yet be deployed; leave existing housekeeping screen intact.
    }
  }, [hotelId, org, user?.id, profile?.role]);

  useEffect(() => {
    if (profile?.role !== "housekeeping") return;
    seen.current = null; setItems([]);
    void load();
    const interval = window.setInterval(() => { if (!document.hidden) void load(); }, 15000);
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [load, profile?.role]);

  const update = async (id: string, status: string) => {
    setBusy(id);
    try {
      await inSuiteStaff("staff-update-request", hotelId, { request_id: id, status });
      toast.success("Guest request updated");
      await load();
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(""); }
  };

  if (!items.length) return null;
  return <section className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-3 sm:p-4 space-y-3"
    aria-label="Priority guest requests">
    <div className="flex items-center justify-between gap-2">
      <h2 className="font-bold flex items-center gap-2 text-amber-950">
        <BellRing className="w-5 h-5" /> PRIORITY · Guest room requests
      </h2>
      <Link className="text-xs underline" to={`/${org}/insuite`}>Open all requests</Link>
    </div>
    {items.map((r) => <article key={r.id} className="rounded-xl bg-white border p-3 space-y-2">
      <div className="flex flex-wrap gap-2 items-start justify-between">
        <div><strong>Room {roomLabels[r.room_id || ""] || "?"} · {r.request_type.replaceAll("_", " ")}</strong>
          <p className="text-sm">{r.quantity} item(s){r.detail ? ` · ${r.detail}` : ""}</p>
          <p className="text-xs text-slate-500 flex items-center gap-1"><Clock3 className="w-3 h-3" /> {new Date(r.created_at).toLocaleTimeString()}</p></div>
        <span className="text-xs rounded-full bg-amber-100 px-2 py-1">{r.status}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {(follow[r.status] || []).map((s) => <button key={s} disabled={busy === r.id}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${s === "completed" ? "bg-emerald-700 text-white" : "border bg-white"}`}
          onClick={() => void update(r.id, s)}>
          {s === "completed" ? <CheckCheck className="h-4 w-4 inline mr-1" /> : s === "unavailable" ? <AlertCircle className="h-4 w-4 inline mr-1" /> : null}
          {s.replaceAll("_", " ")}</button>)}
      </div>
    </article>)}
  </section>;
}
