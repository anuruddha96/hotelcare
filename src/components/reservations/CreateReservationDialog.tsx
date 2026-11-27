import { NtakBookingFieldsGroup, useNtakBookingFields, inferredChannel } from '@/components/ntak/NtakBookingFieldsGroup';
import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { normalizeReservationNumberDraft, isReservationNumberDraftValid, DEFAULT_RESERVATION_CURRENCY } from '@/lib/reservationFormInputs';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { GuestSearchSelect } from '@/components/guests/GuestSearchSelect';
import { useTranslation } from '@/hooks/useTranslation';
import { useOperationalHotel } from '@/hooks/useOperationalHotel';
import { getLocalDateString } from '@/lib/utils';
import { createReservation, fetchAvailableRooms, LifecycleError, type AvailableRoom } from '@/lib/pmsLifecycle';
import { nightsBetween, RESERVATION_SOURCES } from '@/lib/reservations';

const UNASSIGNED = '__none__';
const CURRENCIES = ['EUR', 'HUF', 'CZK', 'USD', 'GBP'];

const newReservationDraft = () => ({
    guest_id: '',
    check_in_date: '',
    check_out_date: '',
    adults: '1',
    children: '',
    room_id: UNASSIGNED,
    room_type_requested: '',
    rate_per_night: '',
    currency: DEFAULT_RESERVATION_CURRENCY,
    source: 'direct',
    special_requests: '',
    internal_notes: '',
  });

