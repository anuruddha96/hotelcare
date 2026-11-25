import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CalendarDays, ChevronLeft, ChevronRight, Flame, KeyRound, Loader2, Mail, Plus, RefreshCw, Save, Search,
  Settings2, Trash2, UserRound, Waves,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { inSuiteStaff } from "@/lib/insuiteApi";
import {
  addDays, bookingWhen, hotelDayLabel, hotelTime, hotelToday, slotRange, SOURCE_LABEL,
  type TransferPrice, type WellnessResource, type WellnessSlot,
} from "@/lib/wellness";

const inputClass = "w-full rounded-xl border border-slate-200 dark:border-input bg-white dark:bg-card px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:[color-scheme:dark]";
const card = "rounded-2xl border bg-white dark:bg-card p-4 sm:p-5 shadow-sm";
const WEEKDAYS = [["1", "Mon"], ["2", "Tue"], ["3", "Wed"], ["4", "Thu"], ["5", "Fri"], ["6", "Sat"], ["7", "Sun"]] as const;
const REFRESH_MS = 20_000;

type Stay = { id: string; guest_name: string; room_number: string | null; check_in_date: string; check_out_date: string; status: string; has_email: boolean };
type Settings = { notification_emails: string[]; transfer_prices: TransferPrice[]; transfer_source: string | null; recipients: string[] };
type BoardData = {
  from: string; to: string; resources: WellnessResource[]; can_book: boolean; can_setup: boolean;
  transfer_prices: TransferPrice[]; settings?: Settings;
};
type Pending = { resource: WellnessResource; slot: WellnessSlot };

/**
 * Reception's jacuzzi / sauna board: who has which slot, the key hand-over,
 * walk-in bookings, and (top management only) the setup.
 */
