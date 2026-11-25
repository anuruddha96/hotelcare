import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Minus, PackageCheck, Pencil, Plus, Save, Trash2, UserRound, Wine, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { hasManagerPowers } from '@/lib/roleAccess';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';

type MinibarItem = {
  id: string;
  name: string;
  category: string | null;
  price: number;
};

type UsageRow = {
  id: string;
  minibar_item_id: string;
  quantity_used: number | null;
  usage_date: string | null;
  recorded_by: string | null;
  source: string | null;
  is_cleared: boolean | null;
  cleared_by: string | null;
  cleared_at: string | null;
  cleared_note: string | null;
  guest_checkout_date: string | null;
  refill_status: string | null;
  minibar_items: MinibarItem | null;
};

type ProfileRow = { id: string; full_name: string; nickname: string | null; role: string };

type HistoryEvent = {
  key: string;
  at: string;
  title: string;
  detail: string;
  actorId: string | null;
  tone: 'usage' | 'refill' | 'correction';
};

type PendingGroup = {
  itemId: string;
  name: string;
  price: number;
  quantity: number;
  rowIds: string[];
  recorderIds: string[];
};

interface RoomMinibarOperationsProps {
  roomId: string;
  roomNumber: string;
  isCheckout: boolean;
  readOnly?: boolean;
  onChanged?: () => void;
}

const actorLabel = (id: string | null, people: Map<string, ProfileRow>) => {
  if (!id) return 'System / unknown user';
  const p = people.get(id);
  return p?.nickname?.trim() || p?.full_name || 'Staff member';
};

