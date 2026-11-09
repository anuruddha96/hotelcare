import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Coffee, ShoppingBag, Spa, CarTaxiFront, Plus, Minus } from "lucide-react";
import { toast } from "sonner";
import { inSuiteGuest, type InSuiteContent } from "@/lib/insuiteApi";

export type InSuiteMenuItem = {
  id: string; kind: string; name: string; description: string;
  image_url?: string | null; allergens?: string; price: number;
  currency: string; sort_order: number;
};
export type InSuiteOrder = {
  id: string; kind: string; currency: string; quoted_total: number;
  status: string; requested_at: string; created_at: string;
};
export type InSuiteBooking = {
  id: string; kind: string; status: string; starts_at: string;
  party_size: number; staff_note?: string | null; created_at: string;
};
const bookingLabels: Record<string,string> = {
  taxi: "Taxi / airport transfer", gym: "Gym", spa: "Spa", sauna: "Sauna", jacuzzi: "Jacuzzi",
};
const menuLabels: Record<string,string> = {
  breakfast: "Breakfast to your room", room_service: "Room service", minibar: "Minibar / refreshments",
};
const states: Record<string,string> = {
  submitted: "Sent to hotel", confirmed: "Confirmed by staff", preparing: "Preparing",
  on_the_way: "On the way", delivered: "Delivered", declined: "Declined",
  cancelled: "Cancelled", requested: "Awaiting staff confirmation", completed: "Completed",
};
const panel = "rounded-2xl border border-slate-200 bg-white shadow-sm p-4 md:p-6";
const button = "rounded-xl bg-slate-900 text-white px-4 py-3 font-semibold disabled:opacity-40";
const localTime = () => {
  const date = new Date(Date.now() + 90*60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const money = (amount: number, currency: string) => {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount); }
  catch { return `${amount.toFixed(2)} ${currency}`; }
};

type Props = {
  mode: "food" | "booking"; config: InSuiteContent; accent: string;
  stayActive: boolean; orders: InSuiteOrder[]; bookings: InSuiteBooking[];
  onSubmitted: () => Promise<void>; roomNumber: string;
};

