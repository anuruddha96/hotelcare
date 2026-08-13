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
export default function RevenueEngineControls() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("revenue_engine_config")
      .select("automation_enabled, engine_tick_enabled, dry_run, pause_reason, updated_at")
      .eq("id", "global")
      .maybeSingle();
    setConfig((data as Config) ?? null);
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
                <Label htmlFor="rm-automation">Price automation</Label>
                <p className="text-xs text-muted-foreground">
                  Runs every 30 minutes. Off means no pickup increases or markdowns anywhere.
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
                  Decisions are recorded for review, but no price is sent to Previo.
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
                <Label htmlFor="rm-engine">Hourly data sync &amp; alert engine</Label>
                <p className="text-xs text-muted-foreground">
                  Pulls Previo revenue and daily overview data. Off pauses those pulls.
                </p>
              </div>
              <Switch
                id="rm-engine"
                checked={config.engine_tick_enabled}
                disabled={saving !== null}
                onCheckedChange={(v) => update("engine_tick_enabled", v)}
              />
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
