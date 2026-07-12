import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ShieldOff, Loader2 } from "lucide-react";

// Ordered activation stages. Each flag maps 1:1 to a pms_configurations column.
const STAGES: Array<{
  key:
    | "connection_test_enabled"
    | "room_discovery_enabled"
    | "room_import_enabled"
    | "snapshot_read_enabled"
    | "snapshot_shadow_mode"
    | "status_push_enabled"
    | "checkout_poll_enabled"
    | "nightly_sync_enabled";
  label: string;
  hint: string;
  risky?: boolean;
}> = [
  { key: "connection_test_enabled", label: "1. Connection test",       hint: "Allow the credential-test edge function to talk to Previo." },
  { key: "room_discovery_enabled",  label: "2. Room discovery",        hint: "Allow reading the Previo room list (read-only)." },
  { key: "room_import_enabled",     label: "3. Room import",           hint: "Allow upserting into rooms + pms_room_mappings.", risky: true },
  { key: "snapshot_read_enabled",   label: "4. Snapshot read",         hint: "Allow reading daily reservation snapshots." },
  { key: "snapshot_shadow_mode",    label: "5. Snapshot shadow mode",  hint: "Record diff events without applying (safe pre-flight)." },
  { key: "status_push_enabled",     label: "6. Outbound status push",  hint: "Allow pushing housekeeping status changes back to Previo.", risky: true },
  { key: "checkout_poll_enabled",   label: "7. Checkout polling",      hint: "Enable the periodic checkout probe." },
  { key: "nightly_sync_enabled",    label: "8. Nightly full sync",     hint: "Enable the scheduled overnight full reconciliation.", risky: true },
];

interface Props { hotelId: string }

export function PMSActivationChecklist({ hotelId }: Props) {
  const [cfg, setCfg] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = async () => {
    if (!hotelId) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("pms_configurations")
      .select("id, hotel_id, environment, outbound_kill_switch, outbound_room_allowlist, " +
              STAGES.map((s) => s.key).join(","))
      .eq("hotel_id", hotelId)
      .eq("pms_type", "previo")
      .maybeSingle();
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setCfg(data);
  };

  useEffect(() => { void load(); }, [hotelId]);

  const setFlag = async (key: string, next: boolean) => {
    if (!cfg?.id) return;
    setBusyKey(key);
    const { error } = await (supabase as any)
      .from("pms_configurations")
      .update({ [key]: next })
      .eq("id", cfg.id);
    setBusyKey(null);
    if (error) { toast.error(error.message); return; }
    setCfg({ ...cfg, [key]: next });
    toast.success(`${key} → ${next ? "on" : "off"}`);
  };

  const setKillSwitch = async (next: boolean) => {
    if (!cfg?.id) return;
    setBusyKey("kill");
    const { error } = await (supabase as any)
      .from("pms_configurations")
      .update({ outbound_kill_switch: next })
      .eq("id", cfg.id);
    setBusyKey(null);
    if (error) { toast.error(error.message); return; }
    setCfg({ ...cfg, outbound_kill_switch: next });
    toast[next ? "warning" : "success"](`Kill-switch ${next ? "ENGAGED" : "released"}`);
  };

  if (!hotelId) return null;

  const allowlistCount = Array.isArray(cfg?.outbound_room_allowlist) ? cfg.outbound_room_allowlist.length : 0;
  const killed = cfg?.outbound_kill_switch === true;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          Activation checklist
          {cfg?.environment && <Badge variant="outline" className="uppercase text-[10px]">{cfg.environment}</Badge>}
          {killed && <Badge variant="destructive" className="gap-1"><ShieldOff className="h-3 w-3" /> Kill-switch on</Badge>}
        </CardTitle>
        <CardDescription>
          Enable each stage one at a time. Risky stages (import, outbound push, nightly sync) are highlighted.
          The kill-switch below immediately halts all outbound pushes regardless of stage flags.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        {!loading && !cfg && <div className="text-sm text-muted-foreground">No PMS configuration row for this hotel.</div>}
        {cfg && (
          <>
            <div className="rounded-md border p-3 bg-muted/30 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium flex items-center gap-2">
                  <ShieldOff className="h-4 w-4" /> Outbound kill-switch
                </div>
                <div className="text-xs text-muted-foreground">
                  When ON, no housekeeping status is ever pushed to Previo, and the outbound queue trigger is inert. Independent of stage flags.
                </div>
              </div>
              <Switch checked={killed} disabled={busyKey === "kill"} onCheckedChange={setKillSwitch} />
            </div>

            <div className="text-xs text-muted-foreground">
              Outbound allowlist: <strong>{allowlistCount}</strong> room{allowlistCount === 1 ? "" : "s"}. Empty means outbound push is blocked for every room even when all stage flags are on.
            </div>

            <div className="space-y-2">
              {STAGES.map((s) => {
                const on = !!cfg[s.key];
                return (
                  <div key={s.key} className={`rounded-md border p-3 flex items-start justify-between gap-3 ${s.risky ? "border-amber-500/40 bg-amber-500/5" : ""}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium flex items-center gap-2">
                        {on ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 text-muted-foreground" />}
                        {s.label}
                        {s.risky && <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-400">Risky</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{s.hint}</div>
                    </div>
                    <Switch checked={on} disabled={busyKey === s.key} onCheckedChange={(v) => setFlag(s.key, v)} />
                  </div>
                );
              })}
            </div>

            <div className="pt-1">
              <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>Refresh</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
