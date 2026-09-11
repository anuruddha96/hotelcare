import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, Loader2, Mail, Search, TicketCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  addDaysISO,
  normalizeParkingReference,
  parkingDisplayStatus,
  parkingErrorMessage,
  todayISO,
  type ParkingSettings,
  type ParkingTicket,
} from '@/lib/parking';
import { issueParkingTicket, searchParkingTickets } from '@/lib/parkingApi';
import { ParkingStatusBadge } from './ParkingStatusBadge';

interface Props {
  organizationSlug: string;
  hotelId: string;
  settings: ParkingSettings | null;
  onIssued: (ticket: ParkingTicket) => void;
}

type LookupState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'missing' }
  | { kind: 'found'; ticket: ParkingTicket }
  | { kind: 'error' };

export function IssueParkingTicket({ organizationSlug, hotelId, settings, onIssued }: Props) {
  const today = useMemo(() => todayISO(), []);
  const validityDays = settings?.default_validity_days || 1;
  const [reference, setReference] = useState('');
  const [validFrom, setValidFrom] = useState(today);
  const [validTo, setValidTo] = useState(addDaysISO(today, validityDays - 1));
  const [reservationRef, setReservationRef] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [roomNumber, setRoomNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [lookup, setLookup] = useState<LookupState>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [lastIssued, setLastIssued] = useState<ParkingTicket | null>(null);

  useEffect(() => {
    if (validFrom === today) setValidTo(addDaysISO(validFrom, validityDays - 1));
  }, [validityDays, validFrom, today]);

  useEffect(() => {
    if (!settings?.guest_email_enabled) setGuestEmail('');
  }, [settings?.guest_email_enabled]);

  useEffect(() => {
    const normalized = normalizeParkingReference(reference);
    if (normalized.length < 3) {
      setLookup({ kind: 'idle' });
      return;
    }

    let alive = true;
    const timer = window.setTimeout(async () => {
      setLookup({ kind: 'checking' });
      try {
        const matches = await searchParkingTickets({
          organizationSlug,
          hotelId,
          query: reference,
          status: 'all',
          limit: 20,
        });
        if (!alive) return;
        const exact = matches.find((ticket) => ticket.reference_search === normalized);
        setLookup(exact ? { kind: 'found', ticket: exact } : { kind: 'missing' });
      } catch {
        if (alive) setLookup({ kind: 'error' });
      }
    }, 350);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [reference, organizationSlug, hotelId]);

  const handleValidFrom = (value: string) => {
    setValidFrom(value);
    if (value) setValidTo(addDaysISO(value, validityDays - 1));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reference.trim()) return toast.error('Enter the parking ticket number.');
    if (!validFrom || !validTo || validTo < validFrom) return toast.error('Enter a valid date range.');
    if (!reservationRef.trim() && !guestName.trim() && !roomNumber.trim()) {
      return toast.error('Add a reservation number, guest name, or room number.');
    }

    setBusy(true);
    try {
      const ticket = await issueParkingTicket({
        organizationSlug,
        hotelId,
        reference: reference.trim(),
        validFrom,
        validTo,
        reservationRef: reservationRef.trim() || null,
        guestName: guestName.trim() || null,
        guestEmail: settings?.guest_email_enabled ? guestEmail.trim() || null : null,
        roomNumber: roomNumber.trim() || null,
        notes: notes.trim() || null,
      });
      setLastIssued(ticket);
      setReference('');
      setReservationRef('');
      setGuestName('');
      setGuestEmail('');
      setRoomNumber('');
      setNotes('');
      setLookup({ kind: 'idle' });
      toast.success(`Parking ticket ${ticket.reference} issued.`);
      onIssued(ticket);
    } catch (error) {
      toast.error(parkingErrorMessage(error, 'Could not issue this parking ticket.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,.7fr)]">
      <Card className="border-primary/20 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <TicketCheck className="h-5 w-5 text-primary" />
            Issue a parking ticket
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Search is separator-insensitive, so numbers work with or without spaces and dashes.
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="parking-reference">Ticket number</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="parking-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="e.g. 43930-21096"
                  autoComplete="off"
                  className="pl-9 font-mono text-base"
                  autoFocus
                />
              </div>
              {lookup.kind === 'checking' && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Checking inventory…
                </p>
              )}
              {lookup.kind === 'found' && (
                <div className="flex items-center gap-2 text-xs">
                  <ParkingStatusBadge status={parkingDisplayStatus(lookup.ticket)} />
                  <span className="text-muted-foreground">
                    {lookup.ticket.expires_on ? `Batch expires ${lookup.ticket.expires_on}` : 'No batch expiry'}
                  </span>
                </div>
              )}
              {lookup.kind === 'missing' && (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <CircleAlert className="h-3 w-3" /> Not found in this hotel's inventory.
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="parking-valid-from">Valid from</Label>
                <Input id="parking-valid-from" type="date" value={validFrom} onChange={(event) => handleValidFrom(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="parking-valid-to">Valid to</Label>
                <Input id="parking-valid-to" type="date" min={validFrom} value={validTo} onChange={(event) => setValidTo(event.target.value)} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="parking-reservation">Reservation no.</Label>
                <Input id="parking-reservation" value={reservationRef} onChange={(event) => setReservationRef(event.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="parking-guest">Guest name</Label>
                <Input id="parking-guest" value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="parking-room">Room</Label>
                <Input id="parking-room" value={roomNumber} onChange={(event) => setRoomNumber(event.target.value)} placeholder="Optional" />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">At least one guest identifier is required.</p>

            {settings?.guest_email_enabled && (
              <div className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
                <Label htmlFor="parking-guest-email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-primary" /> Guest email
                </Label>
                <Input
                  id="parking-guest-email"
                  type="email"
                  value={guestEmail}
                  onChange={(event) => setGuestEmail(event.target.value)}
                  placeholder="guest@example.com"
                  autoComplete="email"
                  maxLength={254}
                />
                <p className="text-xs text-muted-foreground">
                  Optional. HotelCare will queue a branded parking voucher email after the ticket is issued. The physical ticket still controls parking access unless your parking operator accepts digital vouchers.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="parking-notes">Notes</Label>
              <Textarea id="parking-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional handover note" maxLength={1000} />
            </div>

            <Button className="w-full sm:w-auto" type="submit" disabled={busy || lookup.kind === 'checking'}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TicketCheck className="mr-2 h-4 w-4" />}
              Issue ticket
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {lastIssued ? (
          <Alert className="border-emerald-300 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertDescription className="space-y-2">
              <p className="font-semibold text-emerald-800 dark:text-emerald-200">Ticket issued successfully</p>
              <p className="font-mono text-xl font-bold">{lastIssued.reference}</p>
              <div className="text-xs text-muted-foreground">
                <p>{lastIssued.valid_from} → {lastIssued.valid_to}</p>
                <p>{lastIssued.reservation_ref || lastIssued.guest_name || `Room ${lastIssued.room_number}`}</p>
                {lastIssued.guest_email && <p>Guest voucher queued for {lastIssued.guest_email}.</p>}
                {settings?.vendor_auto_email && <p>Parking vendor notification queued automatically.</p>}
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <Card className="bg-muted/30">
            <CardContent className="pt-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Before issuing</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5">
                <li>Confirm the physical ticket number.</li>
                <li>Check the validity dates and guest identifier.</li>
                <li>Give the issued ticket to the guest only after the success message appears.</li>
              </ol>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
