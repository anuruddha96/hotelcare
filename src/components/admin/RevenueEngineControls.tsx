import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Gauge, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Config = {
  automation_enabled: boolean;
  engine_tick_enabled: boolean;
  dry_run: boolean;
  pause_reason: string | null;
  updated_at: string;
};

/**
 * Master brake for Revenue Management. Automation and the alert engine are the
 * heaviest background writers in the app, so an admin can pause them (or run
 * them in calculate-only mode) without a deploy when the database is under load.
 */
type Health = {
  enabled: number;
  lastSuccess: string | null;
  nextHotel: string | null;
  nextDue: string | null;
  publisherBusy: boolean;
  queued: number;
};

const EMPTY_HEALTH: Health = {
  enabled: 0, lastSuccess: null, nextHotel: null, nextDue: null,
  publisherBusy: false, queued: 0,
};

export default function RevenueEngineControls() {
  const [config, setConfig] = useState<Config | null>(null);
  const [health, setHealth] = useState<Health>(EMPTY_HEALTH);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Three cheap reads, no realtime subscription: the state of the brake, the
    // schedule of the enabled properties and whether the publisher holds the
    // global lease right now.
    const [{ data }, { data: rules }, { count }] = await Promise.all([
      supabase
        .from("revenue_engine_config")
        .select("automation_enabled, engine_tick_enabled, dry_run, pause_reason, updated_at, publisher_lock_hotel, publisher_lock_token")
        .eq("id", "global")
        .maybeSingle(),
      supabase
        .from("revenue_pickup_automation_rules")
        .select("hotel_id, next_run_at, last_successful_evaluation_at")
        .eq("is_enabled", true)
        .order("next_run_at", { ascending: true, nullsFirst: true })
        .limit(50),
      supabase
        .from("revenue_rate_push_runs")
        .select("id", { count: "exact", head: true })
        .in("status", ["queued", "processing"]),
    ]);
    setConfig((data as Config) ?? null);
    const list = (rules ?? []) as Array<{ hotel_id: string; next_run_at: string | null; last_successful_evaluation_at: string | null }>;
    const lastSuccess = list
      .map((r) => r.last_successful_evaluation_at)
      .filter(Boolean)
      .sort()
      .pop() ?? null;
    const next = list.find((r) => r.next_run_at) ?? null;
    setHealth({
      enabled: list.length,
      lastSuccess,
      nextHotel: next?.hotel_id ?? null,
      nextDue: next?.next_run_at ?? null,
      publisherBusy: Boolean((data as any)?.publisher_lock_token),
      queued: count ?? 0,
    });
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = async (field: keyof Config, value: boolean) => {
    if (!config) return;
    setSaving(field);
    const { error } = await supabase
      .from("revenue_engine_config")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", "global");
    setSaving(null);
    if (error) { toast.error("Could not save — admin access is required"); return; }
    setConfig({ ...config, [field]: value });
    toast.success("Saved");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="w-5 h-5" />
              Revenue automation
            </CardTitle>
            <CardDescription>
              Pause price automation for every hotel when the database is under load.
            </CardDescription>
          </div>
          {config && (
            <Badge variant={config.automation_enabled ? "default" : "secondary"}>
              {config.automation_enabled ? (config.dry_run ? "Calculate only" : "Live") : "Paused"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : !config ? (
          <p className="text-sm text-muted-foreground">Settings unavailable.</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="rm-automation">Automation scheduler</Label>
                <p className="text-xs text-muted-foreground">
                  Polls every 10 minutes and evaluates one property at a time, each at its own
                  interval (normally 60 minutes). Off means no pickup increases or markdowns anywhere.
                </p>
              </div>
              <Switch
                id="rm-automation"
                checked={config.automation_enabled}
                disabled={saving !== null}
                onCheckedChange={(v) => update("automation_enabled", v)}
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="rm-dry">Calculate only (no publishing)</Label>
                <p className="text-xs text-muted-foreground">
                  {config.dry_run
                    ? "On: decisions are recorded for review and nothing is sent to Previo."
                    : "Off: approved decisions are queued and published to Previo, one property at a time."}
                </p>
              </div>
              <Switch
                id="rm-dry"
                checked={config.dry_run}
                disabled={saving !== null || !config.automation_enabled}
                onCheckedChange={(v) => update("dry_run", v)}
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="rm-engine">Hourly PMS data sync</Label>
                <p className="text-xs text-muted-foreground">
                  Read-only: pulls Previo revenue and daily overview data and purges old logs.
                  It never changes or publishes a price.
                </p>
              </div>
              <Switch
                id="rm-engine"
                checked={config.engine_tick_enabled}
                disabled={saving !== null}
                onCheckedChange={(v) => update("engine_tick_enabled", v)}
              />
            </div>

            <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Health</p>
              <p>
                Enabled properties: {health.enabled}
                {health.lastSuccess ? ` · last successful evaluation ${new Date(health.lastSuccess).toLocaleString()}` : " · no evaluation completed yet"}
              </p>
              <p>
                {health.nextHotel
                  ? `Next due: ${health.nextHotel} at ${new Date(health.nextDue as string).toLocaleString()}`
                  : "Next due: nothing scheduled"}
              </p>
              <p>
                Publisher: {health.publisherBusy ? "publishing now" : "idle"} · queued runs: {health.queued}
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                Last change {new Date(config.updated_at).toLocaleString()}
                {config.pause_reason ? ` · ${config.pause_reason}` : ""}
              </p>
              <Button variant="ghost" size="sm" onClick={() => void load()}>Refresh</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
