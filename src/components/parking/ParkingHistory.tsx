import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Loader2, Search, ShieldAlert, TicketX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  parkingDisplayStatus,
  parkingErrorMessage,
  type ParkingAccess,
  type ParkingSearchStatus,
  type ParkingTicket,
} from '@/lib/parking';
import { searchParkingTickets } from '@/lib/parkingApi';
import { ParkingStatusBadge } from './ParkingStatusBadge';
import { ParkingTicketDialog } from './ParkingTicketDialog';

interface Props {
  organizationSlug: string;
  hotelId: string;
  access: ParkingAccess;
  unreportedCount: number;
  refreshVersion: number;
  onChanged: (ticket: ParkingTicket) => void;
}

export function ParkingHistory({ organizationSlug, hotelId, access, unreportedCount, refreshVersion, onChanged }: Props) {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [status, setStatus] = useState<ParkingSearchStatus>('issued');
  const [tickets, setTickets] = useState<ParkingTicket[]>([]);
  const [selected, setSelected] = useState<ParkingTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await searchParkingTickets({ organizationSlug, hotelId, query: submittedQuery, status, limit: 150 });
      setTickets(rows);
    } catch (nextError) {
      setError(parkingErrorMessage(nextError, 'Could not search parking tickets.'));
    } finally {
      setLoading(false);
    }
  }, [organizationSlug, hotelId, submittedQuery, status]);

  useEffect(() => { void load(); }, [load, refreshVersion]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const nextQuery = query.trim();
    if (nextQuery === submittedQuery) void load();
    else setSubmittedQuery(nextQuery);
  }

  const showUnreported = () => {
    setQuery('');
    setSubmittedQuery('');
    setStatus('unreported');
  };

  const changed = (ticket: ParkingTicket) => {
    setSelected(ticket);
    setTickets((rows) => rows.map((row) => row.id === ticket.id ? ticket : row));
    onChanged(ticket);
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-3 sm:p-5">
        {access === 'manage' && unreportedCount > 0 && (
          <button
            type="button"
            onClick={showUnreported}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-left transition-colors hover:bg-amber-100/70 dark:border-amber-900 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
          >
            <span className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              <span>
                <span className="block text-sm font-semibold">{unreportedCount} expired ticket{unreportedCount === 1 ? '' : 's'} still need vendor reporting</span>
                <span className="block text-xs text-muted-foreground">Open the queue and mark each one after the parking operator has been informed.</span>
              </span>
            </span>
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Review now</span>
          </button>
        )}

        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ticket, reservation, guest or room" className="pl-9" />
          </div>
          <Select value={status} onValueChange={(value) => setStatus(value as ParkingSearchStatus)}>
            <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="issued">Active</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              {access === 'manage' && <SelectItem value="unreported">Unreported expired</SelectItem>}
              <SelectItem value="void">Voided</SelectItem>
              <SelectItem value="available">Available</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}Search</Button>
        </form>

        {error ? (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
        ) : loading && tickets.length === 0 ? (
          <div className="flex min-h-32 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading tickets…</div>
        ) : tickets.length === 0 ? (
          <div className="flex min-h-36 flex-col items-center justify-center text-center text-muted-foreground"><TicketX className="mb-2 h-8 w-8" /><p className="font-medium text-foreground">No matching tickets</p><p className="text-sm">Try another number or status.</p></div>
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-md border md:block">
              <Table>
                <TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>Status</TableHead><TableHead>Validity</TableHead><TableHead>Reservation / guest</TableHead><TableHead>Room</TableHead><TableHead className="text-right">Issued</TableHead></TableRow></TableHeader>
                <TableBody>
                  {tickets.map((ticket) => {
                    const displayStatus = parkingDisplayStatus(ticket);
                    const needsReport = displayStatus === 'expired' && !ticket.cancellation_reported_at;
                    return (
                      <TableRow key={ticket.id} className="cursor-pointer" onClick={() => setSelected(ticket)}>
                        <TableCell className="font-mono font-semibold">{ticket.reference}</TableCell>
                        <TableCell><div className="flex flex-wrap items-center gap-1.5"><ParkingStatusBadge status={displayStatus} />{needsReport && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">Needs report</span>}</div></TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{ticket.valid_from ? `${ticket.valid_from} → ${ticket.valid_to}` : '—'}</TableCell>
                        <TableCell><p className="font-medium">{ticket.reservation_ref || ticket.guest_name || '—'}</p>{ticket.reservation_ref && ticket.guest_name && <p className="text-xs text-muted-foreground">{ticket.guest_name}</p>}</TableCell>
                        <TableCell>{ticket.room_number || '—'}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{ticket.issued_at ? new Date(ticket.issued_at).toLocaleString() : '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-2 md:hidden">
              {tickets.map((ticket) => {
                const displayStatus = parkingDisplayStatus(ticket);
                const needsReport = displayStatus === 'expired' && !ticket.cancellation_reported_at;
                return (
                  <button key={ticket.id} type="button" onClick={() => setSelected(ticket)} className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50">
                    <div className="flex items-start justify-between gap-2"><p className="font-mono font-bold">{ticket.reference}</p><div className="flex flex-col items-end gap-1"><ParkingStatusBadge status={displayStatus} />{needsReport && <span className="text-[10px] font-semibold text-amber-600">Needs report</span>}</div></div>
                    <p className="mt-2 text-sm font-medium">{ticket.reservation_ref || ticket.guest_name || (ticket.room_number ? `Room ${ticket.room_number}` : 'No guest details')}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{ticket.valid_from ? `${ticket.valid_from} → ${ticket.valid_to}` : 'Not issued'}</p>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Showing {tickets.length} result{tickets.length === 1 ? '' : 's'}.</p>
          </>
        )}
      </CardContent>

      <ParkingTicketDialog open={Boolean(selected)} ticket={selected} access={access} onOpenChange={(open) => { if (!open) setSelected(null); }} onChanged={changed} />
    </Card>
  );
}
