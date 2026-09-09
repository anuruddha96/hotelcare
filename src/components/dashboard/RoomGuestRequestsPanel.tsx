import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, PackageCheck, Plus, RotateCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

type RequestStatus = 'requested' | 'delivered' | 'returned' | 'resolved';

type RequestEvent = {
  status: RequestStatus;
  actorId: string;
  at: string;
};

type GuestRequestPayload = {
  version: 1;
  workDate: string;
  requestType: string;
  label: string;
  quantity: number;
  requiresReturn: boolean;
  status: RequestStatus;
  detail?: string;
  events: RequestEvent[];
};

type GuestRequestRow = {
  id: string;
  content: string;
  created_by: string;
  created_at: string;
  is_resolved: boolean;
  assignment_id: string | null;
};

type ProfileSummary = {
  id: string;
  full_name?: string | null;
  nickname?: string | null;
  role?: string | null;
};

interface RoomGuestRequestsPanelProps {
  roomId: string;
  roomNumber: string;
  assignmentId?: string | null;
  workDate: string;
  readOnly?: boolean;
  compact?: boolean;
}

const REQUEST_TYPES = [
  { value: 'extra_towels', label: 'Extra towels', requiresReturn: true },
  { value: 'extra_pillow', label: 'Extra pillow', requiresReturn: true },
  { value: 'blanket', label: 'Blanket', requiresReturn: true },
  { value: 'baby_cot', label: 'Baby cot', requiresReturn: true },
  { value: 'iron', label: 'Iron', requiresReturn: true },
  { value: 'amenities', label: 'Extra amenities', requiresReturn: false },
  { value: 'other', label: 'Other request', requiresReturn: false },
] as const;

const HANDOVER_ROLES = new Set([
  'reception', 'front_office', 'reception_manager',
  'manager', 'admin', 'top_management', 'top_management_manager',
  'housekeeping_manager', 'supervisor',
]);

