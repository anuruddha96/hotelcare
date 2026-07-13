import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { PmsChangesDrawer } from "@/components/pms/PmsChangesDrawer";
import { RefreshCw, Upload, Eye, ShieldOff, Loader2, ClipboardCheck, CheckCircle2 } from "lucide-react";
import { PmsRefreshPreviewDialog } from "@/components/pms/PmsRefreshPreviewDialog";
import { useAuth } from "@/hooks/useAuth";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";


interface Props {
  /** Manager's assigned_hotel (may be hotel_id or hotel name — component
   *  looks up the config either way). */
  hotelId: string;
  /** Anchor id to scroll the existing XLSX uploader into view. */
  uploadAnchorId?: string;
}

interface Cfg {
  id: string;
  hotel_id: string;
  environment: string | null;
  snapshot_read_enabled: boolean;
  status_push_enabled: boolean;
  outbound_kill_switch: boolean;
  connection_mode: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
}

export function PmsSyncControls({ hotelId, uploadAnchorId }: Props) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "top_management";
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [pendingRisky, setPendingRisky] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [successPulse, setSuccessPulse] = useState(false);
  const [confirmReSyncOpen, setConfirmReSyncOpen] = useState(false);
  const [lastSyncMeta, setLastSyncMeta] = useState<{ at: string; by: string | null } | null>(null);


  const loadCfg = async () => {
    if (!hotelId) return;
    const { data } = await (supabase as any)
      .from("pms_configurations")
      .select("id, hotel_id, environment, snapshot_read_enabled, status_push_enabled, outbound_kill_switch, connection_mode, last_sync_at, last_sync_status")
      .eq("pms_type", "previo")
      .or(`hotel_id.eq.${hotelId},hotel_id.eq.${hotelId.toLowerCase().replace(/\s+/g, "-")}`)
      .maybeSingle();
    setCfg((data as Cfg) ?? null);
  };

  const loadPending = async (h: string) => {
    const { count } = await (supabase as any)
      .from("pms_change_events")
      .select("id", { count: "exact", head: true })
      .eq("hotel_id", h)
      .eq("category", "risky")
      .is("acknowledged_at", null);
    setPendingRisky(count ?? 0);
  };

  useEffect(() => { void loadCfg(); }, [hotelId]);
  useEffect(() => { if (cfg?.hotel_id) void loadPending(cfg.hotel_id); }, [cfg?.hotel_id]);

  // If no PMS config exists for this hotel, render nothing (no disruption).
  if (!cfg) return null;

  const canSyncFromPms = cfg.snapshot_read_enabled === true;
  const killed = cfg.outbound_kill_switch === true;

  const doSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("previo-sync-daily-overview", {
        body: { hotelId: cfg.hotel_id },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("✨ PMS sync completed", { description: "Room list is now up to date." });
      setSuccessPulse(true);
      setTimeout(() => setSuccessPulse(false), 1400);
      await loadCfg();
      await loadPending(cfg.hotel_id);
    } catch (e) {
      toast.error(`Sync failed: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const runSync = async () => {
    if (!canSyncFromPms) return;
    // Re-sync guard: if the last sync happened less than 10 min ago, show a
    // confirmation so managers don't hammer the PMS by accident.
    if (cfg.last_sync_at) {
      const ageMs = Date.now() - new Date(cfg.last_sync_at).getTime();
      if (ageMs < 10 * 60 * 1000) {
        // Fetch the last sync history row (best-effort) so we can show who
        // triggered it. Non-blocking on failure.
        try {
          const { data: last } = await (supabase as any)
            .from("pms_sync_history")
            .select("created_at, synced_by_name")
            .eq("hotel_id", cfg.hotel_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          setLastSyncMeta({
            at: (last?.created_at as string) || cfg.last_sync_at,
            by: (last?.synced_by_name as string) || null,
          });
        } catch { setLastSyncMeta({ at: cfg.last_sync_at, by: null }); }
        setConfirmReSyncOpen(true);
        return;
      }
    }
    await doSync();
  };


  const scrollToUpload = () => {
    if (!uploadAnchorId) return;
    document.getElementById(uploadAnchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const healthDot =
    cfg.last_sync_status === "error" ? "bg-destructive" :
    pendingRisky > 0                  ? "bg-amber-500" :
    "bg-emerald-500";

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className={`inline-block h-2 w-2 rounded-full ${healthDot}`} />
            PMS sync
            {cfg.environment && <Badge variant="outline" className="text-[10px] uppercase">{cfg.environment}</Badge>}
            {killed && isAdmin && <Badge variant="destructive" className="gap-1 text-[10px]"><ShieldOff className="h-3 w-3" /> Kill-switch</Badge>}

            {pendingRisky > 0 && (
              <Badge variant="destructive" className="text-[10px] ml-auto">{pendingRisky} need approval</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            {cfg.last_sync_at
              ? <>Last sync: {formatDistanceToNow(new Date(cfg.last_sync_at))} ago · {cfg.last_sync_status ?? "ok"}</>
              : <>No sync yet.</>}
            {cfg.connection_mode && <> · Mode: {cfg.connection_mode}</>}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={runSync}
              disabled={!canSyncFromPms || syncing}
              title={canSyncFromPms ? "Pull the latest daily overview from Previo" : "Enable Snapshot read in the admin activation checklist first"}
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Sync overview
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPreviewOpen(true)}
              disabled={killed}
              title="Preview every room's PMS state (including tomorrow's checkouts) before applying"
            >
              <ClipboardCheck className="h-4 w-4 mr-1" /> Refresh rooms…
            </Button>
            {uploadAnchorId && (
              <Button size="sm" variant="outline" onClick={scrollToUpload}>
                <Upload className="h-4 w-4 mr-1" /> Upload XLSX
              </Button>
            )}
            <Button
              size="sm"
              variant={pendingRisky > 0 ? "secondary" : "ghost"}
              onClick={() => setDrawerOpen(true)}
            >
              <Eye className="h-4 w-4 mr-1" /> Preview differences
              {pendingRisky > 0 && <span className="ml-1 text-xs">({pendingRisky})</span>}
            </Button>
          </div>
        </CardContent>
      </Card>

      <PmsChangesDrawer hotelId={cfg.hotel_id} open={drawerOpen} onOpenChange={setDrawerOpen} />
      <PmsRefreshPreviewDialog
        hotelId={cfg.hotel_id}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onApplied={() => { void loadCfg(); void loadPending(cfg.hotel_id); }}
      />
    </>
  );
}
