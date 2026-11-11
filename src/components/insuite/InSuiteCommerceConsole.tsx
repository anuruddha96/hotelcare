import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Coffee, Clock3, Plus, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { inSuiteStaff } from "@/lib/insuiteApi";

export type InSuiteCatalogItem = {
  id: string; kind: string; name: string; description: string; image_url?: string | null;
  allergens: string; price: number; currency: string; is_active: boolean; sort_order?: number;
};
export type InSuiteStaffOrder = {
  id: string; room_id: string; kind: string; notes: string;
  currency: string; quoted_total: number; requested_at: string;
  status: string; created_at: string;
};
export type InSuiteOrderLine = {
  order_id: string; name_snapshot: string; unit_price: number;
  quantity: number; line_total: number;
};
export type InSuiteStaffBooking = {
  id: string; room_id: string; kind: string; starts_at: string; party_size: number;
  notes: string; staff_note?: string | null; status: string; created_at: string;
};
const orderTransitions: Record<string,string[]> = {
  submitted: ["confirmed","declined"], confirmed: ["preparing","on_the_way","delivered","cancelled"],
  preparing: ["on_the_way","delivered","cancelled"], on_the_way: ["delivered","cancelled"],
};
const bookingTransitions: Record<string,string[]> = {
  requested: ["confirmed","declined"], confirmed: ["completed","cancelled"],
};
const kinds = ["breakfast","room_service","minibar"];
const format = (n: number, currency: string) => {
  try { return new Intl.NumberFormat(undefined,{style:"currency",currency}).format(n); }
  catch { return String(n) + " " + currency; }
};
const panel = "rounded-2xl border border-slate-200 bg-white p-4 md:p-6 shadow-sm";
const input = "w-full rounded-xl border border-slate-200 px-3 py-2.5 bg-white";
const action = "rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-40";

type Props = {
  mode: "orders" | "bookings" | "menu";
  hotelId: string;
  catalogItems: InSuiteCatalogItem[];
  orders: InSuiteStaffOrder[];
  orderLines: InSuiteOrderLine[];
  bookings: InSuiteStaffBooking[];
  roomLabels: Record<string,string>;
  canConfigure: boolean; canManageOrders: boolean; canReply: boolean;
  onRefresh: () => Promise<void>;
};

