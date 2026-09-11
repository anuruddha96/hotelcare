import { useEffect, useMemo, useState } from 'react';
import { Clock3, FilePenLine, Loader2, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  parkingDisplayStatus,
  parkingErrorMessage,
  type ParkingAccess,
  type ParkingTicket,
  type ParkingTicketEvent,
} from '@/lib/parking';
import {
  listParkingEvents,
  setCancellationReported,
  updateParkingTicket,
  voidParkingTicket,
} from '@/lib/parkingApi';
import { ParkingStatusBadge } from './ParkingStatusBadge';

interface Props {
  open: boolean;
  ticket: ParkingTicket | null;
  access: ParkingAccess;
  onOpenChange: (open: boolean) => void;
  onChanged: (ticket: ParkingTicket) => void;
}

const EVENT_LABELS: Record<ParkingTicketEvent['event_type'], string> = {
  issued: 'Ticket issued',
  updated: 'Ticket details updated',
  voided: 'Ticket voided',
  cancellation_reported: 'Cancellation reported',
  cancellation_reopened: 'Cancellation record reopened',
};

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function ParkingTicketDialog({ open, ticket, access, onOpenChange, onChanged }: Props) {
  const [current, setCurrent] = useState<ParkingTicket | null>(ticket);
  const [events, setEvents] = useState<ParkingTicketEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [reservationRef, setReservationRef] = useState('');
  const [guestName, setGuestName] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    setCurrent(ticket);
    setEditing(false);
    setVoidOpen(false);
    setVoidReason('');
    if (ticket) {
      setValidFrom(ticket.valid_from || '');
      setValidTo(ticket.valid_to || '');
      setReservationRef(ticket.reservation_ref || '');
      setGuestName(ticket.guest_name || '');
      setRoomNumber(ticket.room_number || '');
      setNotes(ticket.notes || '');
    }
  }, [ticket, open]);

  useEffect(() => {
    if (!open || !current?.id) return;
    let alive = true;
    setEventsLoading(true);
    listParkingEvents(current.id)
      .then((rows) => { if (alive) setEvents(rows); })
      .catch(() => { if (alive) setEvents([]); })
      .finally(() => { if (alive) setEventsLoading(false); });
    return () => { alive = false; };
  }, [open, current?.id, current?.updated_at]);

  const displayStatus = useMemo(
    () => current ? parkingDisplayStatus(current) : 'available',
    [current],
  );

  const applyChange = (next: ParkingTicket) => {
    setCurrent(next);
    onChanged(next);
  };

  async function saveEdit() {
    if (!current) return;
    if (!validFrom || !validTo || validTo < validFrom) return toast.error('Enter a valid date range.');
    if (!reservationRef.trim() && !guestName.trim() && !roomNumber.trim()) {
      return toast.error('Add a reservation number, guest name, or room number.');
    }
    setBusy(true);
    try {
      const next = await updateParkingTicket({
        ticketId: current.id,
        validFrom,
        validTo,
        reservationRef: reservationRef.trim() || null,
        guestName: guestName.trim() || null,
        roomNumber: roomNumber.trim() || null,
        notes: notes.trim() || null,
      });
      applyChange(next);
      setEditing(false);
      toast.success('Parking ticket updated.');
    } catch (error) {
      toast.error(parkingErrorMessage(error, 'Could not update the ticket.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmVoid() {
    if (!current) return;
    setBusy(true);
    try {
      const next = await voidParkingTicket(current.id, voidReason);
      applyChange(next);
      setVoidOpen(false);
      setVoidReason('');
      toast.success('Parking ticket voided and recorded.');
    } catch (error) {
      toast.error(parkingErrorMessage(error, 'Could not void the ticket.'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleCancellationReported() {
    if (!current) return;
    const reported = !current.cancellation_reported_at;
    setBusy(true);
    try {
      const next = await setCancellationReported(current.id, reported);
      applyChange(next);
      toast.success(reported ? 'Cancellation marked as reported.' : 'Cancellation record reopened.');
    } catch (error) {
      toast.error(parkingErrorMessage(error, 'Could not update the cancellation record.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          {current && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <DialogTitle className="font-mono text-xl">{current.reference}</DialogTitle>
                  <ParkingStatusBadge status={displayStatus} />
                  {current.cancellation_reported_at && <Badge variant="secondary">Reported</Badge>}
                </div>
                <DialogDescription>Complete issue record and audit timeline.</DialogDescription>
              </DialogHeader>

              {editing ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5"><Label htmlFor="edit-parking-from">Valid from</Label><Input id="edit-parking-from" type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></div>
                    <div className="space-y-1.5"><Label htmlFor="edit-parking-to">Valid to</Label><Input id="edit-parking-to" type="date" min={validFrom} value={validTo} onChange={(event) => setValidTo(event.target.value)} /></div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5"><Label htmlFor="edit-parking-reservation">Reservation</Label><Input id="edit-parking-reservation" value={reservationRef} onChange={(event) => setReservationRef(event.target.value)} /></div>
                    <div className="space-y-1.5"><Label htmlFor="edit-parking-guest">Guest</Label><Input id="edit-parking-guest" value={guestName} onChange={(event) => setGuestName(event.target.value)} /></div>
                    <div className="space-y-1.5"><Label htmlFor="edit-parking-room">Room</Label><Input id="edit-parking-room" value={roomNumber} onChange={(event) => setRoomNumber(event.target.value)} /></div>
                  </div>
                  <div className="space-y-1.5"><Label htmlFor="edit-parking-notes">Notes</Label><Textarea id="edit-parking-notes" value={notes} maxLength={1000} onChange={(event) => setNotes(event.target.value)} /></div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
                    <Button onClick={saveEdit} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save changes</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-2">
                    <div><p className="text-xs text-muted-foreground">Validity</p><p className="font-medium">{current.valid_from || '—'} → {current.valid_to || '—'}</p></div>
                    <div><p className="text-xs text-muted-foreground">Issued</p><p className="font-medium">{formatTimestamp(current.issued_at)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Reservation</p><p className="font-medium">{current.reservation_ref || '—'}</p></div>
                    <div><p className="text-xs text-muted-foreground">Guest / room</p><p className="font-medium">{[current.guest_name, current.room_number && `Room ${current.room_number}`].filter(Boolean).join(' · ') || '—'}</p></div>
                    {current.notes && <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Notes</p><p className="whitespace-pre-wrap">{current.notes}</p></div>}
                    {current.void_reason && <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Void reason</p><p className="text-destructive">{current.void_reason}</p></div>}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {current.status === 'issued' && !current.cancellation_reported_at && (
                      <Button variant="outline" size="sm" onClick={() => setEditing(true)}><FilePenLine className="mr-1.5 h-4 w-4" />Edit</Button>
                    )}
                    {access === 'manage' && current.status === 'issued' && (
                      <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setVoidOpen(true)}><Trash2 className="mr-1.5 h-4 w-4" />Void</Button>
                    )}
                    {access === 'manage' && displayStatus === 'expired' && current.status === 'issued' && (
                      <Button variant="outline" size="sm" onClick={toggleCancellationReported} disabled={busy}>
                        {current.cancellation_reported_at ? <RotateCcw className="mr-1.5 h-4 w-4" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}
                        {current.cancellation_reported_at ? 'Reopen report record' : 'Mark cancellation reported'}
                      </Button>
                    )}
                  </div>
                </>
              )}

              <Separator />
              <section>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Clock3 className="h-4 w-4" />Audit history</h3>
                {eventsLoading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading history…</p>
                ) : events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recorded events.</p>
                ) : (
                  <div className="space-y-0">
                    {events.map((event, index) => (
                      <div key={event.id} className="relative flex gap-3 pb-4">
                        {index < events.length - 1 && <span className="absolute left-[5px] top-3 h-full w-px bg-border" />}
                        <span className="relative mt-1.5 h-3 w-3 shrink-0 rounded-full bg-primary ring-4 ring-background" />
                        <div><p className="text-sm font-medium">{EVENT_LABELS[event.event_type]}</p><p className="text-xs text-muted-foreground">{event.actor_name} · {formatTimestamp(event.created_at)}</p></div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={voidOpen} onOpenChange={setVoidOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Void parking ticket {current?.reference}?</AlertDialogTitle><AlertDialogDescription>This preserves the issue record and writes the reason to the audit history. The ticket cannot be issued again.</AlertDialogDescription></AlertDialogHeader>
          <div className="space-y-1.5"><Label htmlFor="parking-void-reason">Reason</Label><Textarea id="parking-void-reason" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Why is this ticket being voided?" maxLength={500} /></div>
          <AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep ticket</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); void confirmVoid(); }} disabled={busy || voidReason.trim().length < 3} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Void ticket</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
