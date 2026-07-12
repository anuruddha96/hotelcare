import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Suggestion {
  previo_room_id: string;
  previo_room_name: string;
  room_number: string;
  room_type: string;
  room_category: string | null;
  floor: number | null;
  capacity: number | null;
  reasoning?: string;
}

interface Props {
  hotelId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onApplied?: () => void;
}

export function AIRoomImportDialog({ hotelId, open, onOpenChange, onApplied }: Props) {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [rows, setRows] = useState<Suggestion[]>([]);

  const fetchSuggestions = async () => {
    setLoading(true);
    setRows([]);
    try {
      const { data, error } = await supabase.functions.invoke("previo-ai-import-rooms", {
        body: { hotelId },
      });
      if (error || (data as any)?.success === false) {
        throw new Error(error?.message || (data as any)?.error || "AI suggest failed");
      }
      setRows(((data as any)?.suggestions as Suggestion[]) ?? []);
    } catch (e: any) {
      toast.error(`AI import failed: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void fetchSuggestions();
     
  }, [open, hotelId]);

  const update = (i: number, patch: Partial<Suggestion>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const apply = async () => {
    setApplying(true);
    try {
      const { data, error } = await supabase.functions.invoke("previo-ai-import-rooms", {
        body: { hotelId, apply: true, rows },
      });
      if (error || (data as any)?.success === false) {
        throw new Error(error?.message || (data as any)?.error || "Apply failed");
      }
      const r = (data as any)?.results || {};
      toast.success(
        `AI import applied — ${r.inserted ?? 0} inserted, ${r.updated ?? 0} updated, ${r.mapped ?? 0} mapped${
          r.errors?.length ? ` · ${r.errors.length} errors` : ""
        }`,
      );
      onApplied?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Apply failed: ${e?.message ?? e}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI room import from Previo
            {rows.length > 0 && <Badge variant="secondary" className="ml-2">{rows.length} rooms</Badge>}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Gemini normalises Previo's raw room list into HotelCare rooms. Review, edit inline,
            then click <strong>Apply</strong> to create the rooms and their PMS mappings in one go.
          </p>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-3">
          {loading && (
            <div className="flex items-center justify-center py-14 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Fetching from Previo and asking the AI to normalise…
            </div>
          )}

          {!loading && rows.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-14">
              No suggestions returned. Check that Previo credentials are configured for this hotel.
            </div>
          )}

          {!loading && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 pr-2">Previo</th>
                    <th className="py-2 pr-2">Room #</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2">Category</th>
                    <th className="py-2 pr-2">Floor</th>
                    <th className="py-2 pr-2">Capacity</th>
                    <th className="py-2 pr-2">AI note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.previo_room_id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-2 font-mono">
                        <div className="font-semibold">{r.previo_room_name}</div>
                        <div className="text-muted-foreground text-[10px]">#{r.previo_room_id}</div>
                      </td>
                      <td className="py-2 pr-2 w-20">
                        <Input value={r.room_number} onChange={(e) => update(i, { room_number: e.target.value })} className="h-7 text-xs" />
                      </td>
                      <td className="py-2 pr-2 w-48">
                        <Input value={r.room_type} onChange={(e) => update(i, { room_type: e.target.value })} className="h-7 text-xs" />
                      </td>
                      <td className="py-2 pr-2 w-28">
                        <Input value={r.room_category ?? ""} onChange={(e) => update(i, { room_category: e.target.value || null })} className="h-7 text-xs" />
                      </td>
                      <td className="py-2 pr-2 w-16">
                        <Input
                          type="number"
                          value={r.floor ?? ""}
                          onChange={(e) => update(i, { floor: e.target.value === "" ? null : Number(e.target.value) })}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="py-2 pr-2 w-16">
                        <Input
                          type="number"
                          value={r.capacity ?? ""}
                          onChange={(e) => update(i, { capacity: e.target.value === "" ? null : Number(e.target.value) })}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="py-2 pr-2 text-muted-foreground italic max-w-[200px]">
                        {r.reasoning || ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="border-t px-6 py-3 flex items-center justify-between gap-2 bg-muted/30">
          <Button variant="ghost" size="sm" onClick={fetchSuggestions} disabled={loading || applying}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Re-run AI
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>Cancel</Button>
            <Button onClick={apply} disabled={applying || loading || rows.length === 0}>
              {applying ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Apply {rows.length} room{rows.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