export function RoomMinibarOperations({ roomId, roomNumber, isCheckout, readOnly = false, onChanged }: RoomMinibarOperationsProps) {
  const { profile } = useAuth();
  const [items, setItems] = useState<MinibarItem[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [people, setPeople] = useState<Map<string, ProfileRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [editingCorrection, setEditingCorrection] = useState(false);
  const [correctionDraft, setCorrectionDraft] = useState<Record<string, number>>({});

  const role = String(profile?.role || '').toLowerCase();
  const canCorrect = !readOnly && (hasManagerPowers(profile?.role) || role === 'supervisor');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: itemRows, error: itemError }, { data: usageRows, error: usageError }] = await Promise.all([
        supabase
          .from('minibar_items')
          .select('id, name, category, price')
          .eq('is_active', true)
          .order('category')
          .order('name'),
        supabase
          .from('room_minibar_usage')
          .select('id, minibar_item_id, quantity_used, usage_date, recorded_by, source, is_cleared, cleared_by, cleared_at, cleared_note, guest_checkout_date, refill_status, minibar_items(id, name, category, price)')
          .eq('room_id', roomId)
          .order('usage_date', { ascending: false })
          .limit(50),
      ]);
      if (itemError) throw itemError;
      if (usageError) throw usageError;

      const rows = (usageRows || []) as unknown as UsageRow[];
      setItems((itemRows || []) as MinibarItem[]);
      setUsage(rows);

      const ids = Array.from(new Set(rows.flatMap((row) => [row.recorded_by, row.cleared_by]).filter(Boolean))) as string[];
      if (ids.length) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name, nickname, role').in('id', ids);
        setPeople(new Map(((profiles || []) as ProfileRow[]).map((p) => [p.id, p])));
      } else {
        setPeople(new Map());
      }
    } catch (error) {
      console.error('Failed to load room minibar:', error);
      toast.error('Could not load minibar information for this room.');
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => { void load(); }, [load]);

  const pending = useMemo(() => usage.filter((row) => !row.is_cleared), [usage]);
  const pendingGroups = useMemo<PendingGroup[]>(() => {
    const grouped = new Map<string, PendingGroup>();
    for (const row of pending) {
      const itemId = row.minibar_item_id;
      const existing = grouped.get(itemId);
      const recorderIds = row.recorded_by ? [row.recorded_by] : [];
      if (existing) {
        existing.quantity += Number(row.quantity_used || 0);
        existing.rowIds.push(row.id);
        for (const recorderId of recorderIds) {
          if (!existing.recorderIds.includes(recorderId)) existing.recorderIds.push(recorderId);
        }
      } else {
        grouped.set(itemId, {
          itemId,
          name: row.minibar_items?.name || 'Item',
          price: Number(row.minibar_items?.price || 0),
          quantity: Number(row.quantity_used || 0),
          rowIds: [row.id],
          recorderIds,
        });
      }
    }
    return Array.from(grouped.values());
  }, [pending]);
  const pendingUnits = useMemo(() => pendingGroups.reduce((sum, group) => sum + group.quantity, 0), [pendingGroups]);
  const pendingValue = useMemo(() => pendingGroups.reduce((sum, group) => sum + group.quantity * group.price, 0), [pendingGroups]);
  const draftUnits = Object.values(draft).reduce((sum, qty) => sum + qty, 0);

  const correctedUnits = useMemo(
    () => pendingGroups.reduce((sum, group) => sum + (correctionDraft[group.itemId] ?? group.quantity), 0),
    [correctionDraft, pendingGroups],
  );
  const correctedValue = useMemo(
    () => pendingGroups.reduce((sum, group) => sum + (correctionDraft[group.itemId] ?? group.quantity) * group.price, 0),
    [correctionDraft, pendingGroups],
  );
  const changedGroups = useMemo(
    () => pendingGroups.filter((group) => (correctionDraft[group.itemId] ?? group.quantity) !== group.quantity),
    [correctionDraft, pendingGroups],
  );

  const history = useMemo<HistoryEvent[]>(() => {
    const events: HistoryEvent[] = [];
    for (const row of usage) {
      const item = row.minibar_items?.name || 'Minibar item';
      if (row.usage_date) {
        events.push({
          key: `use-${row.id}`,
          at: row.usage_date,
          title: row.source === 'manager_correction' ? 'Corrected usage submitted' : 'Usage recorded',
          detail: `${row.quantity_used || 0}× ${item}${row.source && row.source !== 'manager_correction' ? ` · ${row.source}` : ''}`,
          actorId: row.recorded_by,
          tone: row.source === 'manager_correction' ? 'correction' : 'usage',
        });
      }
      if (row.is_cleared && row.cleared_at) {
        const wasCorrection = row.refill_status === 'corrected' || row.cleared_note === 'Corrected by manager';
        events.push({
          key: `clear-${row.id}`,
          at: row.cleared_at,
          title: wasCorrection ? 'Pending usage corrected' : row.guest_checkout_date ? 'Checkout · minibar refilled' : 'Minibar refilled',
          detail: wasCorrection
            ? `${row.quantity_used || 0}× ${item} removed from the previous pending record`
            : `${row.quantity_used || 0}× ${item}${row.cleared_note ? ` · ${row.cleared_note}` : ''}`,
          actorId: row.cleared_by,
          tone: wasCorrection ? 'correction' : 'refill',
        });
      }
    }
    return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 5);
  }, [usage]);

  const notifyChanged = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('minibar-usage-changed', { detail: { roomId, roomNumber } }));
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    }
    onChanged?.();
  }, [onChanged, roomId, roomNumber]);

  const addDraft = (itemId: string, change: number) => {
    setDraft((current) => ({ ...current, [itemId]: Math.max(0, (current[itemId] || 0) + change) }));
  };

  const startCorrection = () => {
    if (!canCorrect || pendingGroups.length === 0) return;
    setCorrectionDraft(Object.fromEntries(pendingGroups.map((group) => [group.itemId, group.quantity])));
    setEditingCorrection(true);
  };

  const cancelCorrection = () => {
    if (saving) return;
    setCorrectionDraft({});
    setEditingCorrection(false);
  };

  const adjustCorrection = (itemId: string, change: number) => {
    setCorrectionDraft((current) => ({ ...current, [itemId]: Math.max(0, (current[itemId] || 0) + change) }));
  };

  const submitCorrection = async () => {
    if (!canCorrect || !profile?.id || !profile.organization_slug || saving || changedGroups.length === 0) return;
    setSaving(true);
    const now = new Date().toISOString();
    const changedRowIds = changedGroups.flatMap((group) => group.rowIds);
    try {
      const { error: clearError } = await supabase
        .from('room_minibar_usage')
        .update({
          is_cleared: true,
          cleared_by: profile.id,
          cleared_at: now,
          cleared_note: 'Corrected by manager',
          refill_status: 'corrected',
          refill_resolved_at: now,
          refill_resolved_by: profile.id,
        } as any)
        .in('id', changedRowIds);
      if (clearError) throw clearError;

      const replacementRows = changedGroups
        .map((group) => ({ group, quantity: correctionDraft[group.itemId] ?? group.quantity }))
        .filter(({ quantity }) => quantity > 0)
        .map(({ group, quantity }) => ({
          room_id: roomId,
          minibar_item_id: group.itemId,
          quantity_used: quantity,
          usage_date: now,
          recorded_by: profile.id,
          source: 'manager_correction',
          is_cleared: false,
          refill_status: 'pending',
          organization_slug: profile.organization_slug,
        }));

      if (replacementRows.length) {
        const { error: insertError } = await supabase.from('room_minibar_usage').insert(replacementRows as any);
        if (insertError) {
          await supabase
            .from('room_minibar_usage')
            .update({
              is_cleared: false,
              cleared_by: null,
              cleared_at: null,
              cleared_note: null,
              refill_status: 'pending',
              refill_resolved_at: null,
              refill_resolved_by: null,
            } as any)
            .in('id', changedRowIds);
          throw insertError;
        }
      }

      setEditingCorrection(false);
      setCorrectionDraft({});
      toast.success(`Room ${roomNumber}: minibar usage corrected`);
      await load();
      notifyChanged();
    } catch (error) {
      console.error('Failed to correct minibar usage:', error);
      toast.error('Could not submit the minibar correction. No correction was saved.');
    } finally {
      setSaving(false);
    }
  };

  const saveUsage = async () => {
    if (!profile?.id || !profile.organization_slug || draftUnits === 0 || saving) return;
    setSaving(true);
    try {
      const rows = Object.entries(draft)
        .filter(([, qty]) => qty > 0)
        .map(([itemId, qty]) => ({
          room_id: roomId,
          minibar_item_id: itemId,
          quantity_used: qty,
          usage_date: new Date().toISOString(),
          recorded_by: profile.id,
          source: 'staff',
          is_cleared: false,
          refill_status: 'pending',
          organization_slug: profile.organization_slug,
        }));
      const { error } = await supabase.from('room_minibar_usage').insert(rows as any);
      if (error) throw error;
      setDraft({});
      toast.success(`Minibar usage saved for room ${roomNumber}`);
      await load();
      notifyChanged();
    } catch (error) {
      console.error('Failed to save minibar usage:', error);
      toast.error('Could not save minibar usage.');
    } finally {
      setSaving(false);
    }
  };

  const markRefilled = async () => {
    if (!profile?.id || pending.length === 0 || saving) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const patch: Record<string, any> = {
        is_cleared: true,
        cleared_by: profile.id,
        cleared_at: now,
        cleared_note: 'Refilled from room operations',
        refill_status: 'refilled',
        refill_resolved_at: now,
        refill_resolved_by: profile.id,
      };
      if (isCheckout) patch.guest_checkout_date = now;
      const { error } = await supabase.from('room_minibar_usage').update(patch as any).in('id', pending.map((row) => row.id));
      if (error) throw error;
      toast.success(isCheckout ? `Room ${roomNumber}: checkout minibar refilled` : `Room ${roomNumber}: minibar refilled`);
      await load();
      notifyChanged();
    } catch (error) {
      console.error('Failed to mark minibar refilled:', error);
      toast.error('Could not mark the minibar as refilled.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Loading minibar…</div>;
  }

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 ${pendingUnits ? 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20' : 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 font-semibold"><Wine className="h-4 w-4" /> Current minibar</div>
            <p className="mt-1 text-sm">{pendingUnits ? `${pendingUnits} item${pendingUnits === 1 ? '' : 's'} used · €${pendingValue.toFixed(2)} pending` : 'No pending usage · minibar is up to date'}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {canCorrect && pendingUnits > 0 && !editingCorrection && (
              <Button type="button" size="sm" variant="outline" className="h-8" onClick={startCorrection}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Correct
              </Button>
            )}
            <Badge variant={pendingUnits ? 'destructive' : 'secondary'}>{pendingUnits ? 'Needs refill' : 'Up to date'}</Badge>
          </div>
        </div>

        {pendingGroups.length > 0 && !editingCorrection && (
          <div className="mt-3 space-y-1.5 border-t pt-3">
            {pendingGroups.map((group) => (
              <div key={group.itemId} className="flex items-center justify-between gap-2 text-sm">
                <span>{group.quantity}× {group.name}</span>
                <span className="max-w-[45%] truncate text-xs text-muted-foreground">
                  {group.recorderIds.length ? group.recorderIds.map((id) => actorLabel(id, people)).join(', ') : 'System / unknown user'}
                </span>
              </div>
            ))}
          </div>
        )}

        {editingCorrection && (
          <div className="mt-3 border-t pt-3">
            <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
              <p className="font-semibold">Manager correction</p>
              <p className="mt-0.5">Adjust this list to what the guest actually used. Removed or changed entries leave an audit trail in minibar history.</p>
            </div>
            <div className="space-y-2">
              {pendingGroups.map((group) => {
                const quantity = correctionDraft[group.itemId] ?? group.quantity;
                const changed = quantity !== group.quantity;
                return (
                  <div key={group.itemId} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${changed ? 'border-blue-300 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-950/20' : 'bg-background/60'}`}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{group.name}</p>
                      <p className="text-[11px] text-muted-foreground">Was {group.quantity} · €{group.price.toFixed(2)} each</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button type="button" size="icon" variant="outline" className="h-8 w-8" disabled={quantity === 0 || saving} onClick={() => adjustCorrection(group.itemId, -1)}><Minus className="h-3.5 w-3.5" /></Button>
                      <span className="w-6 text-center text-sm font-semibold tabular-nums">{quantity}</span>
                      <Button type="button" size="icon" variant="outline" className="h-8 w-8" disabled={saving} onClick={() => adjustCorrection(group.itemId, 1)}><Plus className="h-3.5 w-3.5" /></Button>
                      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" disabled={quantity === 0 || saving} onClick={() => setCorrectionDraft((current) => ({ ...current, [group.itemId]: 0 }))} title={`Remove ${group.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-col gap-2 rounded-lg bg-background/70 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium">Corrected pending total</p>
                <p className="text-sm font-semibold">{correctedUnits} item{correctedUnits === 1 ? '' : 's'} · €{correctedValue.toFixed(2)}</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1 sm:flex-none" disabled={saving} onClick={cancelCorrection}><X className="mr-1.5 h-4 w-4" /> Cancel</Button>
                <Button type="button" className="flex-1 sm:flex-none" disabled={saving || changedGroups.length === 0} onClick={() => void submitCorrection()}>
                  {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                  Submit correction
                </Button>
              </div>
            </div>
          </div>
        )}

        {!readOnly && pending.length > 0 && !editingCorrection && (
          <Button className="mt-3 w-full" onClick={() => void markRefilled()} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}
            {isCheckout ? 'Confirm checkout refill' : 'Mark minibar refilled'}
          </Button>
        )}
      </div>

      {!readOnly && (
        <Card className={editingCorrection ? 'opacity-60' : undefined}>
          <CardContent className="p-4">
            <div className="mb-3">
              <h3 className="text-sm font-semibold">Record new usage</h3>
              <p className="text-[11px] text-muted-foreground">Items come directly from this hotel/organization minibar settings. Changes are staged until you save.</p>
            </div>
            {items.length ? (
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      <p className="text-[11px] text-muted-foreground">{item.category || 'Minibar'} · €{Number(item.price).toFixed(2)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button type="button" size="icon" variant="outline" className="h-8 w-8" disabled={editingCorrection || !draft[item.id]} onClick={() => addDraft(item.id, -1)}><Minus className="h-3.5 w-3.5" /></Button>
                      <span className="w-5 text-center text-sm font-semibold tabular-nums">{draft[item.id] || 0}</span>
                      <Button type="button" size="icon" variant="outline" className="h-8 w-8" disabled={editingCorrection} onClick={() => addDraft(item.id, 1)}><Plus className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
                <Button className="w-full" disabled={!draftUnits || saving || editingCorrection} onClick={() => void saveUsage()}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save {draftUnits || ''} item{draftUnits === 1 ? '' : 's'}
                </Button>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> No active minibar items are configured. Add them in Minibar Settings first.</div>
            )}
          </CardContent>
        </Card>
      )}

      <section className="rounded-xl border p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Recent minibar history</h3>
            <p className="text-[11px] text-muted-foreground">Last five recorded usage, correction, and refill actions for this room.</p>
          </div>
          <Badge variant="outline">Last 5</Badge>
        </div>
        {history.length ? (
          <div className="space-y-3">
            {history.map((event) => (
              <div key={event.key} className="flex gap-3 border-t pt-3 first:border-t-0 first:pt-0">
                <div className={`mt-0.5 rounded-full p-1 ${event.tone === 'refill' ? 'bg-emerald-100 text-emerald-700' : event.tone === 'correction' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                  {event.tone === 'refill' ? <CheckCircle2 className="h-3.5 w-3.5" /> : event.tone === 'correction' ? <Pencil className="h-3.5 w-3.5" /> : <Wine className="h-3.5 w-3.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{event.title}</p>
                  <p className="text-xs text-muted-foreground">{event.detail}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground"><span>{new Date(event.at).toLocaleString()}</span><span className="flex items-center gap-1"><UserRound className="h-3 w-3" /> {actorLabel(event.actorId, people)}</span></p>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">No minibar history for this room yet.</p>}
      </section>
    </div>
  );
}
