import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

export type Slot = { key: string | number; label: string };

interface Props {
  hotelId: string;
  orgSlug: string;
  table: "dow_adjustments" | "monthly_adjustments" | "lead_time_adjustments";
  keyColumn: "dow" | "month" | "bucket";
  slots: Slot[];
  title: string;
  description?: string;
}

export default function PercentAdjustmentTab({ hotelId, orgSlug, table, keyColumn, slots, title, description }: Props) {
  const [values, setValues] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { void load(); }, [hotelId, table]);

  async function load() {
    setLoading(true);
    const { data, error } = await (supabase as any).from(table)
      .select(`${keyColumn},percent`).eq("hotel_id", hotelId);
    if (error) toast.error(error.message);
    const map: Record<string, number> = {};
    for (const s of slots) map[String(s.key)] = 0;
    for (const row of data ?? []) map[String((row as any)[keyColumn])] = Number(row.percent) || 0;
    setValues(map);
    setLoading(false);
  }

  async function save(key: string | number, percent: number) {
    setValues(v => ({ ...v, [String(key)]: percent }));
    const payload: any = { hotel_id: hotelId, organization_slug: orgSlug, percent };
    payload[keyColumn] = key;
    const { error } = await (supabase as any).from(table)
      .upsert(payload, { onConflict: `hotel_id,${keyColumn}` });
    if (error) toast.error(error.message);
  }

  const chartData = slots.map(s => ({ name: s.label, percent: values[String(s.key)] ?? 0 }));

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
          <>
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(slots.length, 6)}, minmax(0, 1fr))` }}>
              {slots.map(s => (
                <div key={String(s.key)} className="space-y-1">
                  <Label className="text-xs">{s.label}</Label>
                  <div className="flex items-center">
                    <Input type="number" step="0.5" value={values[String(s.key)] ?? 0}
                      onChange={e => save(s.key, parseFloat(e.target.value) || 0)} className="h-9 text-right pr-6" />
                    <span className="-ml-6 text-muted-foreground text-sm">%</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v: any) => `${v}%`} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                  <Bar dataKey="percent" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
