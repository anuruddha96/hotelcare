import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BellRing, AlertTriangle, Check } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

type Alert = {
  id: string;
  star_rating: number;
  google_location_id: string;
  review_excerpt?: string | null;
  detected_at: string;
  google_business_locations?: { reply_brand_name?: string; google_location_title?: string } | null;
};

export function ReputationAlertsBell() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [total, setTotal] = useState(0);
  const [working, setWorking] = useState<string | null>(null);
  const previousTotal = useRef<number | null>(null);
  const role = profile?.role || "";
  const enabled = profile?.organization_slug === "rdhotels" &&
    (!!profile?.is_super_admin || ["admin", "manager", "top_management", "top_management_manager"].includes(role));

  const load = async () => {
    if (!enabled) return;
    try {
      const { data, error } = await supabase.functions.invoke("google-reputation", {
        body: { action: "alert_summary", organization_slug: "rdhotels" },
      });
      if (error || data?.error) throw error || new Error(data.error);
      const nextTotal = Number(data?.total || 0);
      if (previousTotal.current !== null && nextTotal > previousTotal.current) {
        toast.warning(`${nextTotal - previousTotal.current} new low-rating Google review alert(s)`, {
          description: "Open Reputation to review and respond to 1–3-star feedback.",
        });
      }
      previousTotal.current = nextTotal;
      setTotal(nextTotal);
      setAlerts(data?.alerts || []);
    } catch {
      // Network interruptions should not block the global HotelCare header.
    }
  };

  useEffect(() => {
    if (!enabled) return;
    void load();
    const timer = setInterval(() => void load(), 90_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, profile?.organization_slug]);

  const acknowledge = async (id: string) => {
    setWorking(id);
    try {
      const { data, error } = await supabase.functions.invoke("google-reputation", {
        body: { action: "acknowledge_low_rating_alert", organization_slug: "rdhotels", alert_id: id },
      });
      if (error || data?.error) throw error || new Error(data.error);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not acknowledge alert");
    } finally {
      setWorking(null);
    }
  };

  if (!enabled) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9 shrink-0"
          aria-label={total ? `${total} Google low-rating alerts` : "Google review alerts"}>
          <BellRing className={`h-4 w-4 ${total ? "text-amber-600" : "text-muted-foreground"}`} />
          {total > 0 && <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] bg-red-600 text-white">
            {total > 99 ? "99+" : total}
          </Badge>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(92vw,370px)] space-y-1 p-2">
        <DropdownMenuLabel className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" />Google review attention</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {alerts.length ? alerts.map((alert) => (
          <div key={alert.id} className="rounded-md border p-2 space-y-2">
            <button type="button" className="text-left w-full" onClick={() =>
              navigate(`/rdhotels/reputation?tab=attention&venue=${encodeURIComponent(alert.google_location_id)}`)}>
              <div className="text-sm font-medium">
                {alert.star_rating}★ · {alert.google_business_locations?.reply_brand_name ||
                  alert.google_business_locations?.google_location_title || "Google business"}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{alert.review_excerpt || "Rating only — manager response needed"}</p>
            </button>
            <Button size="sm" variant="outline" disabled={working === alert.id}
              onClick={() => void acknowledge(alert.id)}>
              <Check className="h-3 w-3 mr-1" />Acknowledge
            </Button>
          </div>
        )) : <p className="text-sm text-muted-foreground px-2 py-4">No new 1–3-star alerts.</p>}
        <DropdownMenuSeparator />
        <Button variant="outline" className="w-full" size="sm" onClick={() =>
          navigate("/rdhotels/reputation?tab=attention")}>Open reputation inbox</Button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
