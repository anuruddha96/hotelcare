import React, { useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { hasManagerPowers } from '@/lib/roleAccess';
import { todayBudapest } from '@/lib/budapestTime';
import { GOZSDU_COURT_HOTEL_ID, GOZSDU_COURT_HOTEL_NAME, getGozsduHousekeepingCycle } from '@/lib/gozsdu-housekeeping';
import { GOZSDU_ROOM_OVERRIDE_KEY, readGozsduRoomOverride, type GozsduRoomBucket } from '@/lib/gozsduRoomBucketOverride';
import { gozsduDropBucket } from '@/lib/gozsduRoomDropTarget';
import { assignRoomToStaff, isAssignmentInProgressError, readHousekeeperDragPayload, readRoomDragPayload } from '@/lib/hkAssignmentDnd';
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
type Assignment = { id: string; assigned_to: string; status: string; assignment_type: string };
const HOTEL_KEYS = [GOZSDU_COURT_HOTEL_ID, GOZSDU_COURT_HOTEL_NAME];
const ROOM_SELECT = 'id,hotel,room_number,room_name,status,notes,room_type,floor_number,room_size_sqm,last_cleaned_at,last_cleaned_by,is_checkout_room,pms_metadata';
const SECTION_NAMES: Array<{ bucket: GozsduRoomBucket; title: string }> = [
  { bucket: 'checkout', title: 'Checkout' },
  { bucket: 'service', title: 'Second-day cleaning' },
  { bucket: 'other', title: 'Other rooms' },
];

/** Gozsdu has distinct PMS display labels and internal room IDs. All click and
 * drag actions resolve the ID and stay within this property's live inventory. */
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
  const [staffId, setStaffId] = useState('keep');
  const [currentStaff, setCurrentStaff] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [dropZone, setDropZone] = useState<string | null>(null);
  const requestId = useRef(0);
  const lastDragEnded = useRef(0);
  const availableStaff = Object.entries(props.staffMap)
    .filter(([id, name]) => !!id && !!name?.trim())
    .sort((a, b) => a[1].localeCompare(b[1]));

  const openRoom = async (id: string, targetBucket: GozsduRoomBucket | null = null, targetStaff = 'keep') => {
    if (!canOpen || !id) return;
    const current = ++requestId.current;
    setRoom(null);
    setLabel('Room');
    setBucket('');
    setStaffId('keep');
    setCurrentStaff(null);
    setLocked(false);
    setLoading(true);
    setOpen(true);
    try {
      const [roomResult, registryResult, assignmentResult] = await Promise.all([
        supabase.from('rooms').select(ROOM_SELECT)
          .eq('id', id).in('hotel', HOTEL_KEYS).maybeSingle(),
        (supabase as any).from('gozsdu_housekeeping_room_registry')
          .select('room_id,pms_room_name,service_status').eq('room_id', id).maybeSingle(),
        supabase.from('room_assignments')
          .select('id,assigned_to,status,assignment_type').eq('room_id', id).eq('assignment_date', props.selectedDate),
      ]);
      if (current !== requestId.current) return;
      if (roomResult.error) throw roomResult.error;
      if (registryResult.error) throw registryResult.error;
      if (assignmentResult.error) throw assignmentResult.error;
      const found = roomResult.data as RoomRow | null;
      const registered = registryResult.data;
      if (!found || !registered) throw new Error('This room is not mapped to Gozsdu. Refresh the room registry.');
      if (registered.service_status !== 'operating') throw new Error('This room is unavailable for housekeeping.');
      if (found.pms_metadata?.isNoShow === true) throw new Error('No-show rooms cannot be assigned or moved to cleaning.');
      const rows = (assignmentResult.data || []) as Assignment[];
      const existing = rows.find(row => row.status !== 'completed') || rows[0] || null;
      const override = readGozsduRoomOverride(found.pms_metadata, props.selectedDate);
      const cycle = getGozsduHousekeepingCycle({
        currentNight: found.pms_metadata?.currentNight,
        totalNights: found.pms_metadata?.totalNights,
        isCheckout: false,
      }).service;
      const inferred: GozsduRoomBucket = found.is_checkout_room ? 'checkout' : cycle !== 'none' ? 'service' : 'other';
      setRoom(found);
      setLabel(registered.pms_room_name || found.room_number);
      setBucket(targetBucket || override?.bucket || inferred);
      setService(override?.service === 'change_room' || (!override && cycle === 'change_room') ? 'change_room' : 'towel_change');
      setReason(override?.reason || '');
      setCurrentStaff(existing?.assigned_to || null);
      setStaffId(targetStaff !== 'keep' && !!props.staffMap[targetStaff] ? targetStaff : 'keep');
      setLocked(rows.some(row => row.status === 'in_progress' || row.status === 'completed'));
    } catch (error) {
      console.error('[Gozsdu] room lookup by ID failed', error);
      if (current === requestId.current) {
        toast.error(error instanceof Error ? error.message : 'Could not open this room.');
        setOpen(false);
      }
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  };

  const onChipClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!canOpen || Date.now() - lastDragEnded.current < 350) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-room-id]') : null;
    if (!target?.dataset.roomId) return;
    event.preventDefault();
    event.stopPropagation();
    void openRoom(target.dataset.roomId, gozsduDropBucket(target));
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canEdit) return;
    const types = Array.from(event.dataTransfer.types, value => value.toLowerCase());
    const section = gozsduDropBucket(event.target);
    const roomTarget = event.target instanceof Element ? event.target.closest('[data-room-id]') : null;
    if ((section && types.includes('roomid')) || (roomTarget && types.includes('housekeeperid'))) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropZone(section || 'housekeeper');
    }
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canEdit) return;
    const destination = gozsduDropBucket(event.target);
    const draggedRoom = readRoomDragPayload(event);
    if (draggedRoom && destination) {
      event.preventDefault();
      event.stopPropagation();
      setDropZone(null);
      void openRoom(draggedRoom.roomId, destination);
      return;
    }
    const roomTarget = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-room-id]') : null;
    const draggedStaff = readHousekeeperDragPayload(event);
    if (roomTarget?.dataset.roomId && draggedStaff) {
      event.preventDefault();
      event.stopPropagation();
      setDropZone(null);
      void openRoom(roomTarget.dataset.roomId, gozsduDropBucket(roomTarget), draggedStaff.staffId);
    }
  };

  const save = async () => {
    if (!room || !bucket || !canEdit || saving || locked) return;
    if (staffId !== 'keep' && bucket === 'other') {
      toast.warning('Choose Checkout or Second-day cleaning before assigning a housekeeper.');
      return;
    }
    setSaving(true);
    let previousMetadata: Record<string, any> | null = null;
    let metadataSaved = false;
    let assignmentTypes: Assignment[] = [];
    try {
      const [freshResult, registryResult, assignmentsResult] = await Promise.all([
        supabase.from('rooms').select('id,hotel,pms_metadata').eq('id', room.id).in('hotel', HOTEL_KEYS).maybeSingle(),
        (supabase as any).from('gozsdu_housekeeping_room_registry').select('room_id,service_status').eq('room_id', room.id).maybeSingle(),
        supabase.from('room_assignments').select('id,assigned_to,status,assignment_type')
          .eq('room_id', room.id).eq('assignment_date', props.selectedDate),
      ]);
      if (freshResult.error) throw freshResult.error;
      if (registryResult.error) throw registryResult.error;
      if (assignmentsResult.error) throw assignmentsResult.error;
      const fresh = freshResult.data;
      if (!fresh || registryResult.data?.service_status !== 'operating') throw new Error('This Gozsdu room is no longer available. Refresh and retry.');
      if (fresh.pms_metadata?.isNoShow === true) throw new Error('No-show rooms cannot be assigned to cleaning.');
      assignmentTypes = (assignmentsResult.data || []) as Assignment[];
      if (assignmentTypes.some(row => row.status === 'in_progress' || row.status === 'completed')) {
        throw new Error('Cleaning has started or finished. Resolve the active assignment before changing this room.');
      }
      if (bucket === 'other' && assignmentTypes.length) {
        throw new Error('Unassign this room first before moving it to Other (no cleaning).');
      }
      if (staffId !== 'keep') {
        if (!props.staffMap[staffId] || !profile?.organization_slug) throw new Error('Select an eligible Gozsdu housekeeper.');
        const { data: member, error: memberError } = await supabase.from('profiles')
          .select('id').eq('id', staffId).eq('organization_slug', profile.organization_slug)
          .in('assigned_hotel', HOTEL_KEYS).maybeSingle();
        if (memberError) throw memberError;
        if (!member) throw new Error('This housekeeper is not assigned to Gozsdu Court.');
      }
      previousMetadata = fresh.pms_metadata && typeof fresh.pms_metadata === 'object' && !Array.isArray(fresh.pms_metadata)
        ? fresh.pms_metadata as Record<string, any> : {};
      const previousOverrides: Record<string, unknown> = previousMetadata[GOZSDU_ROOM_OVERRIDE_KEY]
        && typeof previousMetadata[GOZSDU_ROOM_OVERRIDE_KEY] === 'object'
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
      metadataSaved = true;
      if (assignmentTypes.length) {
        const { data: changed, error } = await supabase.from('room_assignments')
          .update({ assignment_type: bucket === 'checkout' ? 'checkout_cleaning' : 'daily_cleaning' } as any)
          .eq('room_id', room.id).eq('assignment_date', props.selectedDate).select('id');
        if (error || changed?.length !== assignmentTypes.length) throw error || new Error('Could not update existing cleaning assignments.');
      }
      if (staffId !== 'keep') {
        await assignRoomToStaff({
          roomId: room.id, staffId, assignmentDate: props.selectedDate,
          assignedBy: profile?.id || user?.id || '', organizationSlug: profile?.organization_slug || null,
          isCheckoutRoom: bucket === 'checkout',
        });
      }
      toast.success(staffId === 'keep'
        ? `Room ${label} moved to ${SECTION_NAMES.find(item => item.bucket === bucket)?.title}`
        : `Room ${label} assigned to ${props.staffMap[staffId]} · ${bucket === 'checkout' ? 'Checkout' : service === 'change_room' ? 'Full cleaning / textile change' : 'Towel change'}`);
      setOpen(false);
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
    } catch (error) {
      console.error('[Gozsdu] cleaning/assignment change failed', error);
      // Best-effort recovery: if the assignment write fails, restore the room
      // category and previously recorded types, never announce a false success.
      if (metadataSaved && previousMetadata) {
        const { error: rollbackError } = await supabase.from('rooms').update({ pms_metadata: previousMetadata } as any)
          .eq('id', room.id).in('hotel', HOTEL_KEYS);
        if (rollbackError) console.error('[Gozsdu] metadata rollback failed', rollbackError);
        for (const previous of assignmentTypes) {
          const { error: typeError } = await supabase.from('room_assignments')
            .update({ assignment_type: previous.assignment_type } as any).eq('id', previous.id);
          if (typeError) console.error('[Gozsdu] assignment rollback failed', typeError);
        }
        window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
      }
      if (isAssignmentInProgressError(error)) toast.warning('Cleaning has already started; assignment cannot be changed.');
      else toast.error(error instanceof Error ? error.message : 'Could not save the cleaning assignment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div onClickCapture={onChipClick} onDragOverCapture={onDragOver} onDropCapture={onDrop}
        onDragEndCapture={() => { lastDragEnded.current = Date.now(); setDropZone(null); }}>
        {canEdit && <div className="mb-2 space-y-2 rounded-lg border border-primary/30 bg-muted/30 p-2" aria-label="Gozsdu room assignment controls">
          <p className="text-xs text-muted-foreground">Drag a room into a cleaning section or onto a housekeeper below. For cleaning type and direct assignment, click its room chip. Dropping opens a confirmation before changes are saved.</p>
          <div className="flex flex-wrap gap-1.5">
            {SECTION_NAMES.map(item => <div key={item.bucket}
              onDragOver={event => { if (Array.from(event.dataTransfer.types).some(type => type.toLowerCase() === 'roomid')) { event.preventDefault(); setDropZone(item.bucket); } }}
              onDrop={event => { const payload = readRoomDragPayload(event); if (!payload) return; event.preventDefault(); event.stopPropagation(); setDropZone(null); void openRoom(payload.roomId, item.bucket); }}
              className={`rounded-md border border-dashed px-2 py-1.5 text-xs font-medium transition-colors ${dropZone === item.bucket ? 'border-primary bg-primary/15 ring-2 ring-primary' : 'border-border bg-background'}`}>
              Drop → {item.title}
            </div>)}
          </div>
          {availableStaff.length > 0 && <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Assign to:</span>
            {availableStaff.map(([id, name]) => <div key={id}
              onDragOver={event => { if (Array.from(event.dataTransfer.types).some(type => type.toLowerCase() === 'roomid')) { event.preventDefault(); setDropZone(id); } }}
              onDrop={event => { const payload = readRoomDragPayload(event); if (!payload) return; event.preventDefault(); event.stopPropagation(); setDropZone(null); void openRoom(payload.roomId, null, id); }}
              className={`rounded-full border px-2 py-1 text-xs ${dropZone === id ? 'border-primary bg-primary/15 ring-2 ring-primary' : 'bg-background'}`}
              title={`Drop a room here to assign to ${name}`}>{name}</div>)}
          </div>}
        </div>}
        <GozsduCourtRoomOverview {...props} />
      </div>
      <Dialog open={open} onOpenChange={next => { if (!next) requestId.current++; setOpen(next); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader><DialogTitle>Room {label}</DialogTitle></DialogHeader>
          {loading ? <p className="text-sm text-muted-foreground">Loading room details…</p> : room ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Room status: {room.status || 'Unknown'} · {props.selectedDate}</p>
              {currentStaff && <p className="text-xs text-muted-foreground">Currently assigned: {props.staffMap[currentStaff] || 'Existing housekeeper'}</p>}
              {locked && <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-900">Cleaning is already in progress or completed. Reassignment and cleaning-type changes are locked.</p>}
              {canEdit && !locked ? <>
                <label className="block space-y-1 text-sm font-medium">Cleaning section
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
                <label className="block space-y-1 text-sm font-medium">Assign to housekeeper
                  <Select value={staffId} onValueChange={setStaffId}>
                    <SelectTrigger><SelectValue placeholder="Choose housekeeper" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keep">{currentStaff ? 'Keep existing housekeeper' : 'Do not assign yet'}</SelectItem>
                      {availableStaff.map(([id, name]) => <SelectItem key={id} value={id}>{name}{props.signedInHousekeepers?.some(person => person.id === id) ? ' · Signed in' : ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <label className="block space-y-1 text-sm font-medium">Reason (optional)
                  <Input value={reason} onChange={event => setReason(event.target.value)} maxLength={200} placeholder="e.g. Cleaning missed yesterday" />
                </label>
                <p className="text-xs text-muted-foreground">Changes HotelCare's plan for this date only; never changes the Previo reservation or guest departure. Room assignments cannot be changed after cleaning starts.</p>
                <Button className="w-full" disabled={saving || !bucket || (bucket === 'other' && staffId !== 'keep')}
                  onClick={() => void save()}>{saving ? 'Saving…' : staffId === 'keep' ? 'Save cleaning section' : 'Save & assign room'}</Button>
              </> : <p className="text-xs text-muted-foreground">Only authorized managers and supervisors can change the cleaning plan. Past dates remain read-only.</p>}
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
