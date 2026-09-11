import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Loader2, PackagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  parkingErrorMessage,
  previewParkingRange,
  todayISO,
  type ParkingBatch,
} from '@/lib/parking';
import { createParkingBatch, deleteParkingBatch, listParkingBatches } from '@/lib/parkingApi';

interface Props {
  organizationSlug: string;
  hotelId: string;
  refreshVersion: number;
  onChanged: () => void;
}
export function ParkingInventory({ organizationSlug, hotelId, refreshVersion, onChanged }: Props) {
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [label, setLabel] = useState('');
  const [batches, setBatches] = useState<ParkingBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ParkingBatch | null>(null);
  const preview = useMemo(() => previewParkingRange(rangeStart, rangeEnd), [rangeStart, rangeEnd]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setBatches(await listParkingBatches(organizationSlug, hotelId));
    } catch (nextError) {
      setError(parkingErrorMessage(nextError, 'Could not load ticket batches.'));
    } finally {
      setLoading(false);
    }
  }, [organizationSlug, hotelId]);

  useEffect(() => { void load(); }, [load, refreshVersion]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!preview.ok) return toast.error(preview.error);
    setBusy(true);
    try {
      const batch = await createParkingBatch({
        organizationSlug,
        hotelId,
        rangeStart: preview.canonicalStart,
        rangeEnd: preview.canonicalEnd,
        expiresOn: expiresOn || null,
        label: label.trim() || null,
      });
      toast.success(`${batch.ticket_count || preview.count} parking tickets added.`);
      setRangeStart('');
      setRangeEnd('');
      setExpiresOn('');
      setLabel('');
      onChanged();
      await load();
    } catch (nextError) {
      toast.error(parkingErrorMessage(nextError, 'Could not add this ticket range.'));
    } finally {
      setBusy(false);
    }
  }

  async function removeBatch() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteParkingBatch(deleteTarget.id);
      toast.success('Unused parking ticket batch deleted.');
      setDeleteTarget(null);
      onChanged();
      await load();
    } catch (nextError) {
      toast.error(parkingErrorMessage(nextError, 'Could not delete this batch.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(320px,.8fr)_minmax(0,1.2fr)]">
      <Card className="h-fit border-primary/20">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-lg"><PackagePlus className="h-5 w-5 text-primary" />Add ticket range</CardTitle><p className="text-sm text-muted-foreground">The full range is validated and saved in one transaction. Overlapping ranges are rejected.</p></CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="parking-range-start">First ticket</Label><Input id="parking-range-start" className="font-mono" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} placeholder="43930-21096" /></div>
              <div className="space-y-1.5"><Label htmlFor="parking-range-end">Last ticket</Label><Input id="parking-range-end" className="font-mono" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} placeholder="43930-21200 or 21200" /></div>
            </div>
            {rangeStart && rangeEnd && (
              <div className={`rounded-md border p-3 text-sm ${preview.ok ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}>
                {preview.ok ? <><p className="font-semibold">{preview.count} tickets</p><p className="font-mono text-xs">{preview.canonicalStart} → {preview.canonicalEnd}</p></> : preview.error}
              </div>
            )}
            <div className="space-y-1.5"><Label htmlFor="parking-range-expiry">Batch expiry (optional)</Label><Input id="parking-range-expiry" type="date" min={todayISO()} value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="parking-range-label">Label / note (optional)</Label><Input id="parking-range-label" value={label} maxLength={200} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. September delivery" /></div>
            <Button type="submit" className="w-full" disabled={busy || !preview.ok}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackagePlus className="mr-2 h-4 w-4" />}Add complete range</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-lg">Inventory batches</CardTitle></CardHeader>
        <CardContent>
          {error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : loading && batches.length === 0 ? <div className="flex min-h-32 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading batches…</div> : batches.length === 0 ? <div className="flex min-h-32 flex-col items-center justify-center text-center text-muted-foreground"><PackagePlus className="mb-2 h-8 w-8" /><p className="font-medium text-foreground">No parking stock yet</p><p className="text-sm">Add the first physical ticket range.</p></div> : (
            <div className="space-y-3">
              {batches.map((batch) => {
                const canDelete = batch.issued === 0 && batch.void === 0;
                return (
                  <div key={batch.id} className="rounded-lg border p-3 sm:p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="truncate font-mono text-sm font-bold sm:text-base">{batch.range_start} → {batch.range_end}</p><p className="mt-1 text-xs text-muted-foreground">{batch.label || 'Unlabelled batch'} · added {new Date(batch.created_at).toLocaleDateString()}</p></div>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" disabled={!canDelete} title={canDelete ? 'Delete unused batch' : 'Used batches are retained for audit history'} onClick={() => setDeleteTarget(batch)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="border-emerald-200 text-emerald-700">{batch.available} available</Badge>
                      <Badge variant="outline" className="border-blue-200 text-blue-700">{batch.issued} issued</Badge>
                      {batch.void > 0 && <Badge variant="outline" className="border-red-200 text-red-700">{batch.void} void</Badge>}
                      <span className="text-xs text-muted-foreground">of {batch.ticket_count}</span>
                      {batch.expires_on && <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" />Expires {batch.expires_on}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this unused ticket batch?</AlertDialogTitle><AlertDialogDescription>{deleteTarget?.range_start} → {deleteTarget?.range_end} will be removed. This is only allowed while every ticket remains unused.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep batch</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); void removeBatch(); }} disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete batch</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
