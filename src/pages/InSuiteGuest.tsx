import { useCallback, useEffect, useRef, useState } from "react";
import {
  BedDouble, BellRing, ChevronLeft, CheckCircle2, Clock3, Coffee, Copy, Hotel,
  Info, Languages, LockKeyhole, MessageCircle, Phone, Send, ShieldCheck,
  Sparkles, Wifi, Wrench, CarTaxiFront, Leaf, UtensilsCrossed, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  INSUITE_DEVICE_KEY, inSuiteGuest, type InSuiteContent,
  type InSuiteMessage, type InSuiteRequest,
} from "@/lib/insuiteApi";

type View = "home" | "requests" | "chat" | "dining" | "hotel" | "travel";
type Language = "en" | "de" | "hu";
const words: Record<Language, Record<string, string>> = {
  en: {
    welcome: "Make yourself at home", intro: "Everything you need during your stay.",
    reception: "Reception chat", services: "Room services", dining: "Food & breakfast",
    information: "Hotel information", travel: "Transport & facilities",
    requests: "My requests", wifi: "Guest Wi-Fi", room: "Room", send: "Send",
    order: "Request service", detail: "Any details for our team? (optional)",
    thanks: "Your request has been sent to our team.", back: "Home",
    message: "Write to reception…", noMessages: "Ask reception a question or request help.",
    pending: "Received", completed: "Completed", paired: "Paired room tablet",
  },
  de: {
    welcome: "Fühlen Sie sich wie zu Hause", intro: "Alles für Ihren Aufenthalt.",
    reception: "Rezeption-Chat", services: "Zimmerservice", dining: "Essen & Frühstück",
    information: "Hotelinformationen", travel: "Transfer & Einrichtungen",
    requests: "Meine Anfragen", wifi: "Gäste-WLAN", room: "Zimmer", send: "Senden",
    order: "Anfrage senden", detail: "Weitere Hinweise (optional)",
    thanks: "Ihre Anfrage wurde gesendet.", back: "Startseite",
    message: "Nachricht an die Rezeption…", noMessages: "Kontaktieren Sie die Rezeption.",
    pending: "Empfangen", completed: "Erledigt", paired: "Verbundenes Zimmertablet",
  },
  hu: {
    welcome: "Érezze otthon magát!", intro: "Minden, amire szüksége lehet.",
    reception: "Recepció chat", services: "Szobai szolgáltatások", dining: "Étterem és reggeli",
    information: "Szállodai információk", travel: "Közlekedés és szolgáltatások",
    requests: "Kéréseim", wifi: "Vendég Wi-Fi", room: "Szoba", send: "Küldés",
    order: "Kérés elküldése", detail: "Megjegyzés (opcionális)",
    thanks: "Kérését elküldtük.", back: "Kezdőlap",
    message: "Írjon a recepciónak…", noMessages: "Kérdezzen a recepciótól!",
    pending: "Beérkezett", completed: "Teljesítve", paired: "Párosított szobai tablet",
  },
};
const serviceOptions = [
  { code: "extra_towels", name: "Extra towels", icon: Sparkles },
  { code: "extra_pillow", name: "Extra pillows", icon: BedDouble },
  { code: "blanket", name: "Blanket", icon: BedDouble },
  { code: "amenities", name: "Toiletries & amenities", icon: Sparkles },
  { code: "water", name: "Drinking water", icon: Coffee },
  { code: "room_cleaning", name: "Room cleaning", icon: Sparkles },
  { code: "maintenance", name: "Report a problem", icon: Wrench },
  { code: "taxi", name: "Request a taxi", icon: CarTaxiFront },
  { code: "call_back", name: "Request a reception call", icon: Phone },
] as const;
const formatStatus = (value: string) => ({
  submitted: "Received", accepted: "Accepted", in_progress: "On the way",
  completed: "Completed", unavailable: "Could not fulfil", cancelled: "Cancelled",
}[value] || value);
const card = "rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm";
const primaryButton = "rounded-2xl px-6 py-3 font-semibold text-white shadow-sm disabled:opacity-50";