export function InSuiteGuestCommerce({ mode, config, accent, stayActive, orders, bookings, onSubmitted, roomNumber }: Props) {
  const [items, setItems] = useState<InSuiteMenuItem[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [kind, setKind] = useState(mode === "food" ? "breakfast" : "taxi");
  const [cart, setCart] = useState<Record<string,number>>({});
  const [requestedAt, setRequestedAt] = useState(localTime);
  const [partySize, setPartySize] = useState(1);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ id: string; status: string; quoted_total?: number; currency?: string } | null>(null);

  useEffect(() => {
    if (mode !== "food") return;
    let alive = true;
    inSuiteGuest("guest-menu").then((v) => {
      if (alive) { setItems(v.items || []); setCatalogError(""); }
    }).catch((e) => { if (alive) setCatalogError((e as Error).message); });
    return () => { alive = false; };
  }, [mode]);

  const offeredFoodKinds = Object.keys(menuLabels).filter((k) => config.services?.[k]);
  const offeredBookings = Object.keys(bookingLabels).filter((k) => config.services?.[k]);
  useEffect(() => {
    const kinds = mode === "food" ? offeredFoodKinds : offeredBookings;
    if (!kinds.includes(kind)) { setKind(kinds[0] || ""); setCart({}); setReceipt(null); }
  }, [mode, kind, offeredFoodKinds.join("|"), offeredBookings.join("|")]);

  const filtered = useMemo(() => items.filter((i) => i.kind === kind), [items, kind]);
  const selected = useMemo(() => filtered.filter((i) => cart[i.id] > 0), [filtered, cart]);
  const currency = selected[0]?.currency || "";
  const mixedCurrencies = selected.some((i) => i.currency !== currency);
  const total = selected.reduce((sum, i) => sum + Number(i.price) * cart[i.id], 0);
  const dateValid = Number.isFinite(new Date(requestedAt).getTime()) &&
    Date.parse(requestedAt) > Date.now() - 300_000;
  const chooseKind = (next: string) => { setKind(next); setCart({}); setReceipt(null); setNotes(""); };

  const submit = async () => {
    if (!stayActive) return toast.error("Reception must verify the active stay first.");
    if (!dateValid) return toast.error("Choose a valid future date and time.");
    setBusy(true); setReceipt(null);
    try {
      if (mode === "food") {
        if (!selected.length || mixedCurrencies) return;
        const data = await inSuiteGuest("guest-order", {
          kind, requested_at: new Date(requestedAt).toISOString(), notes,
          client_request_id: crypto.randomUUID(),
          items: selected.map((i) => ({ id: i.id, quantity: cart[i.id] })),
        });
        setReceipt(data.order);
        setCart({});
        toast.success("Order received. Staff confirmation is still required.");
      } else {
        const data = await inSuiteGuest("guest-booking", {
          kind, starts_at: new Date(requestedAt).toISOString(), party_size: partySize, notes,
          client_request_id: crypto.randomUUID(),
        });
        setReceipt(data.booking);
        toast.success("Request received. This is not a confirmed reservation.");
      }
      await onSubmitted();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const types = mode === "food" ? offeredFoodKinds : offeredBookings;
  return <div className="space-y-5">
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {types.map((t) => <button key={t} type="button" onClick={() => chooseKind(t)}
        className={`rounded-2xl border p-4 flex flex-col items-start gap-2 text-left ${kind === t ? "text-white" : "bg-white"}`}
        style={kind === t ? { backgroundColor: accent } : undefined}>
        {mode === "food" ? <Coffee className="h-6 w-6" /> : t === "taxi" ? <CarTaxiFront className="h-6 w-6" /> : <Spa className="h-6 w-6" />}
        <strong>{(mode === "food" ? menuLabels : bookingLabels)[t]}</strong>
      </button>)}
    </div>
    {!types.length && <p className="rounded-xl bg-white border p-5 text-slate-600">This hotel has not enabled any services in this category. Reception can help you directly.</p>}
    {mode === "food" && kind && <>
      {catalogError && <p role="alert" className="text-red-700">{catalogError}</p>}
      {!filtered.length && !catalogError && <p className={panel}>No items have been published in this menu yet.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.map((item) => <article key={item.id} className={panel + " flex gap-4"}>
          {item.image_url && <img src={item.image_url} alt="" className="w-20 h-20 rounded-xl object-cover shrink-0" />}
          <div className="flex-1 min-w-0 space-y-1">
            <h3 className="font-semibold">{item.name}</h3>
            <p className="text-sm text-slate-500">{item.description}</p>
            {item.allergens && <p className="text-xs text-amber-800">Allergens: {item.allergens}</p>}
            <strong className="block">{money(Number(item.price),item.currency)}</strong>
            <div className="flex items-center gap-3 pt-2">
              <button className="rounded-lg border p-2" aria-label={`Remove ${item.name}`}
                onClick={() => setCart((old) => ({...old, [item.id]:Math.max(0,(old[item.id]||0)-1)}))}>
                <Minus className="h-4 w-4" /></button>
              <span className="min-w-5 text-center font-semibold">{cart[item.id] || 0}</span>
              <button className="rounded-lg border p-2" aria-label={`Add ${item.name}`}
                onClick={() => setCart((old) => ({...old,[item.id]:Math.min(8,(old[item.id]||0)+1)}))}>
                <Plus className="h-4 w-4" /></button>
            </div>
          </div>
        </article>)}
      </div>
    </>}
    {!!kind && <section className={panel + " space-y-4"}>
      <div className="flex items-center gap-2">
        {mode === "food" ? <ShoppingBag className="h-5 w-5" /> : <CalendarClock className="h-5 w-5" />}
        <h2 className="text-xl font-semibold">{mode === "food" ? "Request an in-room order" : "Request a reservation"}</h2>
      </div>
      {mode === "food" && <p className="font-semibold">Menu estimate: {currency && !mixedCurrencies ? money(total,currency) : "Select items"}</p>}
      {mixedCurrencies && <p className="text-red-700">Items in different currencies cannot be combined.</p>}
      <label className="block space-y-2 text-sm font-semibold">Requested time (tablet local time)
        <input className="w-full rounded-xl border p-3 block" type="datetime-local" value={requestedAt}
          onChange={(e) => setRequestedAt(e.target.value)} />
      </label>
      {mode === "booking" && <label className="block space-y-2 text-sm font-semibold">Number of people
        <select className="w-full rounded-xl border p-3 block" value={partySize}
          onChange={(e) => setPartySize(Number(e.target.value))}>
          {Array.from({length:8},(_,i) => <option key={i} value={i+1}>{i+1}</option>)}
        </select></label>}
      <label className="block space-y-2 text-sm font-semibold">Special requests or notes
        <textarea className="w-full rounded-xl border p-3 block" rows={3} maxLength={400}
          placeholder={kind === "taxi" ? "Destination, luggage, accessibility needs…" : "Optional"}
          value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <p className="text-sm text-amber-900 bg-amber-50 rounded-xl p-3">
        {mode === "food"
          ? "Your order needs staff confirmation. No online payment or automatic room charge is made. Prices shown are the current menu estimates."
          : "A request does not reserve a time slot or book a taxi. Reception must confirm availability and any applicable price."}
      </p>
      {!stayActive && <p role="alert" className="text-sm text-red-700">This room's checked-in stay has not been verified. Contact reception before ordering.</p>}
      <button className={button} style={{ backgroundColor: accent }} type="button"
        disabled={busy || !stayActive || !dateValid || (mode === "food" && (!selected.length || mixedCurrencies))}
        onClick={() => void submit()}>{busy ? "Sending request…" : mode === "food" ? "Send order request" : "Request confirmation"}</button>
      {receipt && <div role="status" className="rounded-xl bg-emerald-50 p-4 border border-emerald-200">
        <CheckCircle2 className="h-5 w-5 text-emerald-700 inline mr-2" />
        Request received for Room {roomNumber}. Reference {receipt.id.slice(0,8)}.
        {" "}Awaiting staff confirmation.
      </div>}
    </section>}
    {mode === "food" && !!orders.length && <section className={panel + " space-y-3"}>
      <h2 className="font-semibold text-lg">Your order updates</h2>
      {orders.map((o) => <div key={o.id} className="flex justify-between items-center gap-3 border-t py-2">
        <div><strong>{menuLabels[o.kind] || o.kind}</strong>
          <p className="text-xs text-slate-500">{money(o.quoted_total,o.currency)} (estimate) · {new Date(o.created_at).toLocaleString()}</p>
        </div><span className="rounded-full bg-slate-100 px-3 py-2 text-xs">{states[o.status] || o.status}</span>
      </div>)}
    </section>}
    {mode === "booking" && !!bookings.length && <section className={panel + " space-y-3"}>
      <h2 className="font-semibold text-lg">Reservation requests</h2>
      {bookings.map((b) => <div key={b.id} className="flex justify-between gap-3 border-t py-2">
        <div><strong>{bookingLabels[b.kind] || b.kind}</strong>
          <p className="text-xs text-slate-500">{new Date(b.starts_at).toLocaleString()} · {b.party_size} people</p>
          {b.staff_note && <p className="text-sm text-slate-600">{b.staff_note}</p>}
        </div><span className="rounded-full bg-slate-100 px-3 py-2 text-xs h-fit">{states[b.status] || b.status}</span>
      </div>)}
    </section>}
  </div>;
}