function FieldLabel({ id, label, help }: { id: string; label: string; help: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Label htmlFor={id} className="min-w-0 leading-snug">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label={label + ' — ' + help} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Info className="h-4 w-4" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent sideOffset={4} collisionPadding={12} className="w-64 max-w-[calc(100vw_-_2rem)] p-3 text-sm leading-relaxed" onOpenAutoFocus={(event) => event.preventDefault()}>
          {help}
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface CreateReservationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CreateReservationDialog({ open, onOpenChange, onSuccess }: CreateReservationDialogProps) {
  const { t } = useTranslation();
  const hu = t('common.cancel') === 'Mégse';
  const tr = (en: string, h: string) => hu ? h : en;
  const { hotelId, hotelKeys, orgSlug } = useOperationalHotel();
  const ntak = useNtakBookingFields(open, hotelId, orgSlug);
  const [submitting, setSubmitting] = useState(false);
  const [rooms, setRooms] = useState<AvailableRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [form, setForm] = useState(newReservationDraft);

  const rateValid = isReservationNumberDraftValid(form.rate_per_night, 'rate');
  const adultsValid = isReservationNumberDraftValid(form.adults, 'adults');
  const childrenValid = isReservationNumberDraftValid(form.children, 'children');
  const numbersValid = rateValid && adultsValid && childrenValid;
  const money = (amount: number) => new Intl.NumberFormat(hu ? 'hu-HU' : 'en-IE', {
    style: 'currency', currency: form.currency, maximumFractionDigits: 2,
  }).format(amount);
  const nights = nightsBetween(form.check_in_date, form.check_out_date);
  const datesValid = !!form.check_in_date && !!form.check_out_date && form.check_out_date >= form.check_in_date;
  // Same arrival and departure day = day use ("nappali használat"): one day is charged, no night.
  const dayUse = datesValid && form.check_out_date === form.check_in_date;

  // Closing abandons the draft; a new booking always starts in EUR.
  // Reset all fields together so an old amount is never relabelled as EUR.
  useEffect(() => {
    if (!open) setForm(newReservationDraft());
  }, [open]);

  // Walk-in defaults to arriving today.
  useEffect(() => {
    if (form.source === 'walk_in' && !form.check_in_date) {
      setForm((f) => ({ ...f, check_in_date: getLocalDateString() }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.source]);

  // Availability check whenever the dates are valid.
  useEffect(() => {
    if (!open || !hotelId || !datesValid) { setRooms([]); return; }
    let alive = true;
    setLoadingRooms(true);
    fetchAvailableRooms(hotelId, form.check_in_date, form.check_out_date)
      .then((data) => { if (alive) setRooms(data); })
      .catch(() => { if (alive) setRooms([]); })
      .finally(() => { if (alive) setLoadingRooms(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hotelId, form.check_in_date, form.check_out_date]);

  const freeRooms = rooms.filter((r) => !r.has_conflict);

  // Room types are property-specific; the new reservation currency is EUR
  // until the receptionist explicitly selects another currency.
  const [roomTypes, setRoomTypes] = useState<string[]>([]);
  useEffect(() => {
    if (!open || !hotelId) return;
    let alive = true;
    (async () => {
      const types = await supabase.from('room_types').select('name, sort_order').eq('hotel_id', hotelId).eq('is_sellable', true).order('sort_order');
      if (!alive) return;
      setRoomTypes((types.data ?? []).map((row: { name: string }) => row.name));
    })();
    return () => { alive = false; };
  }, [open, hotelId]);

  const handleCreate = async () => {
    if (!numbersValid) return;
    if (!hotelId) {
      toast.error(t('pms.err.hotelRequired'));
      return;
    }
    if (!datesValid) {
      toast.error(t('pms.createReservation.checkOutAfterCheckIn'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await createReservation({
        hotelId,
        ntakFields: ntak.initial ? { ...(inferredChannel(form.source) ? {ntak_sales_channel: inferredChannel(form.source)} : {}), ...ntak.patch } : undefined,
        guestId: form.guest_id || null,
        checkIn: form.check_in_date,
        checkOut: form.check_out_date,
        adults: Number(form.adults),
        children: Number(form.children),
        roomId: form.room_id === UNASSIGNED ? null : form.room_id,
        roomTypeRequested: form.room_type_requested || null,
        ratePerNight: Number(form.rate_per_night) || 0,
        currency: form.currency,
        source: form.source,
        specialRequests: form.special_requests || null,
        internalNotes: form.internal_notes || null,
        status: 'confirmed',
      });
      toast.success(`${t('pms.createReservation.reservationCreated')} · ${result.reservation_number ?? ''}`);
      setForm(newReservationDraft());
      ntak.reset();
      onSuccess();
    } catch (err) {
      const key = err instanceof LifecycleError ? err.translationKey : null;
      toast.error(key ? t(key) : t('pms.createReservation.failedToCreate'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex min-w-0 max-w-[calc(100vw_-_1rem)] max-h-[90dvh] flex-col overflow-hidden rounded-lg p-4 sm:max-w-lg sm:p-6" data-training="res-create-dialog">
        <DialogHeader className="shrink-0 pr-8 text-left">
          <DialogTitle>{t('pms.createReservation.newReservation')}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden overscroll-contain px-1 pb-2">
          <GuestSearchSelect
            value={form.guest_id}
            onChange={(id) => setForm({ ...form, guest_id: id })}
            hotelKeys={hotelKeys}
            hotelId={hotelId}
            orgSlug={orgSlug}
          />
          {!form.guest_id && <p className="text-xs text-muted-foreground">{tr("Search for an existing guest or create a new guest profile.", "Keressen meglévő vendéget, vagy hozzon létre új vendégprofilt.")}</p>}

          <div className="grid min-w-0 grid-cols-2 gap-3">
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <FieldLabel id="new-res-check-in" label={t('pms.createReservation.checkInDate')} help={tr('The date the guest arrives at the hotel.', 'A vendég érkezésének napja.')} />
              <Input id="new-res-check-in" className="block min-w-0 max-w-full [&::-webkit-date-and-time-value]:text-left" type="date" value={form.check_in_date} onChange={(e) => setForm({ ...form, check_in_date: e.target.value })} />
            </div>
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <FieldLabel id="new-res-check-out" label={t('pms.createReservation.checkOutDate')} help={tr('The departure date must be on or after check-in. The same day means day use (no overnight stay).', 'A távozás napja nem lehet korábbi az érkezésnél. Azonos nap esetén nappali használat (éjszakázás nélkül).')} />
              <Input id="new-res-check-out" className="block min-w-0 max-w-full [&::-webkit-date-and-time-value]:text-left" type="date" value={form.check_out_date} onChange={(e) => setForm({ ...form, check_out_date: e.target.value })} />
            </div>
            <div className="min-w-0">
              <FieldLabel id="new-res-adults" label={t('pms.createReservation.adults')} help={tr('Enter the number of adult guests (at least one).', 'Adja meg a felnőtt vendégek számát (legalább egy).')} />
              <Input id="new-res-adults" className="min-w-0" inputMode="numeric" value={form.adults} aria-invalid={!adultsValid} onChange={(e) => setForm({ ...form, adults: normalizeReservationNumberDraft(e.target.value, 'adults') })} />
            </div>
            <div className="min-w-0">
              <FieldLabel id="new-res-children" label={t('pms.createReservation.children')} help={tr('Enter the number of children; leave blank for none.', 'Adja meg a gyermekek számát; ha nincs, hagyja üresen.')} />
              <Input id="new-res-children" className="min-w-0" inputMode="numeric" placeholder="0" value={form.children} aria-invalid={!childrenValid} onChange={(e) => setForm({ ...form, children: normalizeReservationNumberDraft(e.target.value, 'children') })} />
            </div>
          </div>

          <div>
            <FieldLabel id="new-res-room" label={t('pms.res.room')} help={tr('Choose dates first to see available rooms, or leave the room unassigned.', 'Először válassza ki a dátumokat a szabad szobákhoz, vagy hagyja a szobát kiosztatlanul.')} />
            <Select
              value={form.room_id}
              onValueChange={(v) => {
                const room = freeRooms.find((r) => r.room_id === v);
                setForm({ ...form, room_id: v, room_type_requested: room?.room_type ?? form.room_type_requested });
              }}
              disabled={!datesValid || loadingRooms}
            >
              <SelectTrigger id="new-res-room" className="min-w-0 [&>span]:truncate">
                <SelectValue placeholder={datesValid ? undefined : t('pms.res.pickDatesFirst')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>{t('pms.res.unassigned')}</SelectItem>
                {freeRooms.map((room) => (
                  <SelectItem key={room.room_id} value={room.room_id}>
                    {room.room_number} {room.room_type ? `(${room.room_type})` : ''} · {room.capacity}P
                    {room.room_status !== 'clean' ? ` · ${t('pms.fd.readyDirty')}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {datesValid && !loadingRooms && (
              <p className="text-[11px] text-muted-foreground mt-1">
                {t('pms.res.freeRoomsForDates')}: {freeRooms.length}
              </p>
            )}
          </div>

          {form.room_id === UNASSIGNED && (
            <div>
              <FieldLabel id="new-res-room-type" label={t('pms.createReservation.roomType')} help={tr('Choose the requested category if no specific room is assigned.', 'Válassza ki a kért szobakategóriát, ha még nincs kijelölt szoba.')} />
              {roomTypes.length > 0 ? (
                <Select value={form.room_type_requested || undefined} onValueChange={(v) => setForm({ ...form, room_type_requested: v })}>
                  <SelectTrigger id="new-res-room-type" className="min-w-0 [&>span]:truncate" aria-label={t('pms.createReservation.roomType')}><SelectValue placeholder={t('pms.createReservation.roomTypePlaceholder')} /></SelectTrigger>
                  <SelectContent>
                    {roomTypes.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input id="new-res-room-type" className="min-w-0" placeholder={t('pms.createReservation.roomTypePlaceholder')} value={form.room_type_requested} onChange={(e) => setForm({ ...form, room_type_requested: e.target.value })} />
              )}
            </div>
          )}

          <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="min-w-0">
              <FieldLabel id="new-res-rate" label={tr(`Rate / night (${form.currency})`, `Ár / éj (${form.currency})`)} help={tr('Enter the room price for one night in the selected currency. A blank rate is treated as zero.', 'Adja meg az egy éjszakára vonatkozó szobaárat a választott pénznemben. Az üres ár nullának számít.')} />
              <Input id="new-res-rate" className="min-w-0" inputMode="decimal" placeholder="0.00" value={form.rate_per_night} aria-invalid={!rateValid} onChange={(e) => setForm({ ...form, rate_per_night: normalizeReservationNumberDraft(e.target.value, 'rate') })} />
            </div>
            <div className="min-w-0">
              <FieldLabel id="new-res-currency" label={t('pms.res.currency')} help={tr('EUR is the default. Changing currency does not convert the entered amount.', 'Az alapértelmezett pénznem az EUR. A pénznem módosítása nem váltja át a megadott összeget.')} />
              <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                <SelectTrigger id="new-res-currency" className="min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <FieldLabel id="new-res-source" label={t('pms.createReservation.source')} help={tr('Select how the booking was received, for example directly, by phone, or from an OTA.', 'Válassza ki, hogyan érkezett a foglalás, például közvetlenül, telefonon vagy közvetítőn keresztül.')} />
              <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                <SelectTrigger id="new-res-source" className="min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RESERVATION_SOURCES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!numbersValid && <p role="alert" className="text-sm text-destructive">{tr('Enter at least one adult, whole guest counts, and a non-negative nightly rate (up to two decimal places).', 'Adjon meg legalább egy felnőttet, egész vendégszámokat és nem negatív éjszakánkénti árat (legfeljebb két tizedesjeggyel).')}</p>}
          {dayUse && <p className="text-xs font-medium text-primary">{tr('Day use: arrival and departure on the same day, no overnight stay.', 'Nappali használat: érkezés és távozás ugyanazon a napon, éjszakázás nélkül.')}</p>}
          {(nights > 0 || dayUse) && rateValid && form.rate_per_night !== '' && (
            <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border bg-muted/40 p-3 text-sm">
              <span className="text-muted-foreground">{Math.max(1, nights)} × {money(Number(form.rate_per_night))}</span>
              <strong>{tr('Room total', 'Szobaár összesen')}: {money(Math.max(1, nights) * Number(form.rate_per_night))}</strong>
            </div>
          )}

          {ntak.initial && <NtakBookingFieldsGroup initial={ntak.initial} patch={ntak.patch} setPatch={ntak.setPatch} source={form.source} guestCount={Number(form.adults)+Number(form.children)} />}
          <div>
            <FieldLabel id="new-res-requests" label={t('pms.createReservation.specialRequests')} help={tr('Guest preferences, accessibility needs or arrival requests.', 'Vendégpreferenciák, akadálymentességi igények vagy érkezési kérések.')} />
            <Textarea id="new-res-requests" className="min-w-0 resize-y" value={form.special_requests} onChange={(e) => setForm({ ...form, special_requests: e.target.value })} placeholder={t('pms.createReservation.guestPreferences')} />
          </div>

          <div>
            <FieldLabel id="new-res-notes" label={t('pms.createReservation.internalNotes')} help={tr('Staff-only operational notes; not a message to the guest.', 'Csak a munkatársaknak szóló megjegyzések; nem vendégüzenet.')} />
            <Textarea id="new-res-notes" className="min-w-0 resize-y" value={form.internal_notes} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} placeholder={t('pms.createReservation.staffNotes')} />
          </div>
        </div>
        <DialogFooter className="shrink-0 gap-2 border-t pt-3 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleCreate} disabled={submitting || !datesValid || !numbersValid}>
            {submitting ? t('pms.createReservation.creating') : t('pms.createReservation.createReservation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