export default function InSuiteGuest() {
  const [token, setToken] = useState(() => localStorage.getItem(INSUITE_DEVICE_KEY) || "");
  const [pairCode, setPairCode] = useState("");
  const [room, setRoom] = useState("");
  const [config, setConfig] = useState<InSuiteContent | null>(null);
  const [view, setView] = useState<View>("home");
  const [lang, setLang] = useState<Language>("en");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!token);
  const [error, setError] = useState("");
  const [requestType, setRequestType] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(2);
  const [detail, setDetail] = useState("");
  const [requests, setRequests] = useState<InSuiteRequest[]>([]);
  const [messages, setMessages] = useState<InSuiteMessage[]>([]);
  const [message, setMessage] = useState("");
  const [staffPin, setStaffPin] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [maintenanceUnlocked, setMaintenanceUnlocked] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const visitStarted = useRef(new Date().toISOString());
  const sessionEpoch = useRef<string | null>(null);
  const t = (key: string) => words[lang][key] || words.en[key] || key;
  const accent = config?.primary_color || "#153B57";

  const boot = useCallback(async (value: string) => {
    setLoading(true);
    try {
      const data = await inSuiteGuest("guest-bootstrap", {}, value);
      sessionEpoch.current = data.session_epoch || null;
      setRoom(String(data.room_number || ""));
      setConfig(data.config || {});
      setError("");
    } catch (err) {
      setError((err as Error).message);
      setConfig(null);
    } finally { setLoading(false); }
  }, []);

  const refresh = useCallback(async () => {
    if (!token || !config) return;
    try {
      const data = await inSuiteGuest("guest-state", { since: visitStarted.current }, token);
      if (sessionEpoch.current && data.session_epoch !== sessionEpoch.current) {
        sessionEpoch.current = data.session_epoch;
        visitStarted.current = new Date().toISOString();
        setRequests([]); setMessages([]); setMessage(""); setDetail("");
        setView("home"); setRequestType(null);
        return;
      }
      setRequests(data.requests || []);
      setMessages(data.messages || []);
    } catch (err) {
      console.warn("[insuite] temporary update failure", err);
      if (/Tablet disabled|not paired|unavailable/i.test((err as Error).message)) {
        localStorage.removeItem(INSUITE_DEVICE_KEY); setToken(""); setConfig(null);
        setMessages([]); setRequests([]);
      }
    }
  }, [token, config]);

  useEffect(() => { if (token) void boot(token); }, [token, boot]);
  useEffect(() => {
    if (!token || !config) return;
    void refresh();
    const id = window.setInterval(() => { if (!document.hidden) void refresh(); }, 20000);
    const wake = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", wake);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", wake); };
  }, [token, config, refresh]);

  const pair = async () => {
    setBusy(true); setError("");
    try {
      // Fullscreen requires a live user gesture; request it before the network call.
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen().catch(() => {});
      }
      const data = await inSuiteGuest("pair", { code: pairCode });
      localStorage.setItem(INSUITE_DEVICE_KEY, data.token);
      visitStarted.current = new Date().toISOString();
      setToken(data.token);
      setPairCode("");
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const sendRequest = async () => {
    if (!requestType) return;
    setBusy(true);
    try {
      await inSuiteGuest("guest-request", {
        request_type: requestType, quantity, detail, client_request_id: crypto.randomUUID(),
      });
      toast.success(t("thanks"));
      setRequestType(null); setQuantity(2); setDetail("");
      await refresh();
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  };
  const sendMessage = async () => {
    if (!message.trim() || busy) return;
    setBusy(true);
    try {
      await inSuiteGuest("guest-message", { message });
      setMessage("");
      await refresh();
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  };
  const openMaintenance = () => {
    holdTimer.current = window.setTimeout(() => setPinOpen(true), 4000);
  };
  const cancelMaintenance = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  const verifyPin = async () => {
    setBusy(true);
    try {
      await inSuiteGuest("guest-unlock", { pin: staffPin });
      setMaintenanceUnlocked(true); setStaffPin("");
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  };
  const startService = (type: string) => {
    setRequestType(type);
    setQuantity(type === "extra_towels" || type === "extra_pillow" ? 2 : 1);
    setDetail("");
    setView("requests");
  };

  if (!token || (loading && !config) || error && !config) {
    return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl bg-white/10 border border-white/15 p-8 text-center space-y-5">
        <Hotel className="h-12 w-12 mx-auto" />
        <h1 className="text-3xl font-semibold">HotelCare In-Suite</h1>
        <p className="text-slate-300">Staff: enter your one-time room pairing code.</p>
        {error && <p role="alert" className="text-amber-200">{error}</p>}
        {loading ? <p>Connecting to the room…</p> : <>
          <input value={pairCode} onChange={(e) => setPairCode(e.target.value.toUpperCase())}
            maxLength={24} placeholder="24-character pairing code" aria-label="Pairing code"
            className="w-full rounded-xl bg-white p-4 text-slate-950 text-center tracking-wider" />
          <button disabled={busy || pairCode.trim().length !== 24} onClick={() => void pair()}
            className="w-full rounded-xl bg-white p-3 font-semibold text-slate-900 disabled:opacity-40">
            {busy ? "Pairing…" : "Pair tablet"}
          </button>
          {token && <button className="text-sm underline" onClick={() => {
            localStorage.removeItem(INSUITE_DEVICE_KEY); setToken(""); setError("");
          }}>Staff: clear invalid pairing</button>}
        </>}
      </div>
    </div>;
  }

  const nav: { view: View; label: string; Icon: typeof Hotel }[] = [
    { view: "home", label: t("back"), Icon: Hotel },
    { view: "requests", label: t("services"), Icon: Sparkles },
    { view: "chat", label: t("reception"), Icon: MessageCircle },
    { view: "dining", label: t("dining"), Icon: UtensilsCrossed },
    { view: "hotel", label: t("information"), Icon: Info },
    { view: "travel", label: t("travel"), Icon: CarTaxiFront },
  ];
  const panel = (label: string, body: string | undefined, Icon = Info) =>
    body ? <section className={card}><div className="flex items-center gap-3 mb-2"><Icon className="h-5 w-5" style={{ color: accent }} />
      <h3 className="font-bold">{label}</h3></div><p className="whitespace-pre-line text-slate-600 leading-relaxed">{body}</p></section> : null;

  return <div className="min-h-screen bg-[#f5f7fa] text-slate-900 flex flex-col lg:flex-row">
    <aside className="lg:w-64 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 p-5 flex flex-col gap-6">
      <div className="space-y-1">
        <div className="flex items-center gap-3 select-none"
          onPointerDown={openMaintenance} onPointerUp={cancelMaintenance}
          onPointerLeave={cancelMaintenance} onPointerCancel={cancelMaintenance}>
          {config?.logo_url ? <img src={config.logo_url} alt="" className="h-12 w-12 object-contain" /> : <Hotel className="h-10 w-10" style={{ color: accent }} />}
          <strong className="text-lg leading-tight">{config?.hotel_name || "Your hotel"}</strong>
        </div>
        <p className="text-sm text-slate-500">{t("room")} {room} · {t("paired")}</p>
      </div>
      <nav className="grid grid-cols-3 gap-2 lg:flex lg:flex-col" aria-label="Guest services">
        {nav.map(({ view: target, label, Icon }) => (
          <button key={target} onClick={() => { setView(target); setRequestType(null); }}
            className={`flex flex-col lg:flex-row items-center gap-2 rounded-xl p-3 text-xs lg:text-base text-left transition-colors ${target === view ? "text-white" : "hover:bg-slate-100 text-slate-700"}`}
            style={target === view ? { backgroundColor: accent } : undefined}>
            <Icon className="h-5 w-5 shrink-0" /> <span>{label}</span>
          </button>
        ))}
      </nav>
      <label className="flex items-center gap-2 text-sm"><Languages className="h-4 w-4" />
        <select value={lang} onChange={(e) => setLang(e.target.value as Language)}
          className="flex-1 rounded-lg border p-2 bg-white" aria-label="Language">
          <option value="en">English</option><option value="de">Deutsch</option><option value="hu">Magyar</option>
        </select>
      </label>
      <div className="hidden lg:block mt-auto text-xs text-slate-500">
        <ShieldCheck className="h-4 w-4 inline mr-1" /> For assistance, contact the front desk.
      </div>
    </aside>
    <main className="flex-1 min-w-0 p-4 md:p-8 lg:p-10 max-w-6xl mx-auto w-full space-y-6">
      {view !== "home" && <button onClick={() => { setView("home"); setRequestType(null); }}
        className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-900"><ChevronLeft className="h-4 w-4" />{t("back")}</button>}
      {view === "home" && <>
        <div className="relative min-h-52 md:min-h-72 rounded-[2rem] overflow-hidden flex items-end bg-gradient-to-br from-slate-900 to-slate-600 text-white">
          {config?.hero_url && <img src={config.hero_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" />}
          <div className="relative z-10 p-7 md:p-10 max-w-2xl">
            <p className="uppercase tracking-widest text-sm opacity-80 mb-3">{t("room")} {room}</p>
            <h1 className="text-3xl md:text-5xl font-semibold mb-3">{t("welcome")}</h1>
            <p className="text-lg">{config?.welcome || t("intro")}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {nav.filter((n) => n.view !== "home" && n.view !== "hotel").slice(0, 4).map(({ view: target, Icon, label }) =>
            <button key={target} onClick={() => setView(target)} className={`${card} text-left min-h-40 hover:shadow-lg transition-shadow`}>
              <Icon className="h-8 w-8 mb-5" style={{ color: accent }} />
              <span className="font-semibold text-lg block">{label}</span>
            </button>)}
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          {panel(t("wifi"), config?.guest_wifi_ssid ? `${config.guest_wifi_ssid}\nPassword: ${config.guest_wifi_password || "Ask reception"}` : undefined, Wifi)}
          {panel("Breakfast", config?.breakfast_hours, Coffee)}
        </div>
        {requests.some((r) => !["completed", "unavailable", "cancelled"].includes(r.status)) &&
          <button className="flex items-center gap-2 underline font-medium" onClick={() => setView("requests")}>
            <BellRing className="h-5 w-5" /> {t("requests")} ({requests.filter((r) => r.status !== "completed").length})
          </button>}
      </>}
      {view === "requests" && <>
        <h1 className="text-3xl font-semibold">{requestType ? t("order") : t("services")}</h1>
        {requestType ? <section className={card + " max-w-xl space-y-5"}>
          <h2 className="text-xl font-semibold">{serviceOptions.find((x) => x.code === requestType)?.name}</h2>
          <label className="flex items-center justify-between">Quantity
            <select className="border rounded-xl p-3" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}>
              {Array.from({ length: 8 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
          </label>
          <textarea className="border rounded-xl p-3 w-full min-h-28" value={detail} onChange={(e) => setDetail(e.target.value)}
            maxLength={400} placeholder={t("detail")} />
          <div className="flex gap-3">
            <button className="border rounded-xl px-4 py-3" onClick={() => setRequestType(null)}>Back</button>
            <button className={primaryButton} style={{ background: accent }} disabled={busy} onClick={() => void sendRequest()}>
              {busy ? "Sending…" : t("order")}
            </button>
          </div>
        </section> : <>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {serviceOptions.filter((s) => config?.services?.[s.code]).map(({ code, name, icon: Icon }) =>
              <button key={code} onClick={() => startService(code)} className={card + " hover:shadow-md text-left"}>
                <Icon className="h-7 w-7 mb-4" style={{ color: accent }} />
                <span className="font-semibold">{name}</span>
              </button>)}
          </div>
          {requests.length > 0 && <section className={card + " space-y-3"}>
            <h2 className="text-xl font-semibold">{t("requests")}</h2>
            {requests.map((r) => <div key={r.id} className="flex justify-between items-center border-t pt-3 gap-3">
              <div><strong>{serviceOptions.find((s) => s.code === r.request_type)?.name || r.request_type}</strong>
                <p className="text-sm text-slate-500">{r.quantity} × · {new Date(r.created_at).toLocaleTimeString()}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold">{formatStatus(r.status)}</span>
            </div>)}
          </section>}
        </>}
      </>}
      {view === "chat" && <>
        <h1 className="text-3xl font-semibold">{t("reception")}</h1>
        <section className={card + " flex flex-col min-h-96 gap-4"}>
          <div className="flex-1 space-y-3" role="log" aria-live="polite">
            {!messages.length && <p className="text-slate-500">{t("noMessages")}</p>}
            {messages.map((m) => <div key={m.id}
              className={`rounded-2xl p-4 max-w-[85%] whitespace-pre-wrap ${m.sender === "guest" ? "bg-slate-100 ml-auto" : "bg-blue-50"}`}>
              <p className="text-xs font-semibold mb-1">{m.sender === "guest" ? "You" : "Reception"}</p>
              <p>{m.body}</p>
            </div>)}
          </div>
          <div className="flex gap-2">
            <input className="flex-1 min-w-0 border rounded-xl px-4 py-3" maxLength={1000}
              value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("message")}
              onKeyDown={(e) => { if (e.key === "Enter") void sendMessage(); }} />
            <button className={primaryButton} style={{ backgroundColor: accent }} disabled={busy || !message.trim()}
              onClick={() => void sendMessage()} aria-label={t("send")}><Send className="h-5 w-5" /></button>
          </div>
          <p className="text-xs text-slate-500">This is not an emergency service. For emergencies, follow the hotel emergency instructions.</p>
        </section>
      </>}
      {view === "dining" && <>
        <h1 className="text-3xl font-semibold">{t("dining")}</h1>
        <div className="grid lg:grid-cols-2 gap-4">
          {panel("Breakfast", config?.breakfast_hours, Coffee)}
          {panel("Restaurant & bar", config?.restaurant_hours, UtensilsCrossed)}
          {panel("Minibar information", config?.minibar_info, Info)}
        </div>
        <p className="text-slate-500 text-sm">To place a paid order, please contact reception. Tablet checkout and room charging are not yet enabled.</p>
      </>}
      {view === "hotel" && <>
        <h1 className="text-3xl font-semibold">{t("information")}</h1>
        <div className="grid lg:grid-cols-2 gap-4">
          {panel("Address", config?.address, Hotel)}
          {panel("Guest Wi-Fi", config?.guest_wifi_ssid
            ? `${config.guest_wifi_ssid}\nPassword: ${config.guest_wifi_password || "Ask reception"}` : undefined, Wifi)}
          {panel("Reception", config?.reception_phone, Phone)}
          {panel("Check-out", config?.checkout_time, Clock3)}
          {panel("House rules", config?.house_rules, Info)}
          {panel("Sustainability", config?.sustainability_info, Leaf)}
        </div>
        {config?.guest_wifi_password && <button className="rounded-xl border p-3 flex items-center gap-2"
          onClick={() => { void navigator.clipboard.writeText(config.guest_wifi_password || "").then(() => toast.success("Copied")); }}>
          <Copy className="h-4 w-4" /> Copy guest Wi-Fi password
        </button>}
      </>}
      {view === "travel" && <>
        <h1 className="text-3xl font-semibold">{t("travel")}</h1>
        <div className="grid lg:grid-cols-2 gap-4">
          {panel("Transport and taxis", config?.transport_info, CarTaxiFront)}
          {panel("Hotel facilities", config?.facilities_info, Hotel)}
        </div>
        {config?.services?.taxi && <button className={primaryButton} style={{ background: accent }}
          onClick={() => startService("taxi")}>Request taxi assistance</button>}
        <p className="text-sm text-slate-500">Taxi requests are not confirmed bookings until reception confirms with the operator.</p>
      </>}
      <footer className="text-xs text-slate-400 flex gap-2 items-center py-3">
        <RefreshCw className="h-3 w-3" /> Service updates synchronize while the tablet is online. All requests require staff confirmation.
      </footer>
    </main>
    {pinOpen && <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Staff maintenance">
      <div className="bg-white rounded-3xl p-7 w-full max-w-sm space-y-4">
        <LockKeyhole className="h-8 w-8" /><h2 className="text-xl font-semibold">Staff maintenance</h2>
        {maintenanceUnlocked ? <>
          <p className="text-slate-600">App maintenance authorized. Device kiosk mode must be controlled by your Android/iPad MDM, not this web PIN.</p>
          <button className="rounded-xl border p-3" onClick={() => window.location.reload()}>Reload app</button>
          {document.fullscreenElement && <button className="ml-2 rounded-xl border p-3"
            onClick={() => void document.exitFullscreen().catch(() => toast.error("This tablet is controlled by kiosk management"))}>
            Exit browser fullscreen
          </button>}
        </> : <>
          <p className="text-sm text-slate-500">Enter the six-digit manager PIN.</p>
          <input className="border rounded-xl w-full p-3 text-center tracking-widest" type="password"
            inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={staffPin}
            onChange={(e) => setStaffPin(e.target.value.replace(/\D/g, ""))} />
          <button className={primaryButton} style={{ background: accent }} disabled={busy || staffPin.length !== 6}
            onClick={() => void verifyPin()}>Unlock maintenance</button>
        </>}
        <button className="block text-sm underline" onClick={() => { setPinOpen(false); setMaintenanceUnlocked(false); setStaffPin(""); }}>Close</button>
      </div>
    </div>}
  </div>;
}
