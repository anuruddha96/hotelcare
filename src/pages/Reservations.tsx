import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, useParams, Link } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { CalendarDays, List, Plus, Search, Filter } from 'lucide-react';
import { CreateReservationDialog } from '@/components/reservations/CreateReservationDialog';
import { ReservationCalendar } from '@/components/reservations/ReservationCalendar';
import { format } from 'date-fns';

const Reservations = () => {
  const { user, profile, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const [reservations, setReservations] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<'list' | 'calendar'>('list');

  useEffect(() => {
    if (user) fetchReservations();
  }, [user, statusFilter]);

  const fetchReservations = async () => {
    setLoadingData(true);
    let query = supabase
      .from('reservations')
      .select('*, guests(*)')
      .order('check_in_date', { ascending: false })
      .limit(200);

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (!error && data) setReservations(data);
    setLoadingData(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to={`/${organizationSlug || 'rdhotels'}/auth`} replace />;

  const basePath = `/${organizationSlug || 'rdhotels'}`;

  const filtered = reservations.filter((r) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const guestName = `${r.guests?.first_name || ''} ${r.guests?.last_name || ''}`.toLowerCase();
    return (
      guestName.includes(term) ||
      r.reservation_number?.toLowerCase().includes(term)
    );
  });

  const statusColors: Record<string, string> = {
    pending: 'bg-muted text-muted-foreground',
    confirmed: 'bg-primary/10 text-primary',
    checked_in: 'bg-green-500/10 text-green-700',
    checked_out: 'bg-secondary text-secondary-foreground',
    cancelled: 'bg-destructive/10 text-destructive',
    no_show: 'bg-destructive/10 text-destructive',
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <PMSNavigation />
      <main className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h1 className="text-xl font-bold">Reservations</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-48 h-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="checked_in">Checked In</SelectItem>
                <SelectItem value="checked_out">Checked Out</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="no_show">No Show</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex border border-border rounded-md overflow-hidden">
              <Button
                variant={view === 'list' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setView('list')}
                className="rounded-none"
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={view === 'calendar' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setView('calendar')}
                className="rounded-none"
              >
                <CalendarDays className="h-4 w-4" />
              </Button>
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1">
              <Plus className="h-4 w-4" /> New Reservation
            </Button>
          </div>
        </div>

        {view === 'list' ? (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reservation #</TableHead>
                      <TableHead>Guest</TableHead>
                      <TableHead>Check-in</TableHead>
                      <TableHead>Check-out</TableHead>
                      <TableHead>Nights</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingData ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          Loading reservations...
                        </TableCell>
                      </TableRow>
                    ) : filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          No reservations found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((r) => (
                        <TableRow key={r.id} className="cursor-pointer hover:bg-accent/50">
                          <TableCell>
                            <Link to={`${basePath}/reservations/${r.id}`} className="font-mono text-sm text-primary hover:underline">
                              {r.reservation_number}
                            </Link>
                          </TableCell>
                          <TableCell className="font-medium">
                            {r.guests?.first_name} {r.guests?.last_name}
                          </TableCell>
                          <TableCell className="text-sm">{r.check_in_date}</TableCell>
                          <TableCell className="text-sm">{r.check_out_date}</TableCell>
                          <TableCell>{r.total_nights || '-'}</TableCell>
                          <TableCell>
                            <Badge className={statusColors[r.status] || 'bg-muted'}>
                              {r.status.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm capitalize">{r.source?.replace('_', ' ')}</TableCell>
                          <TableCell className="text-sm font-medium">
                            {r.total_amount ? `${Number(r.total_amount).toLocaleString()} ${r.currency || 'HUF'}` : '-'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <ReservationCalendar reservations={reservations} />
        )}
      </main>

      <CreateReservationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => { setCreateOpen(false); fetchReservations(); }}
      />
    </div>
  );
};

export default Reservations;
