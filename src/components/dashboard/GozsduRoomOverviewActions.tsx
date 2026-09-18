import React, { useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { hasManagerPowers } from '@/lib/roleAccess';
import { todayBudapest } from '@/lib/budapestTime';
import { GOZSDU_COURT_HOTEL_ID, GOZSDU_COURT_HOTEL_NAME } from '@/lib/gozsdu-housekeeping';
import { GOZSDU_ROOM_OVERRIDE_KEY, readGozsduRoomOverride, type GozsduRoomBucket } from '@/lib/gozsduRoomBucketOverride';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { GozsduCourtRoomOverview } from './GozsduCourtRoomOverview';
import { RoomDetailDialog } from './RoomDetailDialog';

type Props = React.ComponentProps<typeof GozsduCourtRoomOverview>;
type Service = 'towel_change' | 'change_room';
type RoomRow = {
  id: string; hotel: string | null; room_number: string; room_name: string | null;
  status: string | null; notes: string | null; room_type: string | null;
  floor_number: number | null; room_size_sqm: number | null;
  last_cleaned_at: string | null; last_cleaned_by: string | null;
  is_checkout_room: boolean | null; pms_metadata: any;
};
const HOTEL_KEYS = [GOZSDU_COURT_HOTEL_ID, GOZSDU_COURT_HOTEL_NAME];

/** PMS display labels differ from rooms.room_number. Use the chip's actual
 * data-room-id instead of passing visual text to the generic room quick hub. */
export function GozsduRoomOverviewActions(props: Props) {
  const { user, profile } = useAuth();
  const role = String(profile?.role || '').toLowerCase();
  const canManage = hasManagerPowers(profile?.role) || role === 'supervisor';
  const canOpen = canManage || role === 'reception';
  const canEdit = canManage && props.selectedDate >= todayBudapest();
  const [open, setOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bucket, setBucket] = useState<GozsduRoomBucket | ''>('');
  const [service, setService] = useState<Service>('towel_change');
  const [reason, setReason] = useState('');
  const requestId = useRef(0);
  const lastDragEnded = useRef(0);

  const onChipClick = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (!canOpen || Date.now() - lastDragEnded.current < 350) return;
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-room-id]') : null;
    const id = target?.dataset.roomId;
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    const current = ++requestId.current;
    setRoom(null);
    setLabel(target.textContent?.trim() || 'Room');
    setLoading(true);
    setOpen(true);
    try {
      const [roomResult, registryResult] = await Promise.all([
        supabase.from('rooms').select('id,hotel,room_number,room_name,status,notes,room_type,floor_number,room_size_sqm,last_cleaned_at,last_cleaned_by,is_checkout_room,pms_metadata')
          .eq('id', id).in('hotel', HOTEL_KEYS).maybeSingle(),
        (supabase as any).from('gozsdu_housekeeping_room_registry')
          .select('room_id,pms_room_name,service_status').eq('room_id', id).maybeSingle(),
      ]);
      if (current !== requestId.current) return;
      if (roomResult.error) throw roomResult.error;
      if (registryResult.error) throw registryResult.error;
      const found = roomResult.data as RoomRow | null;
      if (!found || !registryResult.data) throw new Error('This room is not mapped to Gozsdu. Refresh the room registry.');
      setRoom(found);
      setLabel(registryResult.data.pms_room_name || found.room_number);
      const override = readGozsduRoomOverride(found.pms_metadata, props.selectedDate);
      // No default target: a tap and an accidental Save must never move a room.
      setBucket(override?.bucket || '');
      setService(override?.service === 'change_room' ? 'change_room' : 'towel_change');
      setReason(override?.reason || '');
      if (registryResult.data.service_status !== 'operating') {
        toast.warning('This room is unavailable for housekeeping. Its details are read-only.');
        setRoom(null);
      }
    } catch (error) {
      console.error('[Gozsdu] room lookup by ID failed', error);
      toast.error(error instanceof Error ? error.message : 'Could not open this room.');
      setOpen(false);
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  };

  const save = async () => {
    if (!room || !bucket || !canEdit || saving || room.pms_metadata?.isNoShow === true) return;
    setSaving(true);
    try {
      // Read fresh metadata to preserve any PMS changes and other day overrides.
      const { data: fresh, error: readError } = await supabase.from('rooms')
        .select('id,hotel,pms_metadata').eq('id', room.id).in('hotel', HOTEL_KEYS).maybeSingle();
      if (readError) throw readError;
      if (!fresh) throw new Error('Gozsdu room no longer available. Refresh and retry.');
      const { data: assignments, error: assignmentError } = await supabase.from('room_assignments')
        .select('id,status,assignment_type').eq('room_id', room.id).eq('assignment_date', props.selectedDate);
      if (assignmentError) throw assignmentError;
      if ((assignments || []).some(row => row.status === 'in_progress' || row.status === 'completed')) {
        throw new Error('Cleaning has started or finished. Resolve the active assignment before changing this room.');
      }
      const previousMetadata: Record<string, any> = fresh.pms_metadata && typeof fresh.pms_metadata === 'object' && !Array.isArray(fresh.pms_metadata)
        ? fresh.pms_metadata as Record<string, any> : {};
      const previousOverrides: Record<string, unknown> = previousMetadata[GOZSDU_ROOM_OVERRIDE_KEY] && typeof previousMetadata[GOZSDU_ROOM_OVERRIDE_KEY] === 'object'
        ? previousMetadata[GOZSDU_ROOM_OVERRIDE_KEY] : {};
      const nextMetadata = {
        ...previousMetadata,
        [GOZSDU_ROOM_OVERRIDE_KEY]: {
          ...previousOverrides,
          [props.selectedDate]: {
            date: props.selectedDate,
            bucket,
            service: bucket === 'service' ? service : 'none',
            reason: reason.trim(),
            changedAt: new Date().toISOString(),
            changedBy: profile?.id || user?.id || '',
          },
        },
      };
      const { data: savedRooms, error: writeError } = await supabase.from('rooms')
        .update({ pms_metadata: nextMetadata } as any).eq('id', room.id).in('hotel', HOTEL_KEYS).select('id');
      if (writeError) throw writeError;
      if (savedRooms?.length !== 1) throw new Error('Room update was not permitted for this property.');
      if (assignments?.length) {
        const { data: changed, error } = await supabase.from('room_assignments')
          .update({ assignment_type: bucket === 'checkout' ? 'checkout_cleaning' : 'daily_cleaning' } as any)
          .eq('room_id', room.id).eq('assignment_date', props.selectedDate).select('id');
        if (error || changed?.length !== assignments.length) {
          const { error: rollbackError } = await supabase.from('rooms').update({ pms_metadata: previousMetadata } as any)
            .eq('id', room.id).in('hotel', HOTEL_KEYS);
          if (rollbackError) console.error('[Gozsdu] override rollback failed', rollbackError);
          throw error || new Error('Assignment update was not permitted. No service change was confirmed.');
        }
      }
      toast.success(`Room ${label} moved to ${bucket === 'checkout' ? 'Checkout' : bucket === 'service' ? 'Second-day service' : 'Other rooms'}`);
      setOpen(false);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    } catch (error) {
      console.error('[Gozsdu] changing cleaning section failed', error);
      toast.error(error instanceof Error ? error.message : 'Could not change this room.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div onClickCapture={event => { void onChipClick(event); }} onDragEndCapture={() => { lastDragEnded.current = Date.now(); }}>
        <GozsduCourtRoomOverview {...props} />
      </div>
      <Dialog open={open} onOpenChange={next => { if (!next) requestId.current++; setOpen(next); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader><DialogTitle>Room {label}</DialogTitle></DialogHeader>
          {loading ? <p className="text-sm text-muted-foreground">Loading room details…</p> : room ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Room status: {room.status || 'Unknown'} · {props.selectedDate}</p>
              {canEdit && room.pms_metadata?.isNoShow !== true ? <>
                <label className="block space-y-1 text-sm font-medium">Move room to
                  <Select value={bucket} onValueChange={value => setBucket(value as GozsduRoomBucket)}>
                    <SelectTrigger><SelectValue placeholder="Choose a cleaning section" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="checkout">Checkout cleaning</SelectItem>
                      <SelectItem value="service">Second-day cleaning</SelectItem>
                      <SelectItem value="other">Other rooms — no service today</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                {bucket === 'service' && <label className="block space-y-1 text-sm font-medium">Cleaning required
                  <Select value={service} onValueChange={value => setService(value as Service)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="towel_change">Towel change</SelectItem>
                      <SelectItem value="change_room">Full cleaning / complete textile change</SelectItem>
                    </SelectContent>
                  </Select>
                </label>}
                <label className="block space-y-1 text-sm font-medium">Reason (optional)
                  <Input value={reason} onChange={event => setReason(event.target.value)} maxLength={200} placeholder="e.g. Cleaning missed yesterday" />
                </label>
                <p className="text-xs text-muted-foreground">Changes the HotelCare cleaning plan for this date only. It does not change the guest's Previo reservation or departure date.</p>
                <Button className="w-full" disabled={saving || !bucket} onClick={() => void save()}>{saving ? 'Saving…' : 'Save cleaning section'}</Button>
              </> : <p className="text-xs text-muted-foreground">Only authorized managers and supervisors can change today's or a future day's cleaning plan.</p>}
              <Button variant="outline" className="w-full" onClick={() => { setOpen(false); setDetailsOpen(true); }}>Open full room details</Button>
            </div>
          ) : <p className="text-sm text-muted-foreground">Room information is unavailable. Refresh the overview.</p>}
        </DialogContent>
      </Dialog>
      <RoomDetailDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        room={room ? {
          id: room.id, room_number: room.room_number, room_name: room.room_name || undefined,
          hotel: room.hotel || GOZSDU_COURT_HOTEL_NAME, status: room.status || 'dirty',
          room_type: room.room_type || undefined, floor_number: room.floor_number ?? undefined,
          notes: room.notes || undefined, last_cleaned_at: room.last_cleaned_at || undefined,
          last_cleaned_by: room.last_cleaned_by || undefined, room_size_sqm: room.room_size_sqm ?? undefined,
        } : null}
        onRoomUpdated={() => window.dispatchEvent(new CustomEvent('hk-assignments-changed'))}
      />
    </>
  );
}
