import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Loader2, User, Bot, DoorOpen, RefreshCw, AlertTriangle } from 'lucide-react';

interface Row {
  id: string;
  hotel_id: string;
  sync_type: string;
  sync_status: string | null;
  error_message: string | null;
  created_at: string;
  synced_by_name: string | null;
  data: any;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hotelId: string | null;
}

/**
 * Admin/manager-facing PMS sync history: who ran the last syncs (or the
 * system), and the room summary (checkout vs daily rooms) returned by the
 * Previo API — the same report the manual XLSX upload used to show.
 */
export function PmsSyncHistoryPanel({ open, onOpenChange, hotelId }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = (supabase as any)
        .from('pms_sync_history')
        .select('id, hotel_id, sync_type, sync_status, error_message, created_at, synced_by_name, data')
        .order('created_at', { ascending: false })
        .limit(30);
      if (hotelId) q = q.eq('hotel_id', hotelId);
      const { data } = await q;
      if (!cancelled) {
        setRows((data as Row[]) || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, hotelId]);

  const chips = (list: unknown, className: string) => {
    const arr = Array.isArray(list) ? (list as string[]) : [];
    if (arr.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1">
        {arr.slice(0, 40).map((r, i) => (
          <span key={`${r}-${i}`} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${className}`}>{r}</span>
        ))}
        {arr.length > 40 && <span className="text-[10px] text-muted-foreground">+{arr.length - 40}</span>}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> PMS sync history
          </DialogTitle>
          <DialogDescription>
            Who ran each sync and what came back from the PMS.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
          {loading && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {!loading && rows.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">No sync history yet.</p>
          )}
          {!loading && rows.map((row) => {
            const d = row.data || {};
            const isAuto = String(row.synced_by_name || '').toLowerCase().startsWith('system') || d.trigger === 'auto';
            const failed = row.sync_status === 'error';
            return (
              <div key={row.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={failed ? 'destructive' : row.sync_status === 'partial' ? 'outline' : 'default'} className="text-[10px]">
                    {row.sync_status || 'ok'}
                  </Badge>
                  <span className="text-xs font-medium tabular-nums">
                    {format(new Date(row.created_at), 'MMM d, HH:mm')}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    {isAuto ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                    {row.synced_by_name || (isAuto ? 'System (auto sync)' : 'Unknown')}
                  </span>
                </div>

                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span><span className="font-semibold text-foreground tabular-nums">{d.updated ?? 0}</span>/{d.total ?? 0} rooms updated</span>
                  <span className="inline-flex items-center gap-1">
                    <DoorOpen className="h-3 w-3" />
                    <span className="font-semibold text-foreground tabular-nums">{d.checkouts ?? 0}</span> checkout
                  </span>
                  <span><span className="font-semibold text-foreground tabular-nums">{d.dailyCount ?? (Array.isArray(d.dailyRooms) ? d.dailyRooms.length : 0)}</span> daily</span>
                  {(d.notFound ?? 0) > 0 && (
                    <span className="text-amber-600 dark:text-amber-500">{d.notFound} unmatched</span>
                  )}
                </div>

                {chips(d.checkoutRooms, 'bg-orange-500/15 text-orange-700 dark:text-orange-400')}
                {chips(d.dailyRooms, 'bg-sky-500/15 text-sky-700 dark:text-sky-400')}
                {chips(d.unmatchedRooms, 'bg-muted text-muted-foreground')}

                {(row.error_message || d.managerMessage) && (
                  <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-500">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {row.error_message || d.managerMessage}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
