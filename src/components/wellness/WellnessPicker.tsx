import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Minus, Plus, RefreshCw, Waves, Flame } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  facilityLabel, fillWord, firstUsefulDay, freeSlots, hotelDayLabel, hotelTime, hotelToday, priceLabel, slotRange,
  wellnessWords, WELLNESS_LOCALES,
  type WellnessKind, type WellnessLang, type WellnessResource, type WellnessSlot, type WellnessStayBooking,
} from "@/lib/wellness";
import { WellnessTicket, type WellnessTicketData } from "./WellnessTicket";

export type WellnessBookError = Error & { code?: string };

type Props = {
  lang: string;
  accent: string;
  resources: WellnessResource[];
  bookings: WellnessStayBooking[];
  canBook: boolean;
  disabledReason?: string;
  loading?: boolean;
  roomNumber?: string | null;
  hotelName?: string;
  initialKind?: WellnessKind | null;
  onBook: (input: { resource: WellnessResource; slot: WellnessSlot; partySize: number }) => Promise<WellnessTicketData>;
  onCancel: (booking: WellnessStayBooking | WellnessTicketData) => Promise<void>;
  onRefresh: () => Promise<void>;
};

const MIN_CONFIRM_MS = 900;  // long enough to feel deliberate, far below the 10 s promise
const HATCH = "repeating-linear-gradient(135deg, #e6ebf0 0 6px, #f6f8fa 6px 12px)";

/**
 * Jacuzzi / sauna slot booking for guests (In-Suite page and the website
 * manage link). Taken slots are hatched so "unavailable" never depends on
 * colour alone; the ticket reveal is the one animated moment.
 */