export function InSuiteWellnessBoard({ hotelId }: { hotelId: string }) {
  const [date, setDate] = useState(hotelToday());
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const current = useRef(hotelId);
  current.current = hotelId;

  const load = useCallback(async (quiet = false) => {
    if (!hotelId) return;
    if (!quiet) setLoading(true);
    try {
      const result = await inSuiteStaff("staff-wellness", hotelId, { date_from: date, date_to: addDays(date, 6) });
      if (current.current === hotelId) setData(result);
    } catch (e) {
      if (!quiet) toast.error((e as Error).message);
    } finally { setLoading(false); }
  }, [hotelId, date]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const id = window.setInterval(() => { if (!document.hidden) void load(true); }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const active = (data?.resources ?? []).filter((r) => r.is_active);
  const days = active[0]?.days?.map((d) => d.date) ?? [];

  const change = async (bookingId: string, kind: "cancel" | "complete" | "no_show" | "key_handed") => {
    if (kind === "cancel" && !window.confirm("Cancel this booking? The slot becomes free and reception is notified.")) return;
    setBusyId(bookingId);
    try {
      await inSuiteStaff("staff-wellness-update", hotelId, { booking_id: bookingId, change: kind });
      toast.success({ cancel: "Booking cancelled", complete: "Marked as done", no_show: "Marked as no-show", key_handed: "Key handed over" }[kind]);
      await load(true);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusyId(null); }
  };

  if (!data && loading) return <div className={card + " flex items-center gap-2 text-slate-500 dark:text-muted-foreground"}><Loader2 className="h-4 w-4 animate-spin" /> Loading the jacuzzi and sauna calendar…</div>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button className="rounded-xl border bg-white dark:bg-card p-2.5" aria-label="Previous day" onClick={() => setDate((d) => d <= hotelToday() ? d : addDays(d, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex gap-1 overflow-x-auto">
            {(days.length ? days : [date]).map((d) => (
              <button key={d} onClick={() => setDate(d)}
                className={`shrink-0 rounded-xl px-3 py-2 text-sm font-medium ${d === date ? "bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground" : "border bg-white dark:bg-card"}`}>
                {d === hotelToday() ? "Today" : hotelDayLabel(d)}
              </button>
            ))}
          </div>
          <button className="rounded-xl border bg-white dark:bg-card p-2.5" aria-label="Next day" onClick={() => setDate((d) => addDays(d, 1))}>
            <ChevronRight className="h-4 w-4" />
          </button>
          <label className="ml-1 flex items-center gap-2 rounded-xl border bg-white dark:bg-card px-3 py-2 text-sm">
            <CalendarDays className="h-4 w-4 text-slate-400 dark:text-muted-foreground" />
            <input type="date" value={date} min={hotelToday()} onChange={(e) => e.target.value && setDate(e.target.value)} className="bg-transparent" aria-label="Go to date" />
          </label>
        </div>
        <div className="flex items-center gap-2">
          {data.can_setup && <button onClick={() => setSetupOpen((v) => !v)} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm ${setupOpen ? "bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground" : "border bg-white dark:bg-card"}`}>
            <Settings2 className="h-4 w-4" /> Setup
          </button>}
          <button onClick={() => void load()} aria-label="Refresh" className="rounded-xl border bg-white dark:bg-card p-2.5"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
        </div>
      </div>

      {setupOpen && data.can_setup && <WellnessSetup hotelId={hotelId} data={data} onSaved={() => load(true)} />}

      {!active.length && <div className={card}>
        <p className="font-medium">No jacuzzi or sauna is switched on for this hotel.</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-muted-foreground">{data.can_setup ? "Open Setup, check the opening hours and switch them on." : "Top management can switch them on in Setup."}</p>
      </div>}

      <div className={`grid gap-4 ${active.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {active.map((resource) => {
          const day = resource.days?.find((d) => d.date === date);
          const Icon = resource.kind === "sauna" ? Flame : Waves;
          const taken = day?.slots.filter((s) => s.booking).length ?? 0;
          return (
            <section key={resource.id} className={card + " space-y-3"}>
              <header className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-semibold"><Icon className="h-5 w-5 text-sky-700 dark:text-sky-300" />{resource.name}</h3>
                  <p className="text-sm text-slate-500 dark:text-muted-foreground">Open {resource.opens_at}–{resource.closes_at}, {resource.slot_minutes}-minute slots, up to {resource.max_guests} guests{Number(resource.price) ? "" : ", free for guests"}</p>
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-full bg-slate-100 dark:bg-muted px-3 py-1 text-xs font-medium">{taken} booked</span>
              </header>
              {!day?.open && <p className="rounded-xl bg-slate-50 dark:bg-muted p-3 text-sm text-slate-600 dark:text-muted-foreground">Closed on this day.</p>}
              <ol className="divide-y">
                {(day?.slots ?? []).map((slot) => {
                  const b = slot.booking;
                  const past = slot.status === "past";
                  return (
                    <li key={slot.starts_at} className={`flex flex-wrap items-start gap-3 py-2.5 ${past && !b ? "opacity-50" : ""}`}>
                      <span className="w-24 shrink-0 pt-0.5 text-sm font-semibold tabular-nums">{slotRange(slot.starts_at, slot.ends_at)}</span>
                      {b ? (
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="flex flex-wrap items-center gap-x-2 text-sm">
                            <strong>{b.guest_name}</strong>
                            <span className="text-slate-500 dark:text-muted-foreground">{b.room_number ? `Room ${b.room_number}` : "No room"}, {b.party_size} {b.party_size === 1 ? "person" : "people"}</span>
                          </p>
                          <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-muted-foreground">
                            <span className="rounded-md bg-slate-100 dark:bg-muted px-2 py-0.5 font-semibold tracking-wider text-slate-700 dark:text-foreground">{b.ticket_code}</span>
                            <span>{b.source ? SOURCE_LABEL[b.source] : ""}</span>
                            {b.status === "completed" && <span className="rounded-md bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 text-emerald-800 dark:text-emerald-200">Done</span>}
                            {b.status === "booked" && b.key_handed_at && <span className="flex items-center gap-1 rounded-md bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 text-amber-800 dark:text-amber-200"><KeyRound className="h-3 w-3" />Key out since {hotelTime(b.key_handed_at)}</span>}
                            {b.notes && <span className="italic">{b.notes}</span>}
                          </p>
                          {data.can_book && b.status === "booked" && (
                            <div className="flex flex-wrap gap-2 pt-1">
                              {!b.key_handed_at && <button disabled={busyId === b.id} onClick={() => void change(b.id, "key_handed")} className="rounded-lg bg-slate-900 dark:bg-primary px-3 py-1.5 text-xs font-medium text-white dark:text-primary-foreground disabled:opacity-50">Key handed over</button>}
                              <button disabled={busyId === b.id} onClick={() => void change(b.id, "complete")} className="rounded-lg border px-3 py-1.5 text-xs">Done</button>
                              {Date.parse(b.starts_at) <= Date.now() && !b.key_handed_at && <button disabled={busyId === b.id} onClick={() => void change(b.id, "no_show")} className="rounded-lg border px-3 py-1.5 text-xs">No-show</button>}
                              <button disabled={busyId === b.id} onClick={() => void change(b.id, "cancel")} className="rounded-lg border px-3 py-1.5 text-xs text-red-700 dark:text-red-400">Cancel</button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-1 items-center justify-between gap-3">
                          <span className="text-sm text-slate-500 dark:text-muted-foreground">{past ? "Passed" : "Free"}</span>
                          {data.can_book && !past && <button onClick={() => setPending({ resource, slot })} className="rounded-lg border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950 px-3 py-1.5 text-xs font-semibold text-sky-900 dark:text-sky-200">Book</button>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>

      {data.transfer_prices?.length > 0 && <section className={card + " space-y-2"}>
        <h3 className="font-semibold">Taxi and airport transfer prices</h3>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {data.transfer_prices.map((p, i) => <li key={i} className="flex justify-between gap-3 rounded-lg bg-slate-50 dark:bg-muted px-3 py-2">
            <span>{p.label}{p.note ? <span className="text-slate-500 dark:text-muted-foreground"> ({p.note})</span> : null}</span>
            <strong className="tabular-nums">{new Intl.NumberFormat("hu-HU").format(p.price)} {p.currency}</strong>
          </li>)}
        </ul>
      </section>}

      {pending && <BookDialog hotelId={hotelId} pending={pending} onClose={() => setPending(null)}
        onBooked={async () => { setPending(null); await load(true); }} onConflict={() => load(true)} />}
    </div>
  );
}

function BookDialog({ hotelId, pending, onClose, onBooked, onConflict }: {
  hotelId: string; pending: Pending; onClose: () => void; onBooked: () => Promise<void>; onConflict: () => Promise<void> | void;
}) {
  const [q, setQ] = useState("");
  const [stays, setStays] = useState<Stay[]>([]);
  const [searching, setSearching] = useState(false);
  const [stayId, setStayId] = useState<string>("");
  const [walkIn, setWalkIn] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sendTicket, setSendTicket] = useState(false);
  const [party, setParty] = useState(Math.min(2, pending.resource.max_guests));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const requestId = useRef(crypto.randomUUID());

  useEffect(() => {
    let alive = true;
    const id = window.setTimeout(async () => {
      setSearching(true);
      try {
        const r = await inSuiteStaff("staff-wellness-stays", hotelId, { q });
        if (alive) setStays(r.stays || []);
      } catch (e) { if (alive) toast.error((e as Error).message); }
      finally { if (alive) setSearching(false); }
    }, q ? 250 : 0);
    return () => { alive = false; window.clearTimeout(id); };
  }, [q, hotelId]);

  const stay = stays.find((s) => s.id === stayId);
  const canSendTicket = walkIn ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) : !!stay?.has_email;
  const ready = walkIn ? name.trim().length > 0 : !!stay;

  const submit = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      const r = await inSuiteStaff("staff-wellness-book", hotelId, {
        resource_id: pending.resource.id, starts_at: pending.slot.starts_at, party_size: party,
        reservation_id: walkIn ? null : stayId, guest_name: walkIn ? name.trim() : null,
        guest_email: walkIn && sendTicket ? email.trim() : null, send_ticket: sendTicket && canSendTicket,
        notes: notes.trim(), client_request_id: requestId.current,
      });
      toast.success(`Booked. Ticket ${r.booking.ticket_code}`);
      await onBooked();
    } catch (e) {
      const err = e as Error & { code?: string };
      toast.error(err.message);
      if (err.code === "SLOT_TAKEN") { await onConflict(); onClose(); }
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Book the {pending.resource.name.toLowerCase()}</DialogTitle>
          <DialogDescription>{bookingWhen(pending.slot.starts_at, pending.slot.ends_at)}. The booking is confirmed at once and reception gets an email.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2 rounded-xl bg-slate-100 dark:bg-muted p-1 text-sm">
            <button className={`flex-1 rounded-lg px-3 py-2 ${!walkIn ? "bg-white dark:bg-card font-semibold shadow-sm" : ""}`} onClick={() => setWalkIn(false)}>Hotel guest</button>
            <button className={`flex-1 rounded-lg px-3 py-2 ${walkIn ? "bg-white dark:bg-card font-semibold shadow-sm" : ""}`} onClick={() => setWalkIn(true)}>No reservation</button>
          </div>
          {!walkIn ? (
            <div className="space-y-2">
              <label className="relative block">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400 dark:text-muted-foreground" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Room number or guest name" className={inputClass + " pl-9"} />
              </label>
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {searching && !stays.length && <p className="p-2 text-sm text-slate-500 dark:text-muted-foreground">Searching…</p>}
                {!searching && !stays.length && <p className="p-2 text-sm text-slate-500 dark:text-muted-foreground">No current or upcoming stay matches.</p>}
                {stays.map((s) => (
                  <label key={s.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 text-sm ${stayId === s.id ? "border-sky-400 bg-sky-50 dark:bg-sky-950" : ""}`}>
                    <input type="radio" name="stay" checked={stayId === s.id} onChange={() => setStayId(s.id)} />
                    <span className="w-20 shrink-0 whitespace-nowrap font-semibold">{s.room_number ? `Room ${s.room_number}` : "No room"}</span>
                    <span className="min-w-0 flex-1 truncate">{s.guest_name}</span>
                    <span className="shrink-0 text-xs text-slate-500 dark:text-muted-foreground">{s.status === "checked_in" ? "In house" : `Arrives ${hotelDayLabel(s.check_in_date)}`}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-medium">Guest name
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} maxLength={160} /></label>
              <label className="space-y-1 text-sm font-medium">Email (optional)
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} /></label>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">Guests
              <select value={party} onChange={(e) => setParty(Number(e.target.value))} className={inputClass}>
                {Array.from({ length: pending.resource.max_guests }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </select></label>
            <label className="space-y-1 text-sm font-medium">Note for reception (optional)
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} maxLength={400} /></label>
          </div>
          <label className={`flex items-center gap-2 text-sm ${canSendTicket ? "" : "opacity-50"}`}>
            <input type="checkbox" checked={sendTicket && canSendTicket} disabled={!canSendTicket} onChange={(e) => setSendTicket(e.target.checked)} />
            <Mail className="h-4 w-4 text-slate-400 dark:text-muted-foreground" /> Email the ticket to the guest
          </label>
        </div>
        <DialogFooter>
          <button onClick={onClose} className="rounded-xl border px-4 py-2.5 text-sm">Close</button>
          <button onClick={() => void submit()} disabled={!ready || saving} className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-primary px-4 py-2.5 text-sm font-semibold text-white dark:text-primary-foreground disabled:opacity-40">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Book {hotelTime(pending.slot.starts_at)}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ResourceForm = {
  id?: string; kind: string; name: string; description: string; opens_at: string; closes_at: string;
  slot_minutes: number; max_guests: number; max_per_day: number; price: number; currency: string;
  weekdays: number[]; is_active: boolean; sort_order: number;
};

function WellnessSetup({ hotelId, data, onSaved }: { hotelId: string; data: BoardData; onSaved: () => Promise<void> }) {
  const [forms, setForms] = useState<ResourceForm[]>([]);
  const [emails, setEmails] = useState("");
  const [prices, setPrices] = useState<TransferPrice[]>([]);
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    setForms((data.resources ?? []).map((r) => ({
      id: r.id, kind: r.kind, name: r.name, description: r.description, opens_at: r.opens_at, closes_at: r.closes_at,
      slot_minutes: r.slot_minutes, max_guests: r.max_guests, max_per_day: r.max_per_day, price: Number(r.price),
      currency: r.currency, weekdays: r.weekdays, is_active: r.is_active, sort_order: r.sort_order,
    })));
    setEmails((data.settings?.notification_emails ?? []).join(", "));
    setPrices(data.settings?.transfer_prices ?? []);
    setSource(data.settings?.transfer_source ?? "");
    // Only when the hotel's setup is (re)loaded, not on every board refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId, data.resources?.map((r) => `${r.id}:${r.is_active}`).join("|")]);

  const missing = useMemo(() => (["jacuzzi", "sauna"] as const).filter((k) => !forms.some((f) => f.kind === k)), [forms]);
  const patch = (i: number, p: Partial<ResourceForm>) => setForms((all) => all.map((f, j) => (j === i ? { ...f, ...p } : f)));

  const saveResource = async (i: number) => {
    const f = forms[i];
    setSaving(f.id ?? f.kind);
    try {
      await inSuiteStaff("staff-wellness-save-resource", hotelId, { resource: f });
      toast.success(`${f.name} saved`);
      await onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(null); }
  };
  const saveSettings = async () => {
    setSaving("settings");
    try {
      await inSuiteStaff("staff-wellness-save-settings", hotelId, {
        notification_emails: emails.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean),
        transfer_prices: prices, transfer_source: source,
      });
      toast.success("Reception emails and transfer prices saved");
      await onSaved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(null); }
  };

  return (
    <section className="space-y-4 rounded-2xl border-2 border-dashed border-slate-200 dark:border-border bg-slate-50/60 dark:bg-muted p-4 sm:p-5">
      <div>
        <h3 className="text-lg font-semibold">Jacuzzi and sauna setup</h3>
        <p className="text-sm text-slate-500 dark:text-muted-foreground">Only top management sees this. Changes apply at once to guests in the room, the website booking link and reception.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {forms.map((f, i) => (
          <div key={f.id ?? f.kind} className="space-y-3 rounded-2xl border bg-white dark:bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <input value={f.name} onChange={(e) => patch(i, { name: e.target.value })} className={inputClass + " font-semibold"} aria-label="Name shown to guests" />
              <label className="flex shrink-0 items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={f.is_active} onChange={(e) => patch(i, { is_active: e.target.checked })} /> Bookable
              </label>
            </div>
            <textarea value={f.description} onChange={(e) => patch(i, { description: e.target.value })} rows={2} maxLength={600}
              className={inputClass} placeholder="What guests should know (shown on the booking page)" />
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-muted-foreground">Opens
                <input type="time" value={f.opens_at} onChange={(e) => patch(i, { opens_at: e.target.value })} className={inputClass} /></label>
              <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-muted-foreground">Closes
                <input type="time" value={f.closes_at} onChange={(e) => patch(i, { closes_at: e.target.value })} className={inputClass} /></label>
              <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-muted-foreground">Slot length
                <select value={f.slot_minutes} onChange={(e) => patch(i, { slot_minutes: Number(e.target.value) })} className={inputClass}>
                  {[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
                </select></label>
              <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-muted-foreground">Max guests
                <select value={f.max_guests} onChange={(e) => patch(i, { max_guests: Number(e.target.value) })} className={inputClass}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                </select></label>
              <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-muted-foreground">Bookings per room per day
                <select value={f.max_per_day} onChange={(e) => patch(i, { max_per_day: Number(e.target.value) })} className={inputClass}>
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                </select></label>
              <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-muted-foreground">Price (0 = free)
                <input type="number" min={0} step={100} value={f.price} onChange={(e) => patch(i, { price: Number(e.target.value) })} className={inputClass} /></label>
              <label className="space-y-1 text-xs font-medium text-slate-600 dark:text-muted-foreground">Currency
                <input value={f.currency} onChange={(e) => patch(i, { currency: e.target.value.toUpperCase().slice(0, 3) })} className={inputClass} /></label>
            </div>
            <fieldset className="flex flex-wrap gap-1.5">
              <legend className="mb-1 text-xs font-medium text-slate-600 dark:text-muted-foreground">Open on</legend>
              {WEEKDAYS.map(([n, label]) => {
                const on = f.weekdays.includes(Number(n));
                return <button key={n} type="button" aria-pressed={on}
                  onClick={() => patch(i, { weekdays: on ? f.weekdays.filter((d) => d !== Number(n)) : [...f.weekdays, Number(n)].sort() })}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${on ? "bg-slate-900 dark:bg-primary text-white dark:text-primary-foreground" : "border bg-white dark:bg-card text-slate-500 dark:text-muted-foreground"}`}>{label}</button>;
              })}
            </fieldset>
            <button onClick={() => void saveResource(i)} disabled={saving !== null}
              className="flex items-center gap-2 rounded-xl bg-slate-900 dark:bg-primary px-4 py-2 text-sm font-semibold text-white dark:text-primary-foreground disabled:opacity-50">
              {saving === (f.id ?? f.kind) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save {f.name.toLowerCase()}
            </button>
          </div>
        ))}
      </div>
      {missing.length > 0 && <div className="flex flex-wrap gap-2">
        {missing.map((k) => <button key={k} onClick={() => setForms((all) => [...all, {
          kind: k, name: k === "jacuzzi" ? "Jacuzzi" : "Sauna", description: "", opens_at: "09:00", closes_at: "21:00",
          slot_minutes: 60, max_guests: 2, max_per_day: 1, price: 0, currency: "HUF", weekdays: [1, 2, 3, 4, 5, 6, 7],
          is_active: false, sort_order: k === "jacuzzi" ? 1 : 2,
        }])} className="flex items-center gap-2 rounded-xl border bg-white dark:bg-card px-3 py-2 text-sm"><Plus className="h-4 w-4" /> Add {k}</button>)}
      </div>}

      <div className="space-y-3 rounded-2xl border bg-white dark:bg-card p-4">
        <label className="block space-y-1 text-sm font-medium">Reception emails for every booking and cancellation
          <input value={emails} onChange={(e) => setEmails(e.target.value)} className={inputClass} placeholder="reception@hotel.hu, frontdesk@hotel.hu" /></label>
        {!!data.settings?.recipients?.length && <p className="flex items-center gap-1 text-xs text-slate-500 dark:text-muted-foreground"><UserRound className="h-3 w-3" /> Currently sent to {data.settings.recipients.join(", ")}</p>}
        <div className="space-y-2">
          <p className="text-sm font-medium">Taxi and airport transfer prices</p>
          {prices.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem_5rem_auto] gap-2">
              <input value={p.label} onChange={(e) => setPrices((all) => all.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} className={inputClass} placeholder="Airport to hotel" />
              <input type="number" min={0} value={p.price} onChange={(e) => setPrices((all) => all.map((x, j) => j === i ? { ...x, price: Number(e.target.value) } : x))} className={inputClass} />
              <input value={p.currency} onChange={(e) => setPrices((all) => all.map((x, j) => j === i ? { ...x, currency: e.target.value.toUpperCase().slice(0, 3) } : x))} className={inputClass} />
              <button aria-label="Remove price" onClick={() => setPrices((all) => all.filter((_, j) => j !== i))} className="rounded-xl border p-2.5"><Trash2 className="h-4 w-4" /></button>
              <input value={p.note ?? ""} onChange={(e) => setPrices((all) => all.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} className={inputClass + " col-span-4"} placeholder="Note, e.g. up to 3 passengers" />
            </div>
          ))}
          <button onClick={() => setPrices((all) => [...all, { label: "", price: 0, currency: "HUF", note: "" }])} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"><Plus className="h-4 w-4" /> Add price</button>
          <input value={source} onChange={(e) => setSource(e.target.value)} className={inputClass} placeholder="Where the prices come from (for example the hotel website page)" />
        </div>
        <button onClick={() => void saveSettings()} disabled={saving !== null}
          className="flex items-center gap-2 rounded-xl bg-slate-900 dark:bg-primary px-4 py-2 text-sm font-semibold text-white dark:text-primary-foreground disabled:opacity-50">
          {saving === "settings" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save emails and prices
        </button>
      </div>
    </section>
  );
}
