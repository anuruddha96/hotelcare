import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Users, Plus, Search, Star, CalendarClock, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/hooks/useTranslation';
import { useOperationalHotel } from '@/hooks/useOperationalHotel';
import { guestProfilePath, guestTagLabel } from '@/lib/guestJourney';

const PAGE = 50;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DirectoryGuest = Record<string, any>;

const Guests = () => {
  const { user, profile, loading } = useAuth();
  const { organizationSlug } = useParams<{ organizationSlug: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [guests, setGuests] = useState<DirectoryGuest[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingData, setLoadingData] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '', nationality: '',
    id_document_type: '', id_document_number: '', company_name: '', notes: '',
  });
  const basePath = `/${organizationSlug || 'rdhotels'}`;
  const seq = useRef(0);

  const { hotelId, hotelKeys, ready } = useOperationalHotel();
  const keysKey = hotelKeys.join('|');

  // The directory is read from bookings on the server (pms_guest_directory):
  // saved profiles plus every guest known from a booking, 50 at a time.
  const fetchGuests = async (offset = 0) => {
    const mine = ++seq.current;
    if (!keysKey) { setGuests([]); setTotal(0); setLoadingData(false); return; }
    if (offset === 0) setLoadingData(true); else setLoadingMore(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('pms_guest_directory', {
      _hotel_ids: keysKey.split('|'), _term: searchTerm.trim() || null, _limit: PAGE, _offset: offset,
    });
    if (mine !== seq.current) return;
    const rows: DirectoryGuest[] = error ? [] : (data ?? []);
    setGuests((current) => (offset === 0 ? rows : [...current, ...rows]));
    setTotal(rows[0]?.total_count ?? (offset === 0 ? 0 : total));
    setLoadingData(false);
    setLoadingMore(false);
  };

  useEffect(() => {
    if (!user || !ready) return;
    const timer = setTimeout(() => { void fetchGuests(0); }, searchTerm ? 250 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, ready, keysKey, searchTerm]);

  const createGuest = async () => {
    if (!form.first_name || !form.last_name) {
      toast.error(t('pms.guests.firstLastRequired'));
      return;
    }
    const { error } = await supabase.from('guests').insert({
      ...form,
      organization_slug: profile?.organization_slug || organizationSlug,
      hotel_id: hotelId || profile?.assigned_hotel,
    });
    if (error) {
      toast.error(t('pms.guests.failedToCreate'));
    } else {
      toast.success(t('pms.guests.guestCreated'));
      setCreateOpen(false);
      setForm({ first_name: '', last_name: '', email: '', phone: '', nationality: '', id_document_type: '', id_document_number: '', company_name: '', notes: '' });
      void fetchGuests(0);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to={`${basePath}/auth`} replace />;

  const stayLine = (g: DirectoryGuest) => {
    if (g.in_house) return <Badge className="bg-sky-600 hover:bg-sky-600 text-white">{t('pms.guests.inHouse')}</Badge>;
    if (g.next_arrival) return <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CalendarClock className="h-3.5 w-3.5" />{t('pms.guests.arrives')} {g.next_arrival}</span>;
    return g.last_stay ? <span className="text-muted-foreground">{t('pms.guests.lastStay')} {g.last_stay}</span> : <span className="text-muted-foreground">—</span>;
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <PMSNavigation />
      <main className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Users className="h-5 w-5" /> {t('pms.guests.directory')}
            <Badge variant="secondary">{total}</Badge>
          </h1>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('pms.guests.searchGuests')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-56 h-9"
              />
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1">
              <Plus className="h-4 w-4" /> {t('pms.guests.addGuest')}
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('pms.guests.name')}</TableHead>
                    <TableHead>{t('pms.guests.contact')}</TableHead>
                    <TableHead className="text-right">{t('pms.guests.stays')}</TableHead>
                    <TableHead className="text-right">{t('pms.guests.nights')}</TableHead>
                    <TableHead>{t('pms.guests.stayStatus')}</TableHead>
                    <TableHead>{t('pms.guests.bookedVia')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingData ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('pms.loading')}</TableCell>
                    </TableRow>
                  ) : guests.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('pms.guests.noGuestsFound')}</TableCell>
                    </TableRow>
                  ) : (
                    guests.map((g) => (
                      <TableRow key={g.key} className="cursor-pointer hover:bg-accent/50"
                        onClick={() => g.profile_key && navigate(guestProfilePath(basePath, g.hotel_id, g.profile_key))}>
                        <TableCell>
                          <span className="font-medium text-primary inline-flex items-center gap-1.5">
                            {g.name || '—'}
                            {g.vip_status === 'vip' && <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />}
                            {Number(g.stays) > 1 && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 text-[10px] font-semibold leading-4 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200">
                                <RotateCcw className="h-2.5 w-2.5" /> {t('pms.guests.returning')}
                              </span>
                            )}
                          </span>
                          {(g.nationality || (g.tags ?? []).length > 0) && (
                            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                              {g.nationality && <span>{g.nationality}</span>}
                              {(g.tags ?? []).slice(0, 3).map((tag: string) => (
                                <span key={tag} className="rounded-full border border-border px-1.5 leading-4">{guestTagLabel(tag, t)}</span>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="truncate max-w-[240px]">{g.email || '—'}</div>
                          {g.phone && <div className="text-xs text-muted-foreground">{g.phone}</div>}
                        </TableCell>
                        <TableCell className="text-sm text-right tabular-nums">{g.stays}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums">{g.nights}</TableCell>
                        <TableCell className="text-sm">{stayLine(g)}</TableCell>
                        <TableCell className="text-sm">{(g.channels ?? []).join(', ') || '—'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {!loadingData && guests.length < total && (
              <div className="p-3 border-t border-border text-center">
                <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void fetchGuests(guests.length)}>
                  {t('pms.guests.showMore')} ({guests.length}/{total})
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Create Guest Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('pms.guests.addNewGuest')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('pms.guests.firstName')} *</Label>
              <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.guests.lastName')} *</Label>
              <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.guests.email')}</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.guests.phone')}</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.guests.nationality')}</Label>
              <Input value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.guests.company')}</Label>
              <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.guests.idType')}</Label>
              <Input placeholder={t('pms.guests.idPlaceholder')} value={form.id_document_type} onChange={(e) => setForm({ ...form, id_document_type: e.target.value })} />
            </div>
            <div>
              <Label>{t('pms.guests.idNumber')}</Label>
              <Input value={form.id_document_number} onChange={(e) => setForm({ ...form, id_document_number: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={createGuest}>{t('pms.guests.createGuest')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Guests;
