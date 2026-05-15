import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";

interface RoomType { id: string; name: string; }
interface Mapping {
  id?: string;
  room_type_id: string;
  previo_rate_plan_id: string | null;
  previo_room_type_id: string | null;
  is_default: boolean;
}

export default function PrevioRatePlanMapping({ hotelId, orgSlug }: { hotelId: string; orgSlug: string }) {
  const [rooms, setRooms] = useState<RoomType[]>([]);
  const [maps, setMaps] = useState<Record<string, Mapping>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { void load(); }, [hotelId]);

  async function load() {
    setLoading(true);
    const [{ data: rt }, { data: m }] = await Promise.all([
      (supabase as any).from("room_types").select("id,name").eq("hotel_id", hotelId).order("sort_order"),
      (supabase as any).from("previo_rate_plan_mapping").select("*").eq("hotel_id", hotelId),
    ]);
    setRooms((rt ?? []) as RoomType[]);
    const byRoom: Record<string, Mapping> = {};
    for (const row of (m ?? []) as Mapping[]) byRoom[row.room_type_id] = row;
    setMaps(byRoom);
    setLoading(false);
  }

  async function save(roomTypeId: string, patch: Partial<Mapping>) {
    const existing = maps[roomTypeId];
    const next: Mapping = {
      ...(existing ?? { room_type_id: roomTypeId, previo_rate_plan_id: null, previo_room_type_id: null, is_default: false }),
      ...patch,
    };
    setMaps(s => ({ ...s, [roomTypeId]: next }));
    if (existing?.id) {
      const { error } = await (supabase as any).from("previo_rate_plan_mapping").update(patch).eq("id", existing.id);
      if (error) toast.error(error.message);
    } else {
      const { data, error } = await (supabase as any).from("previo_rate_plan_mapping")
        .insert({ hotel_id: hotelId, organization_slug: orgSlug, ...next })
        .select().single();
      if (error) { toast.error(error.message); return; }
      setMaps(s => ({ ...s, [roomTypeId]: data as Mapping }));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <LinkIcon className="h-4 w-4" /> Previo rate-plan mapping
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Connect each room type to the matching Previo room-type ID and rate-plan ID. Required before "Push to Previo" can send rate updates.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : rooms.length === 0 ? (
          <div className="text-sm text-muted-foreground">Add room types first.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Room type</TableHead>
                <TableHead>Previo room-type ID</TableHead>
                <TableHead>Previo rate-plan ID</TableHead>
                <TableHead className="w-20 text-center">Default</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rooms.map(r => {
                const m = maps[r.id];
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>
                      <Input className="h-8" value={m?.previo_room_type_id ?? ""}
                        onChange={e => save(r.id, { previo_room_type_id: e.target.value || null })}
                        placeholder="e.g. 12345" />
                    </TableCell>
                    <TableCell>
                      <Input className="h-8" value={m?.previo_rate_plan_id ?? ""}
                        onChange={e => save(r.id, { previo_rate_plan_id: e.target.value || null })}
                        placeholder="e.g. STD" />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch checked={!!m?.is_default} onCheckedChange={v => save(r.id, { is_default: v })} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
