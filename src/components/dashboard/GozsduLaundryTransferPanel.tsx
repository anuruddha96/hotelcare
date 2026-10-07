import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  canConfirmGozsduLaundryTransfer, transferAreaCount, transferRoomCount,
  type GozsduTransferPreview,
} from '@/lib/gozsduLaundryTransfer';

/** One inline step inside the existing wizard, not a nested modal. */
export function GozsduLaundryTransferPanel({ staffId, staffName, workDate, onTransferred, onCancel }: {
  staffId: string;
  staffName: string;
  workDate: string;
  onTransferred: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState<GozsduTransferPreview | null>(null);
  const [replacementId, setReplacementId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    setPreview(null);
    setReplacementId('');
    setConfirmed(false);
    try {
      const { data, error: readError } = await (supabase as any)
        .rpc('preview_gozsdu_laundry_reassignment', {
          p_user_id: staffId, p_work_date: workDate,
        });
      if (readError) throw readError;
      if (!data || !data.token || !data.counts || !Array.isArray(data.replacement_staff)) {
        throw new Error('Transfer preview was incomplete. No changes have been made.');
      }
      setPreview(data as GozsduTransferPreview);
    } catch (cause: any) {
      const unavailable = ['PGRST202', '42883'].includes(cause?.code);
      setError(unavailable
        ? 'Safe transfers are not enabled in the database yet. Existing room assignments have not changed.'
        : cause?.message || 'Could not verify this employee’s saved work. Nothing has changed.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [staffId, workDate]);

  const commit = async () => {
    if (saving || committed || !canConfirmGozsduLaundryTransfer(preview, replacementId, confirmed)) return;
    setSaving(true);
    setError('');
    try {
      const { data, error: writeError } = await (supabase as any)
        .rpc('transfer_gozsdu_work_to_laundryner', {
          p_user_id: staffId,
          p_replacement_id: replacementId,
          p_work_date: workDate,
          p_expected_token: preview!.token,
        });
      if (writeError) throw writeError;
      if (data?.saved !== true) throw new Error('The database did not confirm the transfer. Refresh the schedule before retrying.');
      // A successful RPC commits before the follow-up UI refresh. Never report
      // an unsuccessful transfer or allow duplicate writes if refreshing fails.
      setCommitted(true);
      setConfirmed(false);
      try {
        await onTransferred();
      } catch (refreshError: any) {
        setError('Transfer saved successfully, but the updated duty could not be refreshed. Close and reopen Auto Assign before making any further changes.');
        console.error('[GozsduLaundryTransfer] post-commit refresh failed', refreshError);
      }
    } catch (cause: any) {
      setError(cause?.code === '40001'
        ? 'Someone changed the schedule. Refresh the preview and select a replacement again.'
        : cause?.message || 'Transfer could not be completed. Refresh and verify the schedule before trying again.');
      setConfirmed(false);
    } finally { setSaving(false); }
  };

  const canCommit = !committed && canConfirmGozsduLaundryTransfer(preview, replacementId, confirmed);
  const blocked = !!preview && (preview.release_locked || preview.blocked_started_or_completed > 0);
  const rooms = preview ? transferRoomCount(preview) : 0;
  const areas = preview ? transferAreaCount(preview) : 0;

  return <section aria-label={`Reassign ${staffName} work before Laundryner duty`}
    className="mt-3 space-y-3 rounded-lg border-2 border-amber-300 bg-amber-50/40 p-3 text-sm dark:bg-amber-950/20">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-semibold">Move existing work before selecting {staffName} as Laundryner</h4>
      <Button type="button" size="sm" variant="outline" disabled={saving || loading || committed} onClick={() => void load()}>
        <RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">Only Gozsdu · {workDate}. Existing room notes, cleaning statuses, Previo information and approval history stay intact. This saves all transfers and the Laundryner duty together, or nothing.</p>
    {loading && <p role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Checking current work…</p>}
    {committed && <p role="status" className="rounded border border-emerald-500 bg-background p-2 text-emerald-700">The transfer was saved by the database. Reopen the schedule if updated assignments are not displayed.</p>}
    {error && <p role="alert" className="rounded border border-destructive bg-background p-2 text-destructive"><AlertTriangle className="mr-1 inline h-4 w-4" />{error}</p>}
    {preview && <>
      <div className="grid grid-cols-2 gap-2 rounded border bg-background p-3 text-center">
        <div><strong className="text-xl">{rooms}</strong><p className="text-xs">Room assignments</p></div>
        <div><strong className="text-xl">{areas}</strong><p className="text-xs">Public-area assignments</p></div>
      </div>
      {rooms > 0 && <p className="text-xs"><strong>Rooms:</strong> {[
        ...preview.work.plan_rooms.map(room => room.room),
        ...preview.work.live_rooms.map(room => room.room),
      ].join(', ')}</p>}
      {areas > 0 && <p className="text-xs"><strong>Areas:</strong> {[
        ...preview.work.plan_areas.map(area => area.name),
        ...preview.work.property_areas.map(area => area.name),
        ...preview.work.live_areas.map(area => area.name),
      ].join(', ')}</p>}
      {blocked && <p role="alert" className="rounded border border-destructive p-2 text-destructive">
        {preview.release_locked ? 'Plan release has started. This schedule is locked.'
          : `${preview.blocked_started_or_completed} tasks are already started, finished or approved. Resolve them separately.`}
      </p>}
      {!blocked && rooms + areas === 0 && <p className="text-xs">No existing work needs transferring. Close this panel and select Laundryner normally.</p>}
      {!blocked && rooms + areas > 0 && <>
        <label className="block space-y-1 text-xs font-medium" htmlFor="laundry-transfer-replacement">
          Replacement housekeeper
          <select id="laundry-transfer-replacement" className="h-10 w-full rounded-md border bg-background px-2 text-sm"
            value={replacementId} disabled={saving || committed}
            onChange={event => { setReplacementId(event.target.value); setConfirmed(false); }}>
            <option value="">Choose an eligible housekeeper</option>
            {preview.replacement_staff.map(person => <option key={person.id} value={person.id}>
              {person.full_name || person.name}{person.nickname ? ` (${person.nickname})` : ''}
            </option>)}
          </select>
        </label>
        {preview.replacement_staff.length === 0 && <p role="alert" className="text-xs text-destructive">No eligible selected replacement exists. Add a housekeeper to the saved plan first.</p>}
        <label className="flex items-start gap-2 rounded border bg-background p-2 text-xs">
          <Checkbox checked={confirmed} disabled={saving || committed || !replacementId}
            onCheckedChange={value => setConfirmed(value === true)} aria-label="Confirm transfer of all listed work" />
          <span>I have reviewed all {rooms} room and {areas} public-area assignments. Transfer them to the selected housekeeper and assign Laundryner duty to {staffName}.</span>
        </label>
      </>}
    </>}
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>Cancel</Button>
      <Button type="button" disabled={!canCommit || saving} onClick={() => void commit()}>
        {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <><ArrowRight className="mr-1 h-4 w-4" /><Check className="mr-1 h-4 w-4" /></>}
        Transfer work & assign Laundryner
      </Button>
    </div>
  </section>;
}