export function InSuiteCommerceConsole({
  mode, hotelId, catalogItems, orders, orderLines, bookings, roomLabels,
  canConfigure, canManageOrders, canReply, onRefresh,
}: Props) {
  const [busy, setBusy] = useState("");
  const [staffNotes, setStaffNotes] = useState<Record<string,string>>({});
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState({
    kind: "breakfast", name: "", description: "", allergens: "",
    image_url: "", price: "0", currency: "HUF", is_active: false,
  });
  const sortedOrders = useMemo(() =>
    [...orders].sort((a,b) => Number(["delivered","declined","cancelled"].includes(a.status))
      - Number(["delivered","declined","cancelled"].includes(b.status))
      || Date.parse(b.created_at) - Date.parse(a.created_at)), [orders]);
  const execute = async (actionName: string, id: string, body: Record<string,unknown>, success: string) => {
    setBusy(id);
    try {
      await inSuiteStaff(actionName, hotelId, body);
      toast.success(success); await onRefresh();
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(""); }
  };
  const edit = (item: InSuiteCatalogItem) => {
    setEditingId(item.id); setForm({
      kind: item.kind, name: item.name, description: item.description,
      allergens: item.allergens, image_url: item.image_url || "",
      price: String(item.price), currency: item.currency, is_active: item.is_active,
    });
  };
  const reset = () => {
    setEditingId(""); setForm({
      kind: "breakfast", name: "", description: "", allergens: "", image_url: "",
      price: "0", currency: "HUF", is_active: false,
    });
  };
  const save = async () => {
    if (!canConfigure) return;
    if (!form.name.trim() || !Number.isFinite(Number(form.price))) {
      return toast.error("Enter a valid name and price");
    }
    const id = editingId || "new";
    setBusy(id);
    try {
      await inSuiteStaff("staff-save-menu-item", hotelId, {
        item_id: editingId || undefined, ...form, price: Number(form.price),
      });
      toast.success("Menu item saved");
      reset(); await onRefresh();
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(""); }
  };

  if (mode === "orders") return <section className="space-y-4">
    <div className="flex items-center justify-between">
      <h2 className="text-xl font-semibold flex items-center gap-2"><UtensilsCrossed className="h-5 w-5" /> In-room food requests</h2>
      <span className="text-sm text-slate-500">{orders.filter((o) => !["delivered","declined","cancelled"].includes(o.status)).length} open</span>
    </div>
    <p className="text-sm text-amber-900 rounded-xl bg-amber-50 p-3 border border-amber-200">
      Orders are quotations until staff confirms. No automatic folio/Previo charge or online payment occurs.
    </p>
    {!orders.length && <div className={panel}>No food orders in the past three days.</div>}
    {sortedOrders.map((o) => <article key={o.id} className={panel + " space-y-3"}>
      <div className="flex gap-4 justify-between flex-wrap">
        <div><strong className="text-lg">Room {roomLabels[o.room_id] || "?"} · {o.kind.replaceAll("_"," ")}</strong>
          <p className="text-xs text-slate-500">{new Date(o.created_at).toLocaleString()} · Requested {new Date(o.requested_at).toLocaleString()}</p>
          {o.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{o.notes}</p>}
        </div>
        <div><strong>{format(o.quoted_total,o.currency)}</strong>
          <p className="text-sm text-slate-500">{o.status.replaceAll("_"," ")}</p>
        </div>
      </div>
      <ul className="space-y-1 text-sm">
        {orderLines.filter((line) => line.order_id === o.id).map((line,idx) =>
          <li key={idx} className="flex justify-between gap-4 border-t pt-1">
            <span>{line.quantity} × {line.name_snapshot}</span>
            <span>{format(line.line_total,o.currency)}</span>
          </li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        {(orderTransitions[o.status] || []).map((status) => <button key={status}
          disabled={busy === o.id || !canManageOrders} className={action}
          onClick={() => {
            if (status === "confirmed" && !window.confirm("Have you verified menu availability and the order price with staff?")) return;
            void execute("staff-update-order",o.id,{order_id:o.id,status},`Order ${status.replaceAll("_"," ")}`);
          }}>{status.replaceAll("_"," ")}</button>)}
      </div>
    </article>)}
  </section>;

  if (mode === "bookings") return <section className="space-y-4">
    <h2 className="text-xl font-semibold flex items-center gap-2"><Clock3 className="h-5 w-5" /> Transport and facility requests</h2>
    <p className="text-sm text-amber-900 rounded-xl bg-amber-50 border border-amber-200 p-3">
      Verify operator, price, capacity and time before confirming any taxi, spa, sauna, jacuzzi or gym reservation.
      A guest request is never automatically a confirmed booking.
    </p>
    {!bookings.length && <div className={panel}>No booking requests in the past three days.</div>}
    {bookings.map((b) => <article className={panel + " space-y-3"} key={b.id}>
      <div className="flex gap-3 justify-between flex-wrap">
        <div><strong className="text-lg">Room {roomLabels[b.room_id] || "?"} · {b.kind}</strong>
          <p className="text-sm text-slate-500">{b.party_size} people · Requested {new Date(b.starts_at).toLocaleString()}</p>
          {b.notes && <p className="mt-2 text-sm whitespace-pre-wrap">{b.notes}</p>}
        </div><span className="text-sm font-semibold rounded-full bg-slate-100 px-3 py-2 h-fit">{b.status}</span>
      </div>
      <label className="block space-y-1 text-sm font-semibold">Message to guest (availability, pickup details or reason)
        <textarea rows={2} maxLength={400} className={input}
          value={staffNotes[b.id] ?? b.staff_note ?? ""}
          onChange={(e) => setStaffNotes((old) => ({...old,[b.id]:e.target.value}))} />
      </label>
      <div className="flex gap-2 flex-wrap">
        {(bookingTransitions[b.status] || []).map((status) => <button key={status}
          disabled={busy === b.id || !canReply} className={action}
          onClick={() => {
            if (status === "confirmed" && !window.confirm("Have you confirmed real capacity/driver availability and any charges?")) return;
            void execute("staff-update-booking",b.id,{
              booking_id:b.id,status,staff_note:staffNotes[b.id] ?? b.staff_note ?? "",
            },`Booking ${status}`);
          }}>{status}</button>)}
      </div>
    </article>)}
  </section>;

  if (!canConfigure) return <div className={panel}>Only hotel administrators can publish menu items.</div>;
  return <section className="space-y-5">
    <div>
      <h2 className="text-xl font-semibold">Hotel In-Suite menu editor</h2>
      <p className="text-sm text-slate-500">Add verified items per hotel, including accurate price, currency and allergen information.</p>
    </div>
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(280px,1fr)] gap-5">
      <div className={panel + " space-y-3"}>
        <h3 className="font-semibold">Existing menu items ({catalogItems.length})</h3>
        {!catalogItems.length && <p className="text-sm text-slate-500">No items yet.</p>}
        {catalogItems.map((c) => <button key={c.id} onClick={() => edit(c)}
          className="flex items-center justify-between w-full rounded-xl border p-3 text-left gap-3 hover:bg-slate-50">
          <div><strong>{c.name}</strong>
            <p className="text-xs text-slate-500">{c.kind.replaceAll("_"," ")} · {format(c.price,c.currency)}</p></div>
          <span className={`text-xs shrink-0 rounded-full px-2 py-1 ${c.is_active ? "bg-emerald-100 text-emerald-900" : "bg-slate-100"}`}>
            {c.is_active ? "Guest visible" : "Unpublished"}
          </span>
        </button>)}
      </div>
      <form className={panel + " space-y-3"} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="flex justify-between items-center"><h3 className="font-semibold">{editingId ? "Edit menu item" : "Add menu item"}</h3>
          {editingId && <button type="button" onClick={reset} className="text-sm underline"><Plus className="h-4 w-4 inline" /> New</button>}</div>
        <label className="text-sm font-semibold block">Category
          <select className={input} value={form.kind} onChange={(e) => setForm((old) => ({...old,kind:e.target.value}))}>
            {kinds.map((k) => <option key={k} value={k}>{k.replaceAll("_"," ")}</option>)}
          </select>
        </label>
        {(["name","description","allergens","image_url","price","currency"] as const).map((key) =>
          <label key={key} className="block text-sm font-semibold space-y-1">
            <span>{key.replaceAll("_"," ")}</span>
            <input className={input} value={form[key]}
              type={key === "price" ? "number" : "text"}
              step={key === "price" ? ".01" : undefined}
              min={key === "price" ? "0" : undefined}
              maxLength={key === "image_url" ? 900 : 150}
              onChange={(e) => setForm((old) => ({...old,[key]:e.target.value}))} />
          </label>)}
        <label className="flex gap-2 items-center text-sm font-semibold">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((old) => ({...old,is_active:e.target.checked}))}/>
          Make available to guest tablets
        </label>
        {form.is_active && <p className="rounded-xl p-3 bg-amber-50 text-amber-900 text-xs">
          Please verify this price and allergen details. When this hotel's service category is enabled, the item becomes immediately available on tablets.</p>}
        <button className="rounded-xl bg-slate-900 px-4 py-3 text-white font-semibold disabled:opacity-40"
          disabled={!!busy} type="submit">{busy ? "Saving…" : editingId ? "Save item" : "Create item"}</button>
      </form>
    </div>
  </section>;
}
