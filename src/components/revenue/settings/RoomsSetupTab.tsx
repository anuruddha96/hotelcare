import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import PrevioRatePlanMapping from "@/components/revenue/PrevioRatePlanMapping";

interface Room {
  id: string;
  name: string;
  pms_room_id: string | null;
  pms_rate_id: string | null;
  num_rooms: number;
  is_reference: boolean;
  derivation_mode: "percent" | "absolute";
  derivation_value: number;
  base_price_eur: number;
  min_price_eur: number;
  max_price_eur: number;
  sort_order: number;
}

export default function RoomsSetupTab({ hotelId, orgSlug }: { hotelId: string; orgSlug: string }) {
  const [rows, setRows] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { void load(); }, [hotelId]);

  async function load() {
    setLoading(true);
    const { data, error } = await (supabase as any).from("room_types")
      .select("*").eq("hotel_id", hotelId).order("sort_order").order("created_at");
    if (error) toast.error(error.message);
    setRows((data ?? []) as Room[]);
    setLoading(false);
  }

  async function addRoom() {
    const { error } = await (supabase as any).from("room_types").insert({
      hotel_id: hotelId, organization_slug: orgSlug,
      name: `Room type ${rows.length + 1}`,
      num_rooms: 1, is_reference: rows.length === 0,
      derivation_mode: "percent", derivation_value: 0,
      base_price_eur: 100, min_price_eur: 60, max_price_eur: 400,
      sort_order: rows.length,
    });
    if (error) { toast.error(error.message); return; }
    void load();
  }

  async function update(id: string, patch: Partial<Room>) {
    setBusy(id);
    const { error } = await (supabase as any).from("room_types").update(patch).eq("id", id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
  }

  async function setReference(id: string) {
    // Only one reference room
    setBusy(id);
    await (supabase as any).from("room_types").update({ is_reference: false }).eq("hotel_id", hotelId);
    await (supabase as any).from("room_types").update({ is_reference: true }).eq("id", id);
    setBusy(null);
    void load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this room type?")) return;
    const { error } = await (supabase as any).from("room_types").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    void load();
  }

  const totalRooms = rows.reduce((s, r) => s + (r.num_rooms || 0), 0);

  return (
    <div className="space-y-3">
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Rooms Setup</CardTitle>
        <Button size="sm" onClick={addRoom}><Plus className="h-4 w-4 mr-1" />Add room type</Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>PMS Room</TableHead>
                <TableHead>PMS Rate</TableHead>
                <TableHead className="text-right"># Rooms</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Derivation</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Base €</TableHead>
                <TableHead className="text-right">Min €</TableHead>
                <TableHead className="text-right">Max €</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} className={busy === r.id ? "opacity-60" : ""}>
                  <TableCell><Input value={r.name} onChange={e => update(r.id, { name: e.target.value })} className="h-8 min-w-[140px]" /></TableCell>
                  <TableCell><Input value={r.pms_room_id ?? ""} onChange={e => update(r.id, { pms_room_id: e.target.value })} className="h-8 w-24" /></TableCell>
                  <TableCell><Input value={r.pms_rate_id ?? ""} onChange={e => update(r.id, { pms_rate_id: e.target.value })} className="h-8 w-24" /></TableCell>
                  <TableCell className="text-right"><Input type="number" min={0} value={r.num_rooms} onChange={e => update(r.id, { num_rooms: parseInt(e.target.value) || 0 })} className="h-8 w-20 text-right" /></TableCell>
                  <TableCell><Switch checked={r.is_reference} onCheckedChange={() => !r.is_reference && setReference(r.id)} /></TableCell>
                  <TableCell>
                    <Select value={r.derivation_mode} onValueChange={v => update(r.id, { derivation_mode: v as any })} disabled={r.is_reference}>
                      <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percent">Percent</SelectItem>
                        <SelectItem value="absolute">Absolute €</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <Input type="number" value={r.derivation_value} onChange={e => update(r.id, { derivation_value: parseFloat(e.target.value) || 0 })}
                      className="h-8 w-20 text-right" disabled={r.is_reference} />
                  </TableCell>
                  <TableCell className="text-right"><Input type="number" value={r.base_price_eur} onChange={e => update(r.id, { base_price_eur: parseFloat(e.target.value) || 0 })} className="h-8 w-24 text-right" /></TableCell>
                  <TableCell className="text-right"><Input type="number" value={r.min_price_eur} onChange={e => update(r.id, { min_price_eur: parseFloat(e.target.value) || 0 })} className="h-8 w-20 text-right" /></TableCell>
                  <TableCell className="text-right"><Input type="number" value={r.max_price_eur} onChange={e => update(r.id, { max_price_eur: parseFloat(e.target.value) || 0 })} className="h-8 w-20 text-right" /></TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-6">No room types yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
        {rows.length > 0 && (
          <div className="mt-3 text-sm text-muted-foreground">Total rooms: <b className="text-foreground">{totalRooms}</b></div>
        )}
      </CardContent>
    </Card>
    <PrevioRatePlanMapping hotelId={hotelId} orgSlug={orgSlug} />
    </div>
  );
}
