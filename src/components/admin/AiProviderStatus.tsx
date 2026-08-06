import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BrainCircuit } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface RunRow {
  status: string; model: string | null; created_at: string; error: string | null;
  total_tokens: number; estimated_cost_usd: number; hotel_id: string;
}

/** Read-only OpenAI provider health for the admin area. Never shows the secret. */
export default function AiProviderStatus() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("rm_analysis_runs")
        .select("status, model, created_at, error, total_tokens, estimated_cost_usd, hotel_id")
        .order("created_at", { ascending: false }).limit(200);
      setRuns((data ?? []) as RunRow[]);
      setLoading(false);
    })();
  }, []);

  const lastOk = runs.find((r) => r.status === "ok") ?? null;
  const lastFail = runs.find((r) => r.status !== "ok") ?? null;
  const configured = runs.length === 0 ? null : Boolean(lastOk) || !lastFail?.error?.toLowerCase().includes("not configured");
  const tokens = runs.reduce((s, r) => s + (r.total_tokens || 0), 0);
  const cost = runs.reduce((s, r) => s + Number(r.estimated_cost_usd || 0), 0);

  const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BrainCircuit className="h-4 w-4 text-primary" /> AI provider
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {loading ? (
          <p className="text-muted-foreground">Loading provider status…</p>
        ) : (
          <>
            <Row label="Provider" value="OpenAI API (your own account and key)" />
            <Row
              label="Status"
              value={
                <Badge variant={configured === false ? "destructive" : "secondary"} className="font-normal">
                  {configured === false ? "Configuration error" : configured === null ? "No analysis yet" : "Connected"}
                </Badge>
              }
            />
            <Row label="Model" value={lastOk?.model ?? lastFail?.model ?? "set by OPENAI_MODEL"} />
            <Row label="Last successful analysis" value={fmt(lastOk?.created_at)} />
            <Row label="Last failed analysis" value={lastFail ? `${fmt(lastFail.created_at)} — ${lastFail.error ?? "unknown error"}` : "None"} />
            <Row label="Token usage (last 200 runs)" value={tokens.toLocaleString()} />
            <Row label="Estimated API cost" value={`$${cost.toFixed(4)}`} />
            <p className="text-[11px] text-muted-foreground pt-1">
              The API key is stored server-side only and is never sent to the browser or written to the database.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 last:border-b-0">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}