function parsePayload(content: string): GuestRequestPayload | null {
  try {
    const parsed = JSON.parse(content) as Partial<GuestRequestPayload>;
    if (
      parsed.version !== 1 ||
      !parsed.workDate ||
      !parsed.requestType ||
      !parsed.label ||
      !parsed.status ||
      !Array.isArray(parsed.events)
    ) return null;

    return {
      version: 1,
      workDate: parsed.workDate,
      requestType: parsed.requestType,
      label: parsed.label,
      quantity: Math.max(1, Number(parsed.quantity) || 1),
      requiresReturn: !!parsed.requiresReturn,
      status: parsed.status,
      detail: parsed.detail || '',
      events: parsed.events,
    };
  } catch {
    return null;
  }
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function roleLabel(role?: string | null) {
  const normalized = String(role || '').toLowerCase();
  if (normalized === 'reception' || normalized === 'front_office' || normalized === 'reception_manager') return 'Reception';
  if (normalized === 'housekeeping') return 'Housekeeper';
  if (normalized === 'supervisor' || normalized === 'housekeeping_manager') return 'Supervisor';
  if (['manager', 'admin', 'top_management', 'top_management_manager'].includes(normalized)) return 'Manager';
  return 'Team';
}

export function RoomGuestRequestsPanel({
  roomId,
  roomNumber,
  assignmentId = null,
  workDate,
  readOnly = false,
  compact = false,
}: RoomGuestRequestsPanelProps) {
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<GuestRequestRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileSummary>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [requestType, setRequestType] = useState<string>('extra_towels');
  const [quantity, setQuantity] = useState('2');
  const [detail, setDetail] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const canRecordImmediateHandover = !readOnly && HANDOVER_ROLES.has(String(profile?.role || ''));

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('housekeeping_notes')
        .select('id, content, created_by, created_at, is_resolved, assignment_id')
        .eq('room_id', roomId)
        .eq('note_type', 'guest_request')
        .order('created_at', { ascending: false })
        .limit(75);

      if (error) throw error;
      const nextRows = (data || []) as GuestRequestRow[];
      setRows(nextRows);

      const actorIds = new Set<string>();
      for (const row of nextRows) {
        actorIds.add(row.created_by);
        const payload = parsePayload(row.content);
        payload?.events.forEach((event) => actorIds.add(event.actorId));
      }

      if (!actorIds.size) {
        setProfiles({});
        return;
      }

      const { data: profileRows, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, nickname, role')
        .in('id', Array.from(actorIds));
      if (profileError) throw profileError;

      const nextProfiles: Record<string, ProfileSummary> = {};
      for (const profileRow of (profileRows || []) as ProfileSummary[]) nextProfiles[profileRow.id] = profileRow;
      setProfiles(nextProfiles);
    } catch (error) {
      console.error('Failed to load guest room requests:', error);
      toast.error('Could not load guest requests for this room.');
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    void fetchRequests();
    const channel = supabase
      .channel(`room-guest-requests-${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'housekeeping_notes', filter: `room_id=eq.${roomId}` },
        () => void fetchRequests(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchRequests, roomId]);

  const visibleRequests = useMemo(() => {
    return rows
      .map((row) => ({ row, payload: parsePayload(row.content) }))
      .filter((entry): entry is { row: GuestRequestRow; payload: GuestRequestPayload } => !!entry.payload)
      .filter(({ payload }) => payload.status === 'requested' || payload.status === 'delivered' || payload.workDate === workDate)
      .sort((a, b) => {
        const aOpen = a.payload.status === 'requested' || a.payload.status === 'delivered';
        const bOpen = b.payload.status === 'requested' || b.payload.status === 'delivered';
        if (aOpen !== bOpen) return aOpen ? -1 : 1;
        return new Date(b.row.created_at).getTime() - new Date(a.row.created_at).getTime();
      });
  }, [rows, workDate]);

  const authorName = (actorId: string) => {
    if (actorId === user?.id) return 'You';
    const actorProfile = profiles[actorId];
    if (!actorProfile) return 'Team member';
    const name = String(actorProfile.nickname || actorProfile.full_name || '').trim();
    const role = roleLabel(actorProfile.role);
    return name ? `${role} · ${name}` : role;
  };

  const createRequest = async (mode: 'requested' | 'given_now' = 'requested') => {
    if (readOnly || creating || !user?.id) return;
    if (mode === 'given_now' && !canRecordImmediateHandover) return;

    const config = REQUEST_TYPES.find((item) => item.value === requestType) || REQUEST_TYPES[0];
    const qty = Math.max(1, Math.min(20, Number.parseInt(quantity, 10) || 1));
    const now = new Date().toISOString();
    const status: RequestStatus = mode === 'requested'
      ? 'requested'
      : config.requiresReturn
        ? 'delivered'
        : 'resolved';
    const events: RequestEvent[] = mode === 'requested'
      ? [{ status: 'requested', actorId: user.id, at: now }]
      : config.requiresReturn
        ? [{ status: 'delivered', actorId: user.id, at: now }]
        : [
            { status: 'delivered', actorId: user.id, at: now },
            { status: 'resolved', actorId: user.id, at: now },
          ];
    const closed = status === 'resolved';
    const payload: GuestRequestPayload = {
      version: 1,
      workDate,
      requestType: config.value,
      label: config.label,
      quantity: qty,
      requiresReturn: config.requiresReturn,
      status,
      detail: detail.trim(),
      events,
    };

    setCreating(true);
    try {
      const { error } = await supabase.from('housekeeping_notes').insert({
        room_id: roomId,
        assignment_id: assignmentId,
        note_type: 'guest_request',
        content: JSON.stringify(payload),
        created_by: user.id,
        is_resolved: closed,
        resolved_by: closed ? user.id : null,
        resolved_at: closed ? now : null,
      } as any);
      if (error) throw error;

      toast.success(mode === 'given_now'
        ? `${config.label} ×${qty} recorded as given to Room ${roomNumber}`
        : `${config.label} recorded for Room ${roomNumber}`);
      setDetail('');
      setShowAdd(false);
      await fetchRequests();
    } catch (error) {
      console.error('Failed to create guest room request:', error);
      toast.error(mode === 'given_now' ? 'Could not record the guest handover.' : 'Could not record the guest request.');
    } finally {
      setCreating(false);
    }
  };

  const advanceRequest = async (row: GuestRequestRow, payload: GuestRequestPayload) => {
    if (readOnly || savingId || !user?.id) return;
    const now = new Date().toISOString();
    const nextStatus: RequestStatus = payload.status === 'requested'
      ? 'delivered'
      : payload.requiresReturn
        ? 'returned'
        : 'resolved';
    const closed = nextStatus === 'returned' || nextStatus === 'resolved';
    const nextPayload: GuestRequestPayload = {
      ...payload,
      status: nextStatus,
      events: [...payload.events, { status: nextStatus, actorId: user.id, at: now }],
    };

    setSavingId(row.id);
    try {
      const { error } = await supabase
        .from('housekeeping_notes')
        .update({
          content: JSON.stringify(nextPayload),
          is_resolved: closed,
          resolved_by: closed ? user.id : null,
          resolved_at: closed ? now : null,
        } as any)
        .eq('id', row.id);
      if (error) throw error;

      const verb = nextStatus === 'delivered'
        ? 'delivered'
        : nextStatus === 'returned'
          ? 'returned'
          : 'resolved';
      toast.success(`${payload.label} marked ${verb}`);
      await fetchRequests();
    } catch (error) {
      console.error('Failed to update guest room request:', error);
      toast.error('Could not update this guest request.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className={`rounded-xl border bg-background ${compact ? 'p-2.5' : 'p-4'} space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <PackageCheck className="h-4 w-4" /> Guest requests & room items
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Reception and housekeeping handover with user, time and history.
          </p>
        </div>
        {!readOnly && (
          <Button type="button" size="sm" variant={showAdd ? 'secondary' : 'outline'} onClick={() => setShowAdd((value) => !value)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add
          </Button>
        )}
      </div>

      {showAdd && !readOnly && (
        <div className="rounded-lg border bg-muted/20 p-3 space-y-2.5">
          <div className="grid grid-cols-[1fr_88px] gap-2">
            <Select value={requestType} onValueChange={setRequestType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REQUEST_TYPES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={1}
              max={20}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              aria-label="Quantity"
              placeholder="Qty"
            />
          </div>
          <Textarea
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            rows={2}
            placeholder="Optional detail, e.g. guest requested 2 bath towels…"
          />
          <div className={`grid gap-2 ${canRecordImmediateHandover ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
            <Button type="button" variant={canRecordImmediateHandover ? 'outline' : 'default'} disabled={creating} onClick={() => void createRequest('requested')}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record request
            </Button>
            {canRecordImmediateHandover && (
              <Button type="button" disabled={creating} onClick={() => void createRequest('given_now')}>
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}
                Given to guest now
              </Button>
            )}
          </div>
          {canRecordImmediateHandover && (
            <p className="text-[10px] text-muted-foreground">
              “Given to guest now” records you, quantity and time immediately. Returnable items automatically appear on the next housekeeper's room card until collected.
            </p>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading room requests…
        </div>
      ) : visibleRequests.length === 0 ? (
        <p className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          No guest requests recorded for {workDate}.
        </p>
      ) : (
        <div className="space-y-2.5">
          {visibleRequests.map(({ row, payload }) => {
            const open = payload.status === 'requested' || payload.status === 'delivered';
            const carried = open && payload.workDate < workDate;
            const latest = payload.events[payload.events.length - 1];
            const nextLabel = payload.status === 'requested'
              ? 'Mark delivered'
              : payload.requiresReturn
                ? 'Mark returned'
                : 'Resolve';

            return (
              <div key={row.id} className={`rounded-lg border p-3 ${carried ? 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/20' : 'bg-muted/15'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold">{payload.label} ×{payload.quantity}</span>
                      <Badge variant={open ? 'default' : 'secondary'} className="text-[10px] capitalize">{payload.status}</Badge>
                      {carried && <Badge variant="outline" className="border-amber-400 text-[10px]">Outstanding from {formatDate(payload.workDate)}</Badge>}
                    </div>
                    {payload.detail && <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{payload.detail}</p>}
                  </div>
                  {open && !readOnly && (
                    <Button
                      type="button"
                      size="sm"
                      variant={payload.status === 'requested' ? 'default' : 'outline'}
                      disabled={savingId !== null}
                      onClick={() => void advanceRequest(row, payload)}
                    >
                      {savingId === row.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : payload.status === 'requested' ? <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
                      {nextLabel}
                    </Button>
                  )}
                </div>

                <div className="mt-2 space-y-1 border-t pt-2">
                  {payload.events.map((event, index) => (
                    <div key={`${row.id}-${event.at}-${index}`} className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span className="min-w-0 truncate capitalize">{event.status} · {authorName(event.actorId)}</span>
                      <span className="shrink-0 flex items-center gap-1"><Clock3 className="h-3 w-3" /> {formatTime(event.at)}</span>
                    </div>
                  ))}
                  {!latest && <span className="text-[10px] text-muted-foreground">Created {formatTime(row.created_at)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}