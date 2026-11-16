import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/contexts/TenantContext";
import { Header } from "@/components/layout/Header";
import { OperationsNavigation } from "@/components/layout/OperationsNavigation";
import { toast } from "sonner";
import {
  BellRing, CheckCheck, ClipboardList, Hotel, MessageCircle, MonitorSmartphone,
  RefreshCw, Settings2, ShieldCheck, Wifi, LockKeyhole, Send, Copy,
  ImagePlus, CloudUpload, CheckCircle2, AlertCircle, Save,
} from "lucide-react";
import { inSuiteStaff, type InSuiteContent, type InSuiteRequest, type InSuiteMessage } from "@/lib/insuiteApi";
import {
  InSuiteCommerceConsole, type InSuiteCatalogItem, type InSuiteStaffOrder,
  type InSuiteOrderLine, type InSuiteStaffBooking,
} from "@/components/insuite/InSuiteCommerceConsole";
import { InSuiteRoomQrCodes } from "@/components/insuite/InSuiteRoomQrCodes";
import { prepareInSuiteImage } from "@/lib/insuiteImages";

type Device = {
  id: string; room_id: string; label: string; is_active: boolean;
  kind?: string;
  paired_at: string | null; last_seen_at: string | null;
  active_reservation_id?: string | null;
};
type Dashboard = {
  hotel_name: string;
  config: { draft?: InSuiteContent; published?: InSuiteContent; enabled?: boolean };
  rooms: { id: string; room_number: string }[];
  devices: Device[];
  requests: InSuiteRequest[];
  messages: InSuiteMessage[];
  alerts: { id: number; kind: string; title: string; body: string; room_id: string; created_at: string }[];
  eligible_staff: {id:string; name:string; role:string; acts_as_housekeeper:boolean; on_duty:boolean}[];
  catalog_items: InSuiteCatalogItem[];
  orders: InSuiteStaffOrder[]; order_lines: InSuiteOrderLine[];
  bookings: InSuiteStaffBooking[];
  room_labels: Record<string, string>;
  room_guest_labels?: Record<string, string>;
  can_manage: boolean; can_configure: boolean; can_reply: boolean; can_manage_orders: boolean;
};
const statuses: Record<string, string[]> = {
  submitted: ["accepted", "unavailable", "cancelled"],
  accepted: ["in_progress", "completed", "unavailable"],
  in_progress: ["completed", "unavailable"],
};
const labels: Record<string, string> = {
  extra_towels: "Extra towels", extra_pillow: "Extra pillows", blanket: "Blanket",
  amenities: "Amenities", water: "Drinking water", room_cleaning: "Room cleaning",
  maintenance: "Maintenance", taxi: "Taxi assistance", call_back: "Reception callback",
};
const services = [...Object.keys(labels), "breakfast","room_service","minibar","gym","spa","sauna","jacuzzi"];
const serviceNames: Record<string,string> = {
  ...labels, breakfast:"Breakfast ordering", room_service:"Room-service ordering",
  minibar:"Minibar / refreshment orders", gym:"Gym reservations",
  spa:"Spa reservations", sauna:"Sauna reservations", jacuzzi:"Jacuzzi reservations",
};
const defaults: InSuiteContent = {
  hotel_name: "", welcome: "", logo_url: "", hero_url: "", primary_color: "#153B57",
  address: "", reception_phone: "", guest_wifi_ssid: "", guest_wifi_password: "",
  breakfast_hours: "", restaurant_hours: "", checkout_time: "", house_rules: "",
  transport_info: "", facilities_info: "", minibar_info: "", sustainability_info: "",
  room_service_provider: "",
  contact_email: "", services: Object.fromEntries(services.map((key) => [key, false])),
};
// Jacuzzi reservations are physically available only at Hotel Memories Budapest;
// the server also refuses jacuzzi publication and bookings for other hotels.
const JACUZZI_HOTELS = new Set(["memories-budapest"]);
const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm";
const actionClass = "rounded-xl bg-slate-900 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-40";
const card = "rounded-2xl border bg-white p-4 sm:p-6 shadow-sm";

