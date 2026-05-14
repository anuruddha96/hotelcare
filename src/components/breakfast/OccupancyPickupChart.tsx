import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";

interface Props {
  hotelId: string;
  days?: number;
}

interface Point {
  d: string;
  occ: number;
  pickup: number;
  rooms_sold: number;
}

export default function OccupancyPickupChart({ hotelId, days = 14 }: Props) {
  const [data, setData] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const today = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

      const [{ data: occ }, { data: pickup }] = await Promise.all([
        supabase
          .from("occupancy_snapshots")
          .select("stay_date, occupancy_pct, rooms_sold, captured_at")
          .eq("hotel_id", hotelId)
          .gte("stay_date", today)
          .lte("stay_date", end)
          .order("captured_at", { ascending: false }),
        supabase
          .from("pickup_snapshots")
          .select("stay_date, delta, captured_at")
          .eq("hotel_id", hotelId)
          .gte("stay_date", today)
          .lte("stay_date", end)
          .order("captured_at", { ascending: false }),
      ]);
      if (cancel) return;

      // Latest occupancy per stay_date
      const occMap = new Map<string, { occ: number; rooms_sold: number }>();
      (occ ?? []).forEach((r: any) => {
        if (!occMap.has(r.stay_date)) {
          occMap.set(r.stay_date, { occ: Number(r.occupancy_pct) || 0, rooms_sold: r.rooms_sold || 0 });
        }
      });
      // Sum pickup deltas per stay_date (capture window)
      const pickupMap = new Map<string, number>();
      (pickup ?? []).forEach((r: any) => {
        pickupMap.set(r.stay_date, (pickupMap.get(r.stay_date) || 0) + (Number(r.delta) || 0));
      });

      const dates: Point[] = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
        const o = occMap.get(d);
        dates.push({
          d: d.slice(5),
          occ: o?.occ ?? 0,
          rooms_sold: o?.rooms_sold ?? 0,
          pickup: pickupMap.get(d) || 0,
        });
      }
      setData(dates);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [hotelId, days]);

  const hasData = data.some((p) => p.occ > 0 || p.pickup > 0);
  if (!loading && !hasData) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4" /> Occupancy & Pickup · next {days}d
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="h-[180px] w-full">
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="d" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip wrapperStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="right" dataKey="pickup" name="Pickup" fill="hsl(var(--primary))" />
              <Line yAxisId="left" type="monotone" dataKey="occ" name="Occupancy %" stroke="hsl(var(--chart-2, 142 71% 45%))" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
