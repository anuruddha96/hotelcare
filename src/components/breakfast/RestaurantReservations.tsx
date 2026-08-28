import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Users, Clock, Phone, Gift, MessageSquare, Check, UserX, CloudOff, CloudUpload } from "lucide-react";
import { toast } from "sonner";
import { bbT } from "@/lib/breakfast-translations";

interface Props {
  hotelId: string;
  date: string;
  language: string;
}

interface Reservation {
  id: string;
  guest_name: string;
  guest_phone: string | null;
  party_size: number;
  starts_at: string;
  ends_at: string | null;
  status: string;
  occasion: string | null;
  special_requests: string | null;
  notes: string | null;
  dashboard_sync_state?: string | null;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function RestaurantReservations({ hotelId, date, language }: Props) {
  const tt = (k: string, vars?: Record<string, string | number>) => bbT(language, k, vars);
  const [rows, setRows] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [covers, setCovers] = useState(0);
  const [count, setCount] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("restaurant-reservations-list", {
      body: { hotel_id: hotelId, date },
    });
    setLoading(false);
    if (error || !data) { setRows([]); setCovers(0); setCount(0); return; }
    setRows(data.reservations ?? []);
    setCovers(data.total_covers ?? 0);
    setCount(data.total_reservations ?? 0);
  }, [hotelId, date]);

  useEffect(() => { void load(); }, [load]);

  // Bookings arrive during service — keep the list fresh without a reload.
  useEffect(() => {
    const id = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const mark = async (reservation: Reservation, next: "seated" | "no_show") => {
    // Tapping the active status again clears it back to booked.
    const target = reservation.status === next ? "booked" : next;
    const previous = rows;
    setSaving(reservation.id);
    setRows((rs) => rs.map((r) => (r.id === reservation.id ? { ...r, status: target, dashboard_sync_state: "pending" } : r)));

    const { data, error } = await supabase.functions.invoke("restaurant-reservation-status", {
      body: { reservation_id: reservation.id, status: target },
    });
    setSaving(null);

    if (error || data?.error) {
      setRows(previous);
      toast.error(tt("resStatusFailed"));
      return;
    }
    setRows((rs) => rs.map((r) => (r.id === reservation.id
      ? { ...r, status: data.status, dashboard_sync_state: data.dashboard_sync_state }
      : r)));
    toast.success(tt("resStatusSaved"));
  };

  const active = rows.filter((r) => r.status !== "cancelled");
  const cancelled = rows.filter((r) => r.status === "cancelled");
  const arrivedCount = active.filter((r) => r.status === "seated").length;
  const noShowCount = active.filter((r) => r.status === "no_show").length;


  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-sm">{tt("resTitle")}</div>
          <div className="text-[11px] text-muted-foreground">
            {tt("resSummary", { n: count, covers })}
            {(arrivedCount > 0 || noShowCount > 0) && (
              <> · {tt("resSummaryStatus", { arrived: arrivedCount, noshow: noShowCount })}</>
            )}
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-7" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {active.length === 0 && !loading && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {tt("resEmpty")}
        </div>
      )}

      <div className="space-y-2">
        {active.map((r) => {
          const dim = r.status === "no_show";
          return (
            <div
              key={r.id}
              className={`rounded-lg border p-3 ${dim ? "opacity-60" : ""} ${r.status === "seated" ? "border-emerald-300 bg-emerald-50/60" : "bg-card"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {timeLabel(r.starts_at)}{r.ends_at ? ` – ${timeLabel(r.ends_at)}` : ""}
                  </div>
                  <div className="text-lg font-bold leading-tight truncate">{r.guest_name}</div>
                  {r.guest_phone && (
                    <a href={`tel:${r.guest_phone}`} className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Phone className="h-3 w-3" /> {r.guest_phone}
                    </a>
                  )}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1 rounded-md bg-primary/10 text-primary px-2.5 py-1.5">
                    <Users className="h-4 w-4" />
                    <span className="text-xl font-bold leading-none">{r.party_size}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{tt("resGuests")}</span>
                  {r.status === "seated" && <Badge className="bg-emerald-600 text-[10px]">{tt("resSeated")}</Badge>}
                  {r.status === "no_show" && <Badge variant="secondary" className="text-[10px]">{tt("resNoShow")}</Badge>}
                </div>
              </div>
              {(r.occasion || r.special_requests || r.notes) && (
                <div className="mt-2 pt-2 border-t space-y-1 text-xs">
                  {r.occasion && (
                    <div className="flex items-start gap-1.5"><Gift className="h-3 w-3 mt-0.5 shrink-0" />{r.occasion}</div>
                  )}
                  {(r.special_requests || r.notes) && (
                    <div className="flex items-start gap-1.5">
                      <MessageSquare className="h-3 w-3 mt-0.5 shrink-0" />
                      <span className="whitespace-pre-wrap">{[r.special_requests, r.notes].filter(Boolean).join(" · ")}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {cancelled.length > 0 && (
        <div className="pt-2 border-t space-y-1">
          <div className="text-[11px] text-muted-foreground">{tt("resCancelled")}</div>
          {cancelled.map((r) => (
            <div key={r.id} className="text-xs text-muted-foreground line-through flex items-center gap-2">
              <span>{timeLabel(r.starts_at)}</span>
              <span className="font-medium">{r.guest_name}</span>
              <span>· {r.party_size}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