export default function InSuiteStaff() {
  const { user, profile, loading: authLoading } = useAuth();
  const { hotels, loading: tenantLoading } = useTenant();
  const { organizationSlug } = useParams();
  const [hotelId, setHotelId] = useState("");
  const [tab, setTab] = useState<"requests" | "chat" | "orders" | "bookings" | "menu" | "admin">("requests");
  const [data, setData] = useState<Dashboard | null>(null);
  const [draft, setDraft] = useState<InSuiteContent>(defaults);
  const [saveStatus, setSaveStatus] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [uploading, setUploading] = useState<"logo" | "hero" | null>(null);
  const savedSnapshotRef = useRef("");
  const latestDraftRef = useRef<InSuiteContent>(defaults);
  const currentHotelRef = useRef("");
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  latestDraftRef.current = draft;
  currentHotelRef.current = hotelId;
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState("");
  const [issued, setIssued] = useState<{ code: string; pin: string; room_number: string } | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [reply, setReply] = useState("");
  const previousRequests = useRef<Set<string> | null>(null);
  const previousMessages = useRef<Set<string> | null>(null);
  const previousAlerts = useRef<Set<number> | null>(null);

  // Follow the selected hotel in HotelCare's header (including Anu_000's
  // top_management_manager session), without promoting a role to super admin.
  // An explicit selection made inside this console remains until the global
  // active hotel actually changes.
  const previousPropertyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hotels.length) return;
    const activeProperty = profile?.assigned_hotel || null;
    const propertyChanged = previousPropertyRef.current !== null && previousPropertyRef.current !== activeProperty;
    if (!hotelId || propertyChanged || !hotels.some((h) => h.hotel_id === hotelId)) {
      const matched = hotels.find((h) => [h.hotel_id, h.hotel_name].includes(activeProperty || ""));
      setHotelId((matched || hotels[0]).hotel_id);
    }
    previousPropertyRef.current = activeProperty;
  }, [hotelId, hotels, profile?.assigned_hotel]);
  useEffect(() => {
    setData(null); setIssued(null); savedSnapshotRef.current = ""; setSaveStatus("saved");
    previousRequests.current = null; previousMessages.current = null; previousAlerts.current = null;
  }, [hotelId]);
  const load = useCallback(async (notify = false) => {
    if (!hotelId) return;
    if (!notify) setLoading(true);
    try {
      const current: Dashboard = await inSuiteStaff("staff-dashboard", hotelId);
      if (notify) {
        const nextReq = new Set(current.requests.map((r) => r.id));
        const nextMsg = new Set(current.messages.map((m) => m.id));
        const nextAlerts = new Set((current.alerts || []).map((a) => a.id));
        if (previousAlerts.current) {
          const alert = (current.alerts || []).find((a) => !previousAlerts.current!.has(a.id));
          if (alert) toast.info(`${alert.title}: ${alert.body}`, { duration: 9000 });
        }
        if (previousRequests.current) {
          const incoming = current.requests.find((r) => !previousRequests.current!.has(r.id));
          if (incoming) toast.info(`New room request · Room ${current.room_labels[incoming.room_id || ""] || "?"} · ${labels[incoming.request_type] || incoming.request_type}`);
        }
        if (previousMessages.current) {
          const incoming = current.messages.find((m) => m.sender === "guest" && !previousMessages.current!.has(m.id));
          if (incoming) toast.info(`Guest message · Room ${current.room_labels[incoming.room_id || ""] || "?"}`);
        }
        previousRequests.current = nextReq; previousMessages.current = nextMsg;
        previousAlerts.current = nextAlerts;
      } else {
        previousRequests.current = new Set(current.requests.map((r) => r.id));
        previousMessages.current = new Set(current.messages.map((m) => m.id));
        previousAlerts.current = new Set((current.alerts || []).map((a) => a.id));
      }
      setData(current);
      // Never replace local edits during the 15-second notification poll.
      if (!notify) {
        const next = { ...defaults, ...(current.config.draft || {}),
          hotel_name: current.config.draft?.hotel_name || current.hotel_name };
        savedSnapshotRef.current = JSON.stringify(next);
        latestDraftRef.current = next;
        setDraft(next);
        setSaveStatus("saved");
      }
    } catch (err) {
      if (!notify) toast.error((err as Error).message);
    } finally { if (!notify) setLoading(false); }
  }, [hotelId]);

  useEffect(() => {
    if (!hotelId || !user) return;
    void load();
    const id = window.setInterval(() => { if (!document.hidden) void load(true); }, 15000);
    const visibility = () => { if (!document.hidden) void load(true); };
    document.addEventListener("visibilitychange", visibility);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", visibility); };
  }, [hotelId, user?.id, load]);


  /** Serialize writes so a slow network request cannot overwrite a newer draft. */
  const saveDraft = useCallback(async (value: InSuiteContent, propertyId: string) => {
    const snapshot = JSON.stringify(value);
    const operation = saveQueueRef.current.catch(() => undefined).then(
      () => inSuiteStaff("staff-save-draft", propertyId, { draft: value }));
    saveQueueRef.current = operation.catch(() => undefined);
    if (currentHotelRef.current === propertyId) setSaveStatus("saving");
    try {
      await operation;
      if (currentHotelRef.current === propertyId) {
        savedSnapshotRef.current = snapshot;
        setSaveStatus(JSON.stringify(latestDraftRef.current) === snapshot ? "saved" : "dirty");
      }
      return true;
    } catch (err) {
      if (currentHotelRef.current === propertyId) setSaveStatus("error");
      toast.error("In-Suite draft could not be saved: " + (err as Error).message);
      return false;
    }
  }, []);

  // Save each edited property field and service toggle after a short idle.
  // Draft changes are separate from the manager-controlled Publish action.
  useEffect(() => {
    if (!hotelId || !data?.can_configure || JSON.stringify(draft) === savedSnapshotRef.current) return;
    setSaveStatus("dirty");
    const pending = window.setTimeout(() => { void saveDraft(draft, hotelId); }, 900);
    return () => window.clearTimeout(pending);
  }, [draft, hotelId, data?.can_configure, saveDraft]);

  const uploadPropertyImage = async (kind: "logo" | "hero", file: File | undefined) => {
    if (!file || !hotelId || !data?.can_configure) return;
    setUploading(kind);
    try {
      const image_data = await prepareInSuiteImage(file, kind);
      const response = await inSuiteStaff("staff-upload-image", hotelId, { kind, image_data });
      setDraft((old) => ({ ...old, [kind === "logo" ? "logo_url" : "hero_url"]: response.url }));
      toast.success("Optimized image uploaded. The change will be saved to your draft.");
    } catch (err) {
      toast.error("Image upload failed: " + (err as Error).message);
    } finally { setUploading(null); }
  };

  const imageField = (kind: "logo" | "hero", title: string) => {
    const key = kind === "logo" ? "logo_url" : "hero_url";
    const url = String(draft[key] || "");
    return <div className="space-y-2">
      <div className="text-sm font-semibold">{title}</div>
      <label className="block rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-4 text-center
        cursor-pointer hover:border-sky-400 focus-within:ring-2 focus-within:ring-sky-300"
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
        onDrop={(e) => { e.preventDefault(); void uploadPropertyImage(kind, e.dataTransfer.files?.[0]); }}>
        <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="sr-only" aria-label={`Upload ${title.toLowerCase()}`}
          onChange={(e) => { void uploadPropertyImage(kind, e.target.files?.[0]); e.target.value = ""; }} />
        {url && <img src={url} alt={kind === "logo" ? "Current hotel logo" : "Current welcome photo"}
          className={`mx-auto mb-3 max-w-full rounded-lg object-contain ${kind === "logo" ? "max-h-28" : "max-h-48"}`} />}
        {uploading === kind ? <span className="text-sm">Compressing and uploading image…</span> :
          <span className="inline-flex items-center gap-2 text-sm text-slate-700">
            <CloudUpload className="h-4 w-4" /> Drag an image here or click to upload
          </span>}
        <p className="mt-1 text-xs text-slate-500">
          Converted to WebP before upload · maximum 550 KB stored · no original file sent
        </p>
      </label>
      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer">Or use an existing HTTPS image URL</summary>
        <input className={inputClass + " mt-2"} aria-label={title + " URL"} value={url}
          placeholder="https://…" onChange={(e) => setDraft((old) => ({ ...old, [key]: e.target.value }))} />
      </details>
    </div>;
  };

  const execute = async (action: string, payload: Record<string, unknown>, success: string) => {
    setBusy(true);
    try {
      const result = await inSuiteStaff(action, hotelId, payload);
      toast.success(success);
      await load();
      return result;
    } catch (err) {
      toast.error((err as Error).message);
      return null;
    } finally { setBusy(false); }
  };
  const field = (key: keyof InSuiteContent, title: string, multiline = false) => {
    const value = String(draft[key] || "");
    return <label className="block space-y-1.5"><span className="text-sm font-semibold">{title}</span>
      {multiline ? <textarea value={value} rows={3} onChange={(e) => setDraft((old) => ({ ...old, [key]: e.target.value }))}
        className={inputClass} /> :
        <input value={value} onChange={(e) => setDraft((old) => ({ ...old, [key]: e.target.value }))}
          className={inputClass} />}
    </label>;
  };
  const roomLabel = (roomId?: string) => data?.room_labels[roomId || ""]
    || data?.rooms.find((r) => r.id === roomId)?.room_number || "?";
  const activeRequests = useMemo(() => [...(data?.requests || [])].sort((a, b) => {
    const pending = (v: InSuiteRequest) => ["completed", "unavailable", "cancelled"].includes(v.status) ? 1 : 0;
    return pending(a) - pending(b) || Date.parse(b.created_at) - Date.parse(a.created_at);
  }), [data?.requests]);
  const byDevice = useMemo(() => {
    const m = new Map<string, InSuiteMessage[]>();
    for (const item of data?.messages || []) {
      if (!item.device_id) continue;
      m.set(item.device_id, [...(m.get(item.device_id) || []), item]);
    }
    return [...m.entries()].sort((a, b) => Date.parse(b[1][0]?.created_at || "") - Date.parse(a[1][0]?.created_at || ""));
  }, [data?.messages]);
  const selectedMessages = (byDevice.find(([id]) => id === deviceId)?.[1] || [])
    .slice().reverse();

  if (authLoading || tenantLoading) return <div className="p-8">Loading In-Suite…</div>;
  if (!user || !profile) return <Navigate to={`/${organizationSlug || "rdhotels"}/auth`} replace />;

  return <div className="min-h-screen bg-slate-50">
    <Header />
    <main className="container mx-auto p-4 lg:p-8 space-y-6 max-w-7xl">
      <OperationsNavigation current="insuite" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">HotelCare · Guest experience</p>
          <h1 className="text-3xl font-bold">In-Suite Console</h1>
          <p className="text-sm text-slate-500">Service requests, reception, staff alerts, food orders and reservations.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className={inputClass} aria-label="Select hotel" value={hotelId}
            onChange={(e) => setHotelId(e.target.value)}>
            {hotels.map((h) => <option key={h.id} value={h.hotel_id}>{h.hotel_name}</option>)}
          </select>
          <button aria-label="Refresh" onClick={() => void load()} className="border rounded-xl p-3"><RefreshCw className="h-5 w-5" /></button>
        </div>
      </div>
      <div className="flex gap-2 border-b overflow-x-auto pb-2">
        {[
          { id: "requests", name: "Guest requests", Icon: ClipboardList },
          { id: "chat", name: "Reception messages", Icon: MessageCircle },
          { id: "orders", name: "Room orders", Icon: ClipboardList },
          { id: "bookings", name: "Facility & taxi", Icon: Hotel },
          { id: "menu", name: "Menus", Icon: Settings2 },
          { id: "admin", name: "Tablet & content setup", Icon: Settings2 },
        ].map((t) => <button key={t.id}
          onClick={() => setTab(t.id as typeof tab)} className={`rounded-xl px-4 py-3 flex gap-2 items-center shrink-0 ${tab === t.id ? "bg-slate-900 text-white" : "bg-white border"}`}>
          <t.Icon className="h-4 w-4" /> {t.name}
        </button>)}
      </div>
      {!hotelId && <p>Select a hotel to begin.</p>}
      {data && data.alerts?.length > 0 && <section className={card + " space-y-3 border-l-4 border-l-amber-400"}>
        <div className="flex gap-2 items-center">
          <BellRing className="h-5 w-5 text-amber-700" />
          <h2 className="font-semibold">Unread guest-service alerts ({data.alerts.length})</h2>
        </div>
        <div className="grid md:grid-cols-2 gap-2">
          {data.alerts.slice(0, 10).map((alert) => <div key={alert.id}
            className="rounded-xl bg-amber-50 border border-amber-100 p-3 flex gap-2 items-start justify-between">
            <div><strong className="text-sm">{alert.title}</strong>
              <p className="text-xs text-slate-600">{alert.body}</p>
              {data.room_guest_labels?.[alert.room_id] &&
                <p className="text-xs text-slate-500">Current guest: {data.room_guest_labels[alert.room_id]}</p>}
            </div>
            <button disabled={busy} className="rounded-lg border bg-white px-3 py-2 text-xs shrink-0"
              onClick={() => void execute("staff-ack-alert",{alert_id:alert.id},"Alert acknowledged")}>
              Acknowledge</button>
          </div>)}
        </div>
        <p className="text-xs text-slate-500">Alerts are stored until acknowledged, including when browser notifications are disabled.</p>
      </section>}
      {loading && <p>Loading property service information…</p>}
      {!loading && data && tab === "requests" && <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Service queue</h2>
          <span className="text-sm text-slate-500">{activeRequests.filter((r) => !["completed", "cancelled", "unavailable"].includes(r.status)).length} open</span>
        </div>
        {!activeRequests.length && <div className={card}>No guest tablet requests for this hotel.</div>}
        {activeRequests.map((r) => <article key={r.id} className={card + " space-y-3"}>
          <div className="flex items-start justify-between gap-4">
            <div><div className="flex gap-2 items-center"><BellRing className="h-5 w-5 text-amber-600" />
              <h3 className="text-lg font-bold">Room {roomLabel(r.room_id)} · {labels[r.request_type] || r.request_type}</h3></div>
              <p className="text-sm text-slate-500">{r.quantity} × · {r.department || "Service"} · {new Date(r.created_at).toLocaleString()}</p>
              {r.detail && <p className="mt-2 whitespace-pre-wrap">{r.detail}</p>}
              {data.room_guest_labels?.[r.room_id || ""] &&
                <p className="text-sm text-slate-500">Verified in-house guest: {data.room_guest_labels[r.room_id || ""]}</p>}
              </div>
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${r.status === "completed" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>{r.status}</span>
          </div>
          {r.assigned_to ? <p className="text-sm text-slate-600">Assigned to: {data.eligible_staff?.find((p) => p.id === r.assigned_to)?.name || r.assigned_to.slice(0,8) + "…"}</p>
            : <p className="text-sm font-medium text-amber-700">Unassigned — manager or reception must route this request.</p>}
          {data.can_reply && !["completed","cancelled","unavailable"].includes(r.status) &&
            <label className="block text-sm font-semibold space-y-1 max-w-md">
              <span>Assign to an on-duty employee</span>
              <select key={r.id + ":" + (r.assigned_to || "")} className={inputClass}
                value={r.assigned_to || ""} disabled={busy}
                onChange={(e) => { if (e.target.value) void execute("staff-assign-request",
                  {request_id:r.id,assigned_to:e.target.value},"Guest request assigned"); }}>
                <option value="">Select an employee</option>
                {(data.eligible_staff || []).filter((p) => p.on_duty &&
                  (r.department === "housekeeping"
                    ? p.role === "housekeeping" || p.acts_as_housekeeper
                    : r.department === "maintenance"
                      ? ["maintenance","maintenance_manager"].includes(p.role)
                      : ["reception","front_office","reception_manager"].includes(p.role))
                ).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}
              </select>
            </label>}
          <div className="flex flex-wrap gap-2">
            {(statuses[r.status] || []).map((status) => <button key={status} disabled={busy}
              className={status === "completed" ? "rounded-xl bg-emerald-700 px-4 py-2 text-white" : "rounded-xl border px-4 py-2"}
              onClick={() => void execute("staff-update-request", { request_id: r.id, status }, `Request marked ${status}`)}>
              {status === "completed" && <CheckCheck className="h-4 w-4 inline mr-1" />}{status.replace("_", " ")}
            </button>)}
          </div>
        </article>)}
      </div>}

      {!loading && data && (tab === "orders" || tab === "bookings" || tab === "menu") &&
        <InSuiteCommerceConsole mode={tab} hotelId={hotelId}
          catalogItems={data.catalog_items || []} orders={data.orders || []}
          orderLines={data.order_lines || []} bookings={data.bookings || []}
          roomLabels={data.room_labels || {}} canConfigure={data.can_configure}
          canReply={data.can_reply} canManageOrders={data.can_manage_orders}
          onRefresh={async () => { await load(); }} />}
      {!loading && data && tab === "chat" && <div className="grid lg:grid-cols-[300px_1fr] gap-4">
        <section className={card + " space-y-3"}>
          <h2 className="font-semibold text-lg">Guest conversations</h2>
          {!byDevice.length && <p className="text-sm text-slate-500">No messages yet.</p>}
          {byDevice.map(([id, items]) => <button key={id} onClick={() => setDeviceId(id)}
            className={`w-full rounded-xl p-3 border text-left ${deviceId === id ? "bg-blue-50 border-blue-400" : "bg-white"}`}>
            <strong>Room {roomLabel(items[0].room_id)}</strong>
            <p className="text-sm text-slate-500 truncate">{items[0].sender === "guest" ? "Guest: " : "Reception: "}{items[0].body}</p>
          </button>)}
        </section>
        <section className={card + " flex flex-col gap-3 min-h-96"}>
          {deviceId && selectedMessages.length ? <>
            <h2 className="font-semibold">Room {roomLabel(selectedMessages[0].room_id)}
              {data.room_guest_labels?.[selectedMessages[0].room_id || ""] &&
                <span className="ml-2 text-sm text-slate-500">· {data.room_guest_labels[selectedMessages[0].room_id || ""]}</span>}
            </h2>
            <div className="flex-1 space-y-3 max-h-[55vh] overflow-y-auto">
              {selectedMessages.map((m) => <div key={m.id}
                className={`rounded-xl p-3 max-w-[85%] ${m.sender === "reception" ? "ml-auto bg-blue-100" : "bg-slate-100"}`}>
                <p className="text-xs font-semibold">{m.sender === "guest" ? "Guest" : "Reception"} · {new Date(m.created_at).toLocaleTimeString()}</p>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </div>)}
            </div>
            <div className="flex gap-2"><input className={inputClass} maxLength={1000}
              value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to room"
              onKeyDown={(e) => { if (e.key === "Enter" && reply.trim()) {
                void execute("staff-reply", { device_id: deviceId, message: reply }, "Reply sent").then((v) => { if (v) setReply(""); });
              } }} />
              <button disabled={!reply.trim() || busy || !data.can_reply} className={actionClass}
                onClick={() => void execute("staff-reply", { device_id: deviceId, message: reply }, "Reply sent").then((v) => { if (v) setReply(""); })}>
                <Send className="h-5 w-5" /></button></div>
          </> : <p className="text-slate-500">Select a room to view and reply. Previous guest sessions are not shown.</p>}
        </section>
      </div>}
      {!loading && data && tab === "admin" && <div className="space-y-5">
        {!data.can_configure ? <div className={card}>Only authorized hotel admins and top management can configure room tablets.</div> : <>
          <div className="grid lg:grid-cols-2 gap-5">
            <section className={card + " space-y-4"}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2"><Hotel className="h-5 w-5" /><h2 className="text-xl font-semibold">Property content</h2></div>
                <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs font-semibold">
                  {saveStatus === "saved" ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> All changes saved</> :
                   saveStatus === "saving" ? <><RefreshCw className="h-4 w-4 animate-spin" /> Saving…</> :
                   saveStatus === "error" ? <><AlertCircle className="h-4 w-4 text-red-600" /> Save failed</> :
                     <><Save className="h-4 w-4" /> Unsaved changes</>}
                </div>
              </div>
              <p className="text-sm text-slate-600">Draft content is not shown to guests until published and enabled. Verify opening hours and guest Wi-Fi information before publishing.</p>
              <button className="rounded-xl border px-3 py-2 text-sm font-semibold" disabled={busy || saveStatus === "saving"}
                onClick={async () => {
                  if (!await saveDraft(latestDraftRef.current, hotelId)) return;
                  await execute("staff-prefill-draft", {}, "Existing hotel branding added to draft");
                }}>
                Prefill from HotelCare hotel branding
              </button>
              <p className="text-xs text-slate-500">Address, Wi-Fi, menus, facilities and opening hours still require property verification.</p>
              {field("hotel_name", "Displayed hotel name")}
              {field("welcome", "Welcome message", true)}
              {imageField("logo", "Hotel logo")}
              {imageField("hero", "Welcome photo")}
              {field("primary_color", "Brand color (#RRGGBB)")}
              {field("address", "Hotel address")}
              {field("reception_phone", "Reception contact number")}
              {field("contact_email", "Hotel guest email")}
              {field("guest_wifi_ssid", "Guest Wi-Fi network")}
              {field("guest_wifi_password", "Guest Wi-Fi password")}
              {field("checkout_time", "Check-out time")}
              {field("breakfast_hours", "Breakfast hours")}
              {field("restaurant_hours", "Restaurant and bar hours")}
              {field("room_service_provider", "Room service provided by (e.g. restaurant name)")}
              {field("minibar_info", "Minibar information / price-list link", true)}
              {field("transport_info", "Taxi and transport information", true)}
              {field("facilities_info", "Gym, sauna, jacuzzi availability (only if present)", true)}
              {field("house_rules", "House rules", true)}
              {field("sustainability_info", "Sustainability policy", true)}
            </section>
            <section className="space-y-5">
              <div className={card + " space-y-4"}>
                <h2 className="text-xl font-semibold">Enabled guest services</h2>
                <p className="text-sm text-slate-500">Only enable services the property can deliver. Menu orders require staff confirmation; no automatic charging.</p>
                {services.filter((code) => code !== "jacuzzi" || JACUZZI_HOTELS.has(hotelId))
                  .map((code) => <label key={code} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-xl">
                  <input type="checkbox" checked={!!draft.services?.[code]} onChange={(e) =>
                    setDraft((old) => ({ ...old, services: { ...(old.services || {}), [code]: e.target.checked } }))} />
                  <span>{serviceNames[code] || code.replaceAll("_", " ")}</span>
                </label>)}
                {!JACUZZI_HOTELS.has(hotelId) &&
                  <p className="text-xs text-slate-400">Jacuzzi reservations are available only at Hotel Memories Budapest.</p>}
                <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-white/95 p-3 shadow-sm backdrop-blur">
                  <button disabled={busy || !!uploading} className={actionClass}
                    onClick={() => void saveDraft(latestDraftRef.current, hotelId)}>
                    {saveStatus === "error" ? "Retry save" : "Save now"}
                  </button>
                  <button disabled={busy || !!uploading || saveStatus === "saving"} className="rounded-xl border px-4 py-2.5 font-semibold"
                    onClick={async () => {
                      if (!window.confirm("Publish verified hotel content to all guest devices?")) return;
                      if (!await saveDraft(latestDraftRef.current, hotelId)) return;
                      await execute("staff-publish", {}, "Guest content published");
                    }}>Publish verified draft</button>
                  <span className="text-xs text-slate-500">Changes autosave as draft; publishing is always manual.</span>
                </div>
                <p className="text-sm">{data.config.enabled ? "Published and enabled" : "Not published; guest access is disabled"}</p>
              </div>
              <section className={card + " space-y-4"}>
                <h2 className="text-xl font-semibold flex gap-2 items-center"><MonitorSmartphone className="h-5 w-5" /> Pair a room tablet</h2>
                <label className="block space-y-2 text-sm">Hotel room
                  <select className={inputClass} value={selectedRoom} onChange={(e) => setSelectedRoom(e.target.value)}>
                    <option value="">Select room</option>
                    {data.rooms.map((r) => <option key={r.id} value={r.id}>Room {r.room_number}</option>)}
                  </select>
                </label>
                <button disabled={!selectedRoom || busy} className={actionClass} onClick={async () => {
                  const result = await execute("staff-create-device", { room_id: selectedRoom }, "Pairing code generated");
                  if (result) setIssued(result);
                }}>Generate one-time pairing code</button>
                {issued && <div className="rounded-xl bg-amber-50 border border-amber-300 p-4 space-y-2">
                  <strong>Room {issued.room_number}</strong>
                  <p className="text-sm">Code (expires in 15 minutes). Enter once at <Link className="underline" to="/suite">/suite</Link>.</p>
                  <p className="font-mono tracking-wider break-all">{issued.code}</p>
                  <p className="text-sm">Six-digit staff maintenance PIN: <strong>{issued.pin}</strong></p>
                  <p className="text-xs">Record the PIN securely now; it cannot be retrieved from HotelCare.</p>
                  <button className="flex gap-2 items-center underline text-sm" onClick={() => void navigator.clipboard.writeText(issued.code)}>
                    <Copy className="h-4 w-4" /> Copy pairing code</button>
                </div>}
              </section>
            </section>
          </div>
          <InSuiteRoomQrCodes hotelId={hotelId} hotelName={draft.hotel_name || data.hotel_name}
            rooms={data.rooms} accent={draft.primary_color}
            qrRooms={new Set(data.devices.filter((d) => d.kind === "qr" && d.is_active).map((d) => d.room_id))}
            onChanged={async () => { await load(); }} />
          <section className={card + " space-y-3"}>
            <h2 className="text-xl font-semibold flex items-center gap-2"><Wifi className="h-5 w-5" /> Registered devices & room QR codes</h2>
            {!data.devices.some((d) => d.is_active) && <p className="text-slate-500">No active devices or QR codes.</p>}
            <p className="text-xs text-slate-500">{data.devices.filter((d) => !d.is_active).length} revoked records hidden for clarity.</p>
            {data.devices.filter((d) => d.is_active).map((d) => <div key={d.id} className="flex flex-col md:flex-row justify-between gap-3 border-t py-3">
              <div><strong>Room {roomLabel(d.room_id)} — {d.label}</strong>
                <p className="text-xs text-slate-500">{d.is_active ? d.paired_at ? "Paired" : "Awaiting pairing" : "Revoked"}
                  {" · "}Last seen: {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "Never"}
                  {" · "}Stay: {d.active_reservation_id ? "Verified reservation" : "Not verified"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="border rounded-xl px-3 py-2 text-sm" disabled={busy || !d.is_active}
                  onClick={() => void execute("staff-reconcile-stay", { device_id:d.id }, "Checked-in stay verified")}>
                  Verify active stay</button>
                <button className="border rounded-xl px-3 py-2 text-sm" disabled={busy || !d.is_active}
                  onClick={() => { if (window.confirm("End current guest session? Clear the screen and start a new stay.")) void execute("staff-reset-session", { device_id: d.id }, "Guest session reset"); }}>
                  <ShieldCheck className="h-4 w-4 inline mr-1" /> Reset guest session</button>
                <button className="border rounded-xl px-3 py-2 text-sm text-red-700" disabled={busy || !d.is_active}
                  onClick={() => { if (window.confirm("Revoke this tablet immediately? It must be enrolled again.")) void execute("staff-revoke-device", { device_id: d.id }, "Device revoked"); }}>
                  <LockKeyhole className="h-4 w-4 inline mr-1" /> Revoke</button>
              </div>
            </div>)}
          </section>
        </>}
      </div>}
      <p className="text-xs text-slate-500">Pilot: reservation status changes rotate guest sessions automatically. Physical kiosk lockdown,
        payment/folio posting, booking-provider confirmation and escalation-job scheduling must still be verified before production activation.</p>
    </main>
  </div>;
}
