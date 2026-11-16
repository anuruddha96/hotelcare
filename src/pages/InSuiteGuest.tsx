import { useCallback, useEffect, useRef, useState } from "react";
import {
  BedDouble, BellRing, ChevronLeft, CheckCircle2, Clock3, Coffee, Copy, Hotel,
  Info, Languages, LockKeyhole, MessageCircle, Phone, Send,
  Sparkles, Wifi, Wrench, CarTaxiFront, Leaf, UtensilsCrossed, RefreshCw, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { InSuiteGuestCommerce, type InSuiteOrder, type InSuiteBooking } from "@/components/insuite/InSuiteGuestCommerce";
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
    pending: "Received", completed: "Completed", paired: "Room access",
    choose: "How can we help?", personalize: "Personalise your welcome",
    surname: "Reservation surname", departure: "Check-out date", verify: "Show my welcome",
    checkedIn: "Your room services are ready", awaiting: "Guest services will activate when your check-in is confirmed in the hotel system.",
    guests: "guests", checkout: "Check-out", welcomeTo: "Welcome to",
    servicesHint: "Towels, cleaning & more", chatHint: "Message reception", diningHint: "Breakfast, food & drinks",
    travelHint: "Transfers & facilities", infoHint: "Wi-Fi, hours & hotel details",
    enterSuite: "Explore In-Suite services", concierge: "Your In-Suite Concierge", suiteHint: "Everything you need, right from your room.", greeting: "Dear", touchHint: "Tap a service to get started", welcomeBack: "Welcome screen",
  },
  de: {
    welcome: "Fühlen Sie sich wie zu Hause", intro: "Alles für Ihren Aufenthalt.",
    reception: "Rezeption-Chat", services: "Zimmerservice", dining: "Essen & Frühstück",
    information: "Hotelinformationen", travel: "Transfer & Einrichtungen",
    requests: "Meine Anfragen", wifi: "Gäste-WLAN", room: "Zimmer", send: "Senden",
    order: "Anfrage senden", detail: "Weitere Hinweise (optional)",
    thanks: "Ihre Anfrage wurde gesendet.", back: "Startseite",
    message: "Nachricht an die Rezeption…", noMessages: "Kontaktieren Sie die Rezeption.",
    pending: "Empfangen", completed: "Erledigt", paired: "Zimmerzugang",
    choose: "Wie können wir helfen?", personalize: "Begrüßung personalisieren",
    surname: "Nachname der Buchung", departure: "Abreisedatum", verify: "Begrüßung anzeigen",
    checkedIn: "Ihr Zimmerservice ist bereit", awaiting: "Der Gästeservice wird nach Bestätigung des Check-ins automatisch freigeschaltet.",
    guests: "Gäste", checkout: "Abreise", welcomeTo: "Willkommen im",
    servicesHint: "Handtücher, Reinigung & mehr", chatHint: "Rezeption kontaktieren", diningHint: "Frühstück, Essen & Getränke",
    travelHint: "Transfers & Einrichtungen", infoHint: "WLAN, Zeiten & Hotelinfos",
    enterSuite: "In-Suite-Services entdecken", concierge: "Ihr In-Suite-Concierge", suiteHint: "Alles, was Sie brauchen, direkt vom Zimmer aus.", greeting: "Willkommen", touchHint: "Wählen Sie einen Service", welcomeBack: "Begrüßungsseite",
  },
  hu: {
    welcome: "Érezze otthon magát!", intro: "Minden, amire szüksége lehet.",
    reception: "Recepció chat", services: "Szobai szolgáltatások", dining: "Étterem és reggeli",
    information: "Szállodai információk", travel: "Közlekedés és szolgáltatások",
    requests: "Kéréseim", wifi: "Vendég Wi-Fi", room: "Szoba", send: "Küldés",
    order: "Kérés elküldése", detail: "Megjegyzés (opcionális)",
    thanks: "Kérését elküldtük.", back: "Kezdőlap",
    message: "Írjon a recepciónak…", noMessages: "Kérdezzen a recepciótól!",
    pending: "Beérkezett", completed: "Teljesítve", paired: "Szobai hozzáférés",
    choose: "Miben segíthetünk?", personalize: "Üdvözlés személyre szabása",
    surname: "Foglalási vezetéknév", departure: "Kijelentkezés dátuma", verify: "Üdvözlés megjelenítése",
    checkedIn: "A szobai szolgáltatások elérhetők", awaiting: "A szolgáltatások a bejelentkezés visszaigazolása után automatikusan elérhetővé válnak.",
    guests: "vendég", checkout: "Kijelentkezés", welcomeTo: "Üdvözöljük itt:",
    servicesHint: "Törölközők, takarítás és egyebek", chatHint: "Üzenet a recepciónak", diningHint: "Reggeli, ételek, italok",
    travelHint: "Transzfer és létesítmények", infoHint: "Wi-Fi, nyitvatartás, tudnivalók",
    enterSuite: "Szobai szolgáltatások megnyitása", concierge: "Az Ön szobai asszisztense", suiteHint: "Minden, amire szüksége van, közvetlenül a szobájából.", greeting: "Kedves", touchHint: "Válasszon egy szolgáltatást", welcomeBack: "Üdvözlőképernyő",
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
  { code: "call_back", name: "Request a reception call", icon: Phone },
] as const;
const formatStatus = (value: string) => ({
  submitted: "Received", accepted: "Accepted", in_progress: "On the way",
  completed: "Completed", unavailable: "Could not fulfil", cancelled: "Cancelled",
}[value] || value);
const card = "rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm";
const primaryButton = "rounded-2xl px-6 py-3 font-semibold text-white shadow-sm disabled:opacity-50";