export function WellnessPicker(props: Props) {
  const { lang, accent, resources, bookings, canBook, disabledReason, loading, roomNumber, hotelName, initialKind } = props;
  const w = wellnessWords(lang);
  const locale = WELLNESS_LOCALES[(lang as WellnessLang)] ?? "en-GB";
  const reduceMotion = useReducedMotion();
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slotStart, setSlotStart] = useState<string | null>(null);
  const [party, setParty] = useState(2);
  const [phase, setPhase] = useState<"idle" | "confirming" | "ticket">("idle");
  const [ticket, setTicket] = useState<WellnessTicketData | null>(null);
  const [error, setError] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const ticketRef = useRef<HTMLDivElement | null>(null);

  const resource = useMemo(
    () => resources.find((r) => r.id === resourceId) ?? resources.find((r) => r.kind === initialKind) ?? resources[0],
    [resources, resourceId, initialKind],
  );
  // Keep the chosen day valid when the calendar refreshes or the facility changes.
  useEffect(() => {
    if (!resource) return;
    if (!day || !resource.days?.some((d) => d.date === day)) setDay(firstUsefulDay(resource));
  }, [resource, day]);
  useEffect(() => { setParty((p) => Math.min(Math.max(1, p), resource?.max_guests ?? 2)); }, [resource?.max_guests]);

  const today = hotelToday();
  const current = resource?.days?.find((d) => d.date === day);
  const visibleSlots = (current?.slots ?? []).filter((s) => s.status !== "past");
  const hadPast = (current?.slots ?? []).some((s) => s.status === "past");
  const selected = visibleSlots.find((s) => s.starts_at === slotStart && s.status === "free") ?? null;
  // A slot taken by someone else while the guest was looking is dropped at once.
  useEffect(() => { if (slotStart && !selected) setSlotStart(null); }, [slotStart, selected]);

  const choose = (id: string) => { setResourceId(id); setSlotStart(null); setError(""); if (phase === "ticket") setPhase("idle"); };
  const book = async () => {
    if (!resource || !selected || !canBook) return;
    setError(""); setPhase("confirming");
    const started = Date.now();
    try {
      const result = await props.onBook({ resource, slot: selected, partySize: party });
      const wait = MIN_CONFIRM_MS - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      setTicket({ ...result, can_cancel: true });
      setPhase("ticket");
      setSlotStart(null);
      requestAnimationFrame(() => ticketRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" }));
    } catch (e) {
      const err = e as WellnessBookError;
      setPhase("idle");
      setError(err.code === "SLOT_TAKEN" ? w.slotTaken : err.message || w.slotTaken);
      if (err.code === "SLOT_TAKEN" || err.code === "SLOT_PASSED") { setSlotStart(null); void props.onRefresh(); }
    }
  };
  const cancel = async (b: WellnessStayBooking | WellnessTicketData) => {
    if (!window.confirm(w.cancelConfirm)) return;
    setCancellingId(b.id);
    try {
      await props.onCancel(b);
      if (ticket?.id === b.id) { setTicket(null); setPhase("idle"); }
    } catch (e) { setError((e as Error).message); }
    finally { setCancellingId(null); }
  };

  if (loading && !resources.length) {
    return <div className="flex items-center gap-3 rounded-2xl bg-white p-6 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />…</div>;
  }
  if (!resource) return null;
  const upcoming = bookings.filter((b) => b.status === "booked" && b.id !== ticket?.id);

  return (
    <div className="space-y-6 text-[#1d2733]" style={{ ["--accent" as string]: accent }}>
      {/* Facility */}
      {resources.length > 1 && (
        <div role="radiogroup" aria-label={w.title} className="grid grid-cols-2 gap-3">
          {resources.map((r) => {
            const on = r.id === resource.id;
            const Icon = r.kind === "sauna" ? Flame : Waves;
            return (
              <button key={r.id} type="button" role="radio" aria-checked={on} onClick={() => choose(r.id)}
                className={`rounded-2xl border-2 p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${on ? "bg-white" : "border-transparent bg-white/70 hover:bg-white"}`}
                style={on ? { borderColor: accent } : undefined}>
                <Icon className="h-6 w-6" style={{ color: on ? accent : "#94a3b8" }} aria-hidden />
                <span className="mt-3 block text-lg font-semibold">{facilityLabel(r.kind, lang, r.name)}</span>
                <span className="mt-1 block text-sm text-slate-500">
                  {fillWord(w.upTo, { n: r.max_guests })}, {fillWord(w.minutes, { n: r.slot_minutes })}, {priceLabel(r.price, r.currency, w.free.toLowerCase(), locale)}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {resources.length === 1 && (
        <p className="text-sm text-slate-600">
          {facilityLabel(resource.kind, lang, resource.name)}: {fillWord(w.upTo, { n: resource.max_guests }).toLowerCase()}, {fillWord(w.minutes, { n: resource.slot_minutes })}, {priceLabel(resource.price, resource.currency, w.free.toLowerCase(), locale)}.
        </p>
      )}
      {resource.description && <p className="max-w-prose text-sm leading-relaxed text-slate-600">{resource.description}</p>}

      {/* Day */}
      <section aria-label={w.chooseDay} className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">{w.chooseDay}</h3>
          <button type="button" onClick={() => void props.onRefresh()} aria-label={w.refresh}
            className="rounded-lg p-2 text-slate-400 hover:text-slate-700 focus-visible:outline focus-visible:outline-2">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {(resource.days ?? []).map((d) => {
            const on = d.date === day;
            const free = freeSlots(d).length;
            return (
              <button key={d.date} type="button" aria-pressed={on} onClick={() => { setDay(d.date); setSlotStart(null); setError(""); }}
                className={`min-w-[5.5rem] shrink-0 rounded-xl border px-3 py-2 text-left transition focus-visible:outline focus-visible:outline-2 ${on ? "text-white" : "border-slate-200 bg-white hover:border-slate-300"}`}
                style={on ? { backgroundColor: accent, borderColor: accent } : undefined}>
                <span className="block text-sm font-semibold">{d.date === today ? w.today : hotelDayLabel(d.date, locale)}</span>
                <span className={`block text-xs ${on ? "text-white/80" : "text-slate-500"}`}>
                  {!d.open ? w.closed : free ? fillWord(w.slotsFree, { n: free }) : w.taken}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Time */}
      <section aria-label={w.chooseTime} className="space-y-2">
        <h3 className="text-base font-semibold">{w.chooseTime}</h3>
        {!current?.open && <p className="rounded-xl bg-white p-4 text-sm text-slate-600">{w.closed}</p>}
        {current?.open && !visibleSlots.length && <p className="rounded-xl bg-white p-4 text-sm text-slate-600">{w.noSlots}</p>}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {visibleSlots.map((s) => {
            const on = s.starts_at === slotStart && s.status === "free";
            const label = hotelTime(s.starts_at, locale);
            if (s.status === "mine") {
              return (
                <div key={s.starts_at} className="flex min-h-14 flex-col items-center justify-center rounded-xl border-2 bg-white px-2 text-center"
                     style={{ borderColor: accent }} aria-label={`${label}, ${w.yours}`}>
                  <span className="text-base font-semibold tabular-nums">{label}</span>
                  <span className="flex items-center gap-1 text-xs font-medium" style={{ color: accent }}><Check className="h-3 w-3" />{w.yours}</span>
                </div>
              );
            }
            if (s.status === "booked") {
              return (
                <div key={s.starts_at} className="flex min-h-14 flex-col items-center justify-center rounded-xl px-2 text-center text-slate-400"
                     style={{ backgroundImage: HATCH }} aria-label={`${label}, ${w.taken}`}>
                  <span className="text-base font-semibold tabular-nums line-through decoration-slate-300">{label}</span>
                  <span className="text-xs">{w.taken}</span>
                </div>
              );
            }
            return (
              <button key={s.starts_at} type="button" aria-pressed={on} disabled={!canBook}
                onClick={() => { setSlotStart(s.starts_at); setError(""); if (phase === "ticket") setPhase("idle"); }}
                className={`min-h-14 rounded-xl border px-2 text-base font-semibold tabular-nums transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${on ? "text-white shadow-md" : "border-slate-200 bg-white hover:border-slate-400"}`}
                style={on ? { backgroundColor: accent, borderColor: accent } : undefined}>
                {label}
              </button>
            );
          })}
        </div>
        {hadPast && <p className="text-xs text-slate-400">{w.pastSlots}</p>}
      </section>

      {/* Guests + book */}
      {phase !== "ticket" && (
        <section className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-slate-600">{w.guests}</span>
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 p-1">
              <button type="button" aria-label="−" disabled={party <= 1} onClick={() => setParty((p) => Math.max(1, p - 1))}
                className="rounded-lg p-2 disabled:opacity-30 focus-visible:outline focus-visible:outline-2"><Minus className="h-4 w-4" /></button>
              <span className="w-8 text-center text-lg font-semibold tabular-nums" aria-live="polite">{party}</span>
              <button type="button" aria-label="+" disabled={party >= resource.max_guests} onClick={() => setParty((p) => Math.min(resource.max_guests, p + 1))}
                className="rounded-lg p-2 disabled:opacity-30 focus-visible:outline focus-visible:outline-2"><Plus className="h-4 w-4" /></button>
            </div>
          </div>
          <button type="button" onClick={() => void book()} disabled={!canBook || !selected || phase === "confirming"}
            className="relative inline-flex min-h-12 items-center justify-center gap-2 overflow-hidden rounded-xl px-6 font-semibold text-white transition disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ backgroundColor: accent }}>
            {phase === "confirming"
              ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{w.confirming}</>
              : selected ? fillWord(w.book, { time: slotRange(selected.starts_at, selected.ends_at, locale) }) : w.chooseTime}
          </button>
        </section>
      )}
      {!canBook && disabledReason && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{disabledReason}</p>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {resource.max_per_day === 1 && phase !== "ticket" && <p className="text-xs text-slate-400">{w.onePerDay}</p>}

      {/* The ticket */}
      <div ref={ticketRef} aria-live="polite">
        <AnimatePresence>
          {phase === "ticket" && ticket && (
            <motion.div key={ticket.id} className="space-y-3"
              initial={reduceMotion ? false : { opacity: 0, y: 24, rotate: -1.5 }}
              animate={{ opacity: 1, y: 0, rotate: 0 }} exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}>
              <p className="flex items-center gap-2 font-semibold" style={{ color: accent }}><Check className="h-5 w-5" />{w.booked}</p>
              <WellnessTicket ticket={{ ...ticket, room_number: ticket.room_number ?? roomNumber }} lang={lang} accent={accent}
                hotelName={hotelName} onCancel={() => void cancel(ticket)} cancelling={cancellingId === ticket.id} />
              <button type="button" onClick={() => { setPhase("idle"); setTicket(null); }}
                className="text-sm font-medium underline underline-offset-4" style={{ color: accent }}>{w.bookAnother}</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Other bookings of this stay, from any channel */}
      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-base font-semibold">{w.yourBookings}</h3>
          {upcoming.map((b) => (
            <WellnessTicket key={b.id} compact ticket={{ ...b, room_number: b.room_number ?? roomNumber }} lang={lang} accent={accent}
              hotelName={hotelName} onCancel={b.can_cancel ? () => void cancel(b) : undefined} cancelling={cancellingId === b.id} />
          ))}
        </section>
      )}
    </div>
  );
}
