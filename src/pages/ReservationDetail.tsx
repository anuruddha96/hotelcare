import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useParams, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Header } from '@/components/layout/Header';
import { PMSNavigation } from '@/components/layout/PMSNavigation';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, CalendarDays, CreditCard, Edit, FileText, History, User } from 'lucide-react';
import { toast } from 'sonner';
import { CheckInDialog } from '@/components/frontdesk/CheckInDialog';
import { CheckOutDialog } from '@/components/frontdesk/CheckOutDialog';
import { EditReservationDialog } from '@/components/reservations/EditReservationDialog';

const statusColors: Record<string, string> = { pending: 'bg-muted text-muted-foreground', confirmed: 'bg-primary/10 text-primary', checked_in: 'bg-green-500/10 text-green-700', checked_out: 'bg-secondary text-secondary-foreground', cancelled: 'bg-destructive/10 text-destructive', no_show: 'bg-destructive/10 text-destructive' };

const ReservationDetail = () => {
  const { user, loading } = useAuth();
  const { organizationSlug, id } = useParams<{ organizationSlug: string; id: string }>();
  const { t } = useTranslation();
  const [reservation, setReservation] = useState<any>(null);
  const [folioItems, setFolioItems] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkOutOpen, setCheckOutOpen] = useState(false);
  const [folioType, setFolioType] = useState('other');
  const [folioDescription, setFolioDescription] = useState('');
  const [folioAmount, setFolioAmount] = useState('');
  const [posting, setPosting] = useState(false);
  const basePath = `/${organizationSlug || 'rdhotels'}`;

  const fetchData = useCallback(async () => {
    if (!id) return; setLoadingData(true);
    const [res, folio, audit] = await Promise.all([
      (supabase as any).from('reservations').select('*, guests(*), rooms:room_id(id, room_number, room_type, status, actual_status)').eq('id', id).single(),
      (supabase as any).from('guest_folios').select('*').eq('reservation_id', id).order('created_at', { ascending: false }),
      (supabase as any).from('reservation_events').select('*').eq('reservation_id', id).order('created_at', { ascending: false }).limit(100),
    ]);
    setReservation(res.data || null); setFolioItems(folio.data || []); setEvents(audit.data || []); setLoadingData(false);
  }, [id]);
  useEffect(() => { if (user) fetchData(); }, [user, fetchData]);

  const guestLabel = useMemo(() => {
    if (!reservation) return '';
    const n = `${reservation.guests?.first_name || ''} ${reservation.guests?.last_name || ''}`.trim();
    return n || (reservation.source === 'previo' ? `Previo · ${reservation.source_reservation_id || reservation.reservation_number}` : reservation.reservation_number);
  }, [reservation]);

  const setLifecycleStatus = async (status: 'confirmed' | 'cancelled' | 'no_show') => {
    let reason: string | null = null;
    if (status === 'cancelled' || status === 'no_show') { reason = window.prompt(status === 'cancelled' ? t('pms.reservationDetail.cancel') : t('pms.reservations.noShow')); if (!reason?.trim()) return; }
    const { error } = await (supabase as any).rpc('pms_set_reservation_status', { _reservation_id: reservation.id, _new_status: status, _reason: reason });
    if (error) toast.error(error.message || t('pms.reservationDetail.failedToUpdate')); else { toast.success(t('common.success')); fetchData(); }
  };

  const addFolio = async () => {
    const amount = Number(folioAmount); if (!folioDescription.trim() || !Number.isFinite(amount) || amount <= 0) return;
    setPosting(true);
    const { error } = await (supabase as any).rpc('pms_add_folio_item', { _reservation_id: reservation.id, _description: folioDescription.trim(), _amount: amount, _charge_type: folioType });
    setPosting(false);
    if (error) toast.error(error.message); else { setFolioDescription(''); setFolioAmount(''); toast.success(t('common.success')); fetchData(); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!user) return <Navigate to={`${basePath}/auth`} replace />;
  if (loadingData) return <div className="min-h-screen bg-background"><Header /><PMSNavigation /><main className="container mx-auto p-6"><div className="h-64 animate-pulse bg-muted rounded-xl" /></main></div>;
  if (!reservation) return <div className="min-h-screen bg-background"><Header /><PMSNavigation /><main className="container mx-auto p-8 text-center text-muted-foreground">{t('pms.reservationDetail.reservationNotFound')}<br/><Link to={`${basePath}/reservations`} className="text-primary hover:underline">{t('pms.reservationDetail.backToReservations')}</Link></main></div>;
  const guest = reservation.guests;

  return <div className="min-h-screen bg-background"><Header /><PMSNavigation /><main className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4" data-training="pms-reservation-detail-page">
    <div className="flex items-center gap-2"><Link to={`${basePath}/reservations`}><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />{t('pms.reservations')}</Button></Link><span className="font-mono text-sm text-muted-foreground">{reservation.reservation_number}</span></div>
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><h1 className="text-xl font-bold flex flex-wrap items-center gap-2">{guestLabel}<Badge className={statusColors[reservation.status] || 'bg-muted'}>{String(reservation.status).replace('_',' ')}</Badge></h1><p className="text-xs text-muted-foreground">{reservation.reservation_number} · {reservation.source || '-'}{reservation.source_reservation_id ? ` · ${reservation.source_reservation_id}` : ''}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setEditOpen(true)}><Edit className="h-4 w-4 mr-1" />{t('common.edit')}</Button>{reservation.status === 'pending' && <Button size="sm" onClick={() => setLifecycleStatus('confirmed')}>{t('pms.reservationDetail.confirm')}</Button>}{['pending','confirmed'].includes(reservation.status) && <Button data-training="pms-detail-check-in" size="sm" onClick={() => setCheckInOpen(true)}>{t('pms.checkIn')}</Button>}{reservation.status === 'checked_in' && <Button data-training="pms-detail-checkout" size="sm" onClick={() => setCheckOutOpen(true)}>{t('pms.checkOut')}</Button>}{['pending','confirmed'].includes(reservation.status) && <Button size="sm" variant="outline" onClick={() => setLifecycleStatus('no_show')}>{t('pms.reservations.noShow')}</Button>}{['pending','confirmed'].includes(reservation.status) && <Button size="sm" variant="destructive" onClick={() => setLifecycleStatus('cancelled')}>{t('pms.reservationDetail.cancel')}</Button>}</div></div>

    <div className="grid lg:grid-cols-3 gap-4">
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex gap-2"><User className="h-4 w-4" />{t('pms.reservationDetail.guestInfo')}</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">{guest ? <><p><span className="text-muted-foreground">{t('pms.reservationDetail.name')}: </span>{guest.first_name} {guest.last_name}</p><p>{guest.email || t('pms.guests.noEmail')}</p><p>{guest.phone || t('pms.guests.noPhone')}</p><p><span className="text-muted-foreground">{t('pms.guestDetail.idDocument')}: </span>{guest.id_document_number || t('pms.reservationDetail.notSpecified')}</p></> : <p className="text-muted-foreground">{t('pms.reservationDetail.noGuestLinked')}</p>}</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex gap-2"><CalendarDays className="h-4 w-4" />{t('pms.reservationDetail.stayDetails')}</CardTitle></CardHeader><CardContent className="space-y-1 text-sm"><p>{reservation.check_in_date} → {reservation.check_out_date} · {reservation.total_nights || '-'}N</p><p>{reservation.adults} {t('pms.reservationDetail.adults')} · {reservation.children} {t('pms.reservationDetail.children')}</p><p><span className="text-muted-foreground">{t('common.room')}: </span>{reservation.rooms?.room_number || t('pms.reservationDetail.notSpecified')} {reservation.rooms?.room_type ? `· ${reservation.rooms.room_type}` : ''}</p>{reservation.actual_check_in && <p className="text-xs text-muted-foreground">{t('pms.reservationDetail.actualCheckIn')}: {new Date(reservation.actual_check_in).toLocaleString()}</p>}{reservation.actual_check_out && <p className="text-xs text-muted-foreground">{t('pms.reservationDetail.actualCheckOut')}: {new Date(reservation.actual_check_out).toLocaleString()}</p>}</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex gap-2"><CreditCard className="h-4 w-4" />{t('pms.reservationDetail.financialSummary')}</CardTitle></CardHeader><CardContent className="space-y-1 text-sm"><p>{t('pms.reservationDetail.ratePerNight')}: {Number(reservation.room_rate || reservation.rate_per_night || 0).toLocaleString()} {reservation.currency || 'HUF'}</p><p>{t('pms.reservationDetail.total')}: <strong>{Number(reservation.total_amount || 0).toLocaleString()} {reservation.currency || 'HUF'}</strong></p><p>{t('pms.reservationDetail.payment')}: {Number(reservation.paid_amount || 0).toLocaleString()}</p><p className={Number(reservation.balance_due || 0) > 0 ? 'text-amber-700 font-semibold' : ''}>{t('pms.reservationDetail.balance')}: {Number(reservation.balance_due || 0).toLocaleString()} {reservation.currency || 'HUF'}</p></CardContent></Card>
    </div>

    {(reservation.special_requests || reservation.internal_notes) && <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex gap-2"><FileText className="h-4 w-4" />{t('pms.reservationDetail.notesRequests')}</CardTitle></CardHeader><CardContent className="grid md:grid-cols-2 gap-3 text-sm">{reservation.special_requests && <div><strong>{t('pms.reservationDetail.specialRequests')}</strong><p>{reservation.special_requests}</p></div>}{reservation.internal_notes && <div><strong>{t('pms.reservationDetail.internalNotes')}</strong><p>{reservation.internal_notes}</p></div>}</CardContent></Card>}

    <Card data-training="pms-folio"><CardHeader className="pb-2"><CardTitle className="text-sm">{t('pms.reservationDetail.guestFolio')}</CardTitle></CardHeader><CardContent className="space-y-3"><div className="grid sm:grid-cols-[150px_1fr_140px_auto] gap-2 items-end"><div><Label>{t('pms.reservations.source')}</Label><Select value={folioType} onValueChange={setFolioType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['other','minibar','restaurant','bar','city_tax','service','adjustment','payment'].map((x) => <SelectItem value={x} key={x}>{x.replace('_',' ')}</SelectItem>)}</SelectContent></Select></div><div><Label>{t('pms.reservationDetail.notesRequests')}</Label><Input value={folioDescription} onChange={(e) => setFolioDescription(e.target.value)} /></div><div><Label>{t('pms.reservations.amount')}</Label><Input type="number" min="0" value={folioAmount} onChange={(e) => setFolioAmount(e.target.value)} /></div><Button onClick={addFolio} disabled={posting}>{t('common.save')}</Button></div>{folioItems.length === 0 ? <p className="text-sm text-muted-foreground">{t('pms.reservationDetail.noCharges')}</p> : folioItems.map((item) => <div key={item.id} className="flex justify-between border-t pt-2 text-sm"><span>{item.description} <span className="text-xs text-muted-foreground">· {item.charge_type}</span></span><strong className={item.charge_type === 'payment' ? 'text-green-700' : ''}>{item.charge_type === 'payment' ? '−' : ''}{Number(item.amount).toLocaleString()} {reservation.currency || 'HUF'}</strong></div>)}</CardContent></Card>

    <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex gap-2"><History className="h-4 w-4" />History</CardTitle></CardHeader><CardContent className="space-y-2">{events.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : events.map((event) => <div key={event.id} className="flex justify-between gap-3 text-xs border-b pb-2"><span className="font-medium">{String(event.event_type).replaceAll('_',' ')}</span><span className="text-muted-foreground">{new Date(event.created_at).toLocaleString()}</span></div>)}</CardContent></Card>
  </main>
  <EditReservationDialog reservation={reservation} open={editOpen} onOpenChange={setEditOpen} onSuccess={fetchData} />
  <CheckInDialog reservation={reservation} hotelId={reservation.hotel_id} open={checkInOpen} onOpenChange={setCheckInOpen} onSuccess={() => { setCheckInOpen(false); fetchData(); }} />
  <CheckOutDialog reservation={reservation} open={checkOutOpen} onOpenChange={setCheckOutOpen} onSuccess={() => { setCheckOutOpen(false); fetchData(); }} />
  </div>;
};
export default ReservationDetail;