/** Room QR flow: the printed in-room QR encodes /suite?qr=<token>. Scanning it
 * pairs the guest's own phone with the room instantly — no typed code. The
 * token is moved to storage and stripped from the URL at once so it never
 * stays in the address bar, and requests still need a verified stay. */
function tokenFromQrLink() {
  try {
    const url = new URL(window.location.href);
    const scanned = (url.searchParams.get("qr") || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(scanned)) return "";
    localStorage.setItem(INSUITE_DEVICE_KEY, scanned);
    url.searchParams.delete("qr");
    window.history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
    return scanned;
  } catch { return ""; }
}

export default function InSuiteGuest() {
  const [token, setToken] = useState(() => tokenFromQrLink() || localStorage.getItem(INSUITE_DEVICE_KEY) || "");
  const [pairCode, setPairCode] = useState("");
  const [room, setRoom] = useState("");
  const [config, setConfig] = useState<InSuiteContent | null>(null);
  const [view, setView] = useState<View>("home");
  const [welcomeOpen, setWelcomeOpen] = useState(true);
  const [guestWelcome, setGuestWelcome] = useState<{ name: string | null; guest_count: number | null } | null>(null);
  const reducedMotion = useReducedMotion();
  const [lang, setLang] = useState<Language>("en");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!token);
  const [error, setError] = useState("");
  const [requestType, setRequestType] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(2);
  const [detail, setDetail] = useState("");
  const [requests, setRequests] = useState<InSuiteRequest[]>([]);
  const [messages, setMessages] = useState<InSuiteMessage[]>([]);
  const [orders, setOrders] = useState<InSuiteOrder[]>([]);
  const [bookings, setBookings] = useState<InSuiteBooking[]>([]);
  const [stayActive, setStayActive] = useState(false);
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

      setGuestWelcome(data.stay_active === true ? data.guest || null : null);
      setWelcomeOpen(true);
      setStayActive(data.stay_active === true);
      setRoom(String(data.room_number || ""));
      setConfig(data.config || {});
      setError("");
    } catch (err) {
      setError((err as Error).message);
      setConfig(null);

      setGuestWelcome(null);
    } finally { setLoading(false); }
  }, []);

  const refresh = useCallback(async () => {
    if (!token || !config) return;
    try {
      const data = await inSuiteGuest("guest-state", { since: visitStarted.current }, token);
      if (sessionEpoch.current && data.session_epoch !== sessionEpoch.current) {
        sessionEpoch.current = data.session_epoch;
        setStayActive(data.stay_active === true);
        visitStarted.current = new Date().toISOString();
        setRequests([]); setMessages([]); setOrders([]); setBookings([]);

        setGuestWelcome(data.stay_active === true ? data.guest || null : null);
        setWelcomeOpen(true);
        setMessage(""); setDetail("");
        setView("home"); setRequestType(null);
        return;
      }
      setStayActive(data.stay_active === true);
      setGuestWelcome(data.stay_active === true ? data.guest || null : null);

      setRequests(data.requests || []);
      setMessages(data.messages || []);
      setOrders(data.orders || []);
      setBookings(data.bookings || []);
    } catch (err) {
      console.warn("[insuite] temporary update failure", err);
      if (/Tablet disabled|not paired|unavailable/i.test((err as Error).message)) {
        localStorage.removeItem(INSUITE_DEVICE_KEY); setToken(""); setConfig(null);
        setMessages([]); setRequests([]); setOrders([]); setBookings([]); setStayActive(false);
        setGuestWelcome(null); setWelcomeOpen(true);
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
    if (!stayActive) return toast.error(t("awaiting"));
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
    if (!stayActive) return toast.error(t("awaiting"));
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
        <p className="text-slate-300">Guests: scan the QR code in your room to open its services.</p>
        <p className="text-slate-400 text-sm">Staff setting up a room tablet: enter the one-time pairing code.</p>
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

  return <AnimatePresence mode="wait" initial={false}>
    {welcomeOpen ? (
      <motion.section key="suite-welcome" role="region" aria-label={t("concierge")}
        className="relative isolate flex min-h-[100svh] w-full flex-col overflow-hidden bg-[#121b26] text-white"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.98 }}
        transition={{ duration: reducedMotion ? 0 : 0.34, ease: "easeInOut" }}>
        {config?.hero_url && <motion.img src={config.hero_url} alt=""
          className="absolute inset-0 h-full w-full object-cover object-center"
          initial={{ scale: reducedMotion ? 1 : 1.08 }} animate={{ scale: 1 }}
          transition={{ duration: reducedMotion ? 0 : 1.5, ease: "easeOut" }} />}
        <div className="absolute inset-0 bg-black/30" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/50 to-black/85" />
        <header className="relative z-10 flex items-start justify-between gap-3 px-5 pb-3 pt-[calc(env(safe-area-inset-top)+1.25rem)] sm:px-9">
          <div className="flex min-w-0 items-center gap-3">
            {config?.logo_url ? <img src={config.logo_url} alt="" className="h-11 w-11 shrink-0 rounded-xl bg-white/90 p-1 object-contain" />
              : <Hotel className="h-9 w-9 shrink-0" />}
            <span className="truncate text-sm font-semibold tracking-wide sm:text-base">{config?.hotel_name || "Your hotel"}</span>
          </div>
          <label className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/25 bg-black/30 px-3 py-2 text-sm backdrop-blur-md">
            <Languages className="h-4 w-4" />
            <select value={lang} onChange={(e) => setLang(e.target.value as Language)}
              aria-label="Language" className="max-w-24 bg-transparent font-medium text-white outline-none [&>option]:text-slate-900">
              <option value="en">English</option><option value="de">Deutsch</option><option value="hu">Magyar</option>
            </select>
          </label>
        </header>
        <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 py-10 text-center sm:px-8">
          <motion.div className="w-full max-w-3xl"
            initial={reducedMotion ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.75, delay: reducedMotion ? 0 : 0.08 }}>
            <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/30 bg-black/30 px-4 py-2 text-sm font-semibold backdrop-blur-md">
              <BedDouble className="h-4 w-4" /> {t("room")} {room}
            </span>
            <h1 className="mx-auto max-w-3xl text-balance text-[clamp(2.2rem,7vw,4.7rem)] font-semibold leading-[1.09] tracking-tight drop-shadow-lg">
              {t("welcomeTo")} <span className="block">{config?.hotel_name || "our hotel"}</span>
            </h1>
            {stayActive && guestWelcome?.name && <p className="mx-auto mt-7 max-w-2xl break-words text-balance text-[clamp(1.35rem,4vw,2.3rem)] font-semibold leading-tight drop-shadow-lg [overflow-wrap:anywhere]">
              {t("greeting")} {guestWelcome.name}
            </p>}
            <div className="mx-auto my-6 h-px w-16 bg-white/60" />
            <p className="text-lg font-semibold tracking-wide sm:text-xl">{t("concierge")}</p>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-white/85 sm:text-base">{t("suiteHint")}</p>
            <button type="button" onClick={() => { setWelcomeOpen(false); setView("home"); }}
              className="group mx-auto mt-9 inline-flex min-h-14 w-full max-w-sm items-center justify-center gap-3 rounded-2xl bg-white px-6 py-4 text-base font-bold text-slate-950 shadow-2xl transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-white active:scale-[0.98]">
              {t("enterSuite")}
              <ArrowRight className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-1" />
            </button>
            {!stayActive && <p className="mx-auto mt-5 max-w-md text-xs leading-relaxed text-white/80">{t("awaiting")}</p>}
          </motion.div>
        </main>
        <footer className="relative z-10 px-6 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] text-center text-xs tracking-wide text-white/65">
          HotelCare In-Suite · {t("room")} {room}
        </footer>
      </motion.section>
    ) : (
      <motion.div key="suite-services" initial={{ opacity: 0, y: reducedMotion ? 0 : 18 }}
        animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.36 }}
        className="min-h-screen bg-[#f5f7fa] text-slate-900">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="flex min-w-0 items-center gap-3 select-none"
          onPointerDown={openMaintenance} onPointerUp={cancelMaintenance}
          onPointerLeave={cancelMaintenance} onPointerCancel={cancelMaintenance}>
          {config?.logo_url ? <img src={config.logo_url} alt="" className="h-11 w-11 shrink-0 object-contain" />
            : <Hotel className="h-9 w-9 shrink-0" style={{ color: accent }} />}
          <div className="min-w-0">
            <strong className="block truncate text-base font-bold md:text-lg">{config?.hotel_name || "Your hotel"}</strong>
            <p className="text-xs text-slate-500">{t("room")} {room}</p>
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm font-medium">
          <Languages className="h-5 w-5" style={{ color: accent }} />
          <select value={lang} onChange={(e) => setLang(e.target.value as Language)}
            className="max-w-[120px] rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-sm"
            aria-label="Language">
            <option value="en">English</option><option value="de">Deutsch</option><option value="hu">Magyar</option>
          </select>
        </label>
      </div>
    </header>
    <div className="mx-auto max-w-6xl lg:grid lg:grid-cols-[210px_minmax(0,1fr)]">
      <aside className="hidden border-r border-slate-200 bg-white px-3 py-6 lg:block">
        <nav className="sticky top-28 flex flex-col gap-1" aria-label="Guest services">
          {nav.map(({ view: target, label, Icon }) => <button key={target}
            onClick={() => { setView(target); setRequestType(null); }}
            className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium ${view === target ? "text-white" : "text-slate-700 hover:bg-slate-100"}`}
            style={target === view ? { backgroundColor: accent } : undefined}>
            <Icon className="h-5 w-5 shrink-0" /> {label}
          </button>)}
        </nav>
      </aside>
      <main className="min-w-0 w-full space-y-5 p-4 pb-12 md:p-8">
      {view !== "home" && <button onClick={() => { setView("home"); setRequestType(null); }}
        className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-900"><ChevronLeft className="h-4 w-4" />{t("back")}</button>}
      {view === "home" && <>
        <section className="space-y-2 pb-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.15em]" style={{ color: accent }}>
              {t("concierge")} · {t("room")} {room}
            </p>
            <button type="button" onClick={() => setWelcomeOpen(true)}
              className="text-sm font-medium text-slate-500 underline underline-offset-4 hover:text-slate-800">{t("welcomeBack")}</button>
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("choose")}</h1>
          <p className="text-sm text-slate-600">{t("touchHint")}</p>
          {!stayActive && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t("awaiting")}</p>}
        </section>
        <section aria-labelledby="guest-service-heading">
          <h2 id="guest-service-heading" className="mb-3 text-xl font-bold">{t("choose")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            {nav.filter((item) => item.view !== "home").map(({ view: target, label, Icon }) => {
              const hint = { requests: t("servicesHint"), chat: t("chatHint"), dining: t("diningHint"),
                travel: t("travelHint"), hotel: t("infoHint"), home: "" }[target];
              return <motion.button key={target} type="button" onClick={() => { setView(target); setRequestType(null); }}
                whileHover={reducedMotion ? undefined : { y: -3 }} whileTap={reducedMotion ? undefined : { scale: 0.98 }}
                className="flex min-h-36 flex-col items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 sm:p-5">
                <Icon className="h-8 w-8" style={{ color: accent }} />
                <span><strong className="block text-base leading-snug">{label}</strong>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500">{hint}</span></span>
              </motion.button>;
            })}
          </div>
        </section>
        <div className="grid gap-3 md:grid-cols-2">
          {panel(t("wifi"), config?.guest_wifi_ssid ? `${config.guest_wifi_ssid}\n${config.guest_wifi_password || "Ask reception"}` : undefined, Wifi)}
          {panel("Breakfast", config?.breakfast_hours, Coffee)}
        </div>
        {requests.some((r) => !["completed", "unavailable", "cancelled"].includes(r.status)) &&
          <button className="inline-flex items-center gap-2 text-sm font-semibold underline"
            onClick={() => setView("requests")}><BellRing className="h-4 w-4" />{t("requests")} ({requests.filter((r) => r.status !== "completed").length})</button>}
}
      </>}
      {view === "requests" && <>
        {!stayActive && <p role="alert" className="rounded-xl bg-amber-50 p-4">{t("awaiting")}</p>}
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
            <button className={primaryButton} style={{ background: accent }} disabled={busy || !stayActive} onClick={() => void sendRequest()}>
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
            <button className={primaryButton} style={{ backgroundColor: accent }} disabled={busy || !stayActive || !message.trim()}
              onClick={() => void sendMessage()} aria-label={t("send")}><Send className="h-5 w-5" /></button>
          </div>
          <p className="text-xs text-slate-500">This is not an emergency service. For emergencies, follow the hotel emergency instructions.</p>
        </section>
      </>}
      {view === "dining" && <>
        <h1 className="text-3xl font-semibold">{t("dining")}</h1>
        {config?.room_service_provider && config?.services?.room_service &&
          <p className="text-slate-600 flex items-center gap-2">
            <UtensilsCrossed className="h-4 w-4" style={{ color: accent }} />
            Room service by <strong>{config.room_service_provider}</strong>
          </p>}
        <div className="grid lg:grid-cols-2 gap-4">
          {panel("Breakfast", config?.breakfast_hours, Coffee)}
          {panel("Restaurant & bar", config?.restaurant_hours, UtensilsCrossed)}
          {panel("Minibar information", config?.minibar_info, Info)}
        </div>
        <InSuiteGuestCommerce mode="food" config={config || {}} accent={accent}
          roomNumber={room} stayActive={stayActive} orders={orders} bookings={bookings}
          onSubmitted={refresh} />
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
        <InSuiteGuestCommerce mode="booking" config={config || {}} accent={accent}
          roomNumber={room} stayActive={stayActive} orders={orders} bookings={bookings}
          onSubmitted={refresh} />
        <p className="text-sm text-slate-500">All availability and transport pricing require reception confirmation.</p>
      </>}
      <footer className="text-xs text-slate-400 flex gap-2 items-center py-3">
        <RefreshCw className="h-3 w-3" /> Service updates synchronize while the tablet is online. All requests require staff confirmation.
      </footer>
      </main>
    </div>
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
      </motion.div>
    )}
  </AnimatePresence>;
}
