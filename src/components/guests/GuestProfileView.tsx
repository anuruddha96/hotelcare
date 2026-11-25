import { Link } from 'react-router-dom';
import {
  ArrowLeft, BedDouble, CalendarDays, Coffee, ConciergeBell, Mail, MessageSquareText, Pencil, Phone,
  RotateCcw, ShieldCheck, Sparkles, Star, StickyNote, UserRound, UtensilsCrossed, Wine,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RESERVATION_STATUS_COLORS, reservationChannel } from '@/lib/reservations';
import { displayRoomType } from '@/lib/roomTypeDisplay';
import { plainNote } from '@/lib/plainNote';
import { countryName, formatGuestDate, guestLocale, guestTagLabel, type GuestProfile, type GuestStay } from '@/lib/guestJourney';

// HotelCare source codes ("direct", "walk_in") get their label; OTA names ("Booking.com XML") are cleaned up.
const SOURCE_CODE = /^(direct|walk_in|phone|email|booking_com|expedia|previo|previo_snapshot|website|other)$/i;
const channelLabel = (raw: string | null) => {
  if (!raw) return '—';
  return SOURCE_CODE.test(raw)
    ? reservationChannel({ source: raw.toLowerCase(), pms_channel: null }).label
    : reservationChannel({ source: raw, pms_channel: raw }).label;
};

/** "extra_pillow" -> "Extra pillow" */
const humanize = (code: string) => {
  const text = code.replace(/[_-]+/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : code;
};

const STATUS_KEYS: Record<string, string> = {
  pending: 'pms.reservations.pending',
  confirmed: 'pms.reservations.confirmed',
  checked_in: 'pms.reservations.checkedIn',
  checked_out: 'pms.reservations.checkedOut',
  cancelled: 'pms.reservations.cancelled',
  no_show: 'pms.reservations.noShow',
};

function languageName(code: string, language: string): string {
  try {
    return new Intl.DisplayNames([language, 'en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function money(amount: number | null | undefined, currency: string | null | undefined, language: string) {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat(guestLocale(language), {
      style: 'currency', currency: currency || 'EUR', maximumFractionDigits: currency === 'HUF' ? 0 : 2,
    }).format(Number(amount));
  } catch {
    return `${Math.round(Number(amount)).toLocaleString(guestLocale(language))} ${currency ?? ''}`;
  }
}

/** Guest profile content: identity, stats, preferences, what we learned, and every stay. */
export function GuestProfileView({ profile, basePath, onEdit }: { profile: GuestProfile; basePath: string; onEdit: () => void }) {
  const { t, language } = useTranslation();
  const s = profile.stats;
  const l = profile.learned;
  const nation = profile.nationality || profile.country;
  const breakfastShare = l.breakfast_nights > 0 ? Math.round((100 * l.breakfast_days) / l.breakfast_nights) : null;
  const learnedRows: { icon: typeof BedDouble; label: string; value: string }[] = [];
  if (l.room_types.length) learnedRows.push({ icon: BedDouble, label: t('pms.guest.usualRoomType'), value: l.room_types.map((r) => `${displayRoomType(r.name)} (${r.stays})`).join(', ') });
  if (l.rooms.length) learnedRows.push({ icon: BedDouble, label: t('pms.guest.roomsStayed'), value: l.rooms.map((r) => `${r.room} (${r.stays})`).join(', ') });
  if (l.channels.length) learnedRows.push({ icon: CalendarDays, label: t('pms.guest.booksVia'), value: l.channels.map((c) => `${channelLabel(c.channel)} (${c.stays})`).join(', ') });
  if (l.minibar.length) learnedRows.push({ icon: Wine, label: t('pms.guest.minibarFavourites'), value: l.minibar.map((m) => `${m.name} ×${m.qty}`).join(', ') });
  if (breakfastShare !== null && l.breakfast_days > 0) learnedRows.push({ icon: Coffee, label: t('pms.guest.breakfast'), value: t('pms.guest.breakfastShare').replace('{days}', String(l.breakfast_days)).replace('{nights}', String(l.breakfast_nights)).replace('{pct}', String(breakfastShare)) });
  if (l.insuite_orders > 0) learnedRows.push({ icon: ConciergeBell, label: 'In-Suite', value: `${l.insuite_orders} × · ${l.insuite_items.slice(0, 6).join(', ')}` });
  if (l.requests.length) learnedRows.push({ icon: ConciergeBell, label: t('pms.guest.requests'), value: l.requests.map((r) => `${humanize(r.type)} ×${r.count}`).join(', ') });
  if (l.children_stays > 0) learnedRows.push({ icon: UserRound, label: t('pms.guest.party'), value: t('pms.guest.withChildren').replace('{n}', String(l.children_stays)) });

  const statusBadge = s.in_house
    ? <Badge className="bg-sky-600 hover:bg-sky-600 text-white">{t('pms.guests.inHouse')}</Badge>
    : s.next_arrival ? <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">{t('pms.guests.arrives')} {formatGuestDate(s.next_arrival, language)}</Badge> : null;

  return (<>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <Link to={`${basePath}/guests`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {t('pms.guest.backToGuests')}
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
          <span className="break-words">{profile.name || '—'}</span>
          {profile.vip && <Star className="h-5 w-5 fill-amber-500 text-amber-500" aria-label="VIP" />}
          {s.stays > 1 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800 dark:bg-violet-900/50 dark:text-violet-200">
              <RotateCcw className="h-3 w-3" /> {t('pms.guests.returning')}
            </span>
          )}
          {statusBadge}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {nation && <span>{countryName(nation, language)}</span>}
          {profile.language && <span>{t('pms.guest.speaks')} {languageName(profile.language, language)}</span>}
          {profile.email && <a className="inline-flex items-center gap-1 hover:text-foreground" href={`mailto:${profile.email}`}><Mail className="h-3.5 w-3.5" />{profile.email}</a>}
          {profile.phone && <a className="inline-flex items-center gap-1 hover:text-foreground" href={`tel:${profile.phone}`}><Phone className="h-3.5 w-3.5" />{profile.phone}</a>}
          {profile.company_name && <span>{profile.company_name}</span>}
        </div>
      </div>
      <Button onClick={onEdit} className="gap-1.5 self-start"><Pencil className="h-4 w-4" /> {t('pms.guest.editPreferences')}</Button>
    </div>

    {!profile.has_profile && (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{t('pms.guest.fromBookingsHint')}</div>
    )}

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {[
        [t('pms.guests.stays'), String(s.stays)],
        [t('pms.guests.nights'), String(s.nights)],
        [t('pms.guests.totalSpend'), money(s.spend, s.currency, language)],
        [t('pms.guest.avgStay'), s.avg_nights != null ? `${s.avg_nights}` : '—'],
        [t('pms.guest.guestSince'), formatGuestDate(s.first_stay, language)],
      ].map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border bg-card p-3">
          <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
          <div className="text-[11px] text-muted-foreground">{label}</div>
        </div>
      ))}
    </div>

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t('pms.guest.journey')}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {profile.stays.length === 0
            ? <div className="px-4 pb-4 text-sm text-muted-foreground">{t('pms.guests.noStays')}</div>
            : <ol className="divide-y divide-border/70">{profile.stays.map((stay) => <StayRow key={stay.id} stay={stay} basePath={basePath} />)}</ol>}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">{t('pms.guest.preferences')}</CardTitle>
            <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={onEdit}><Pencil className="h-3.5 w-3.5" />{t('pms.guest.edit')}</Button>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {profile.tags.length === 0 && !profile.dietary && !profile.notes && (
              <p className="text-muted-foreground">{t('pms.guest.noPreferences')}</p>
            )}
            {profile.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {profile.tags.map((tag) => <span key={tag} className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-900 dark:bg-violet-900/50 dark:text-violet-100">{guestTagLabel(tag, t)}</span>)}
              </div>
            )}
            {profile.dietary && (
              <div className="flex items-start gap-1.5 font-medium text-rose-700 dark:text-rose-300"><UtensilsCrossed className="mt-0.5 h-4 w-4 shrink-0" />{profile.dietary}</div>
            )}
            {profile.notes && (
              <div className="flex items-start gap-1.5 text-muted-foreground"><StickyNote className="mt-0.5 h-4 w-4 shrink-0" /><span className="whitespace-pre-line break-words">{profile.notes}</span></div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-violet-600" />{t('pms.guest.learned')}</CardTitle></CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            {learnedRows.length === 0
              ? <p className="text-muted-foreground">{t('pms.guest.learnedEmpty')}</p>
              : learnedRows.map((row) => (
                <div key={row.label} className="flex items-start gap-2">
                  <row.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0"><div className="text-xs text-muted-foreground">{row.label}</div><div className="break-words">{row.value}</div></div>
                </div>
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-muted-foreground" />{t('pms.guest.privacy')}</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-2"><span className="text-muted-foreground">{t('pms.guest.marketing')}</span><span>{profile.marketing_consent === true ? t('pms.guest.yes') : profile.marketing_consent === false ? t('pms.guest.no') : '—'}</span></div>
            <div className="flex justify-between gap-2"><span className="text-muted-foreground">{t('pms.guest.idOnFile')}</span><span>{profile.id_on_file ? t('pms.guest.yes') : '—'}</span></div>
            {s.cancelled > 0 && <div className="flex justify-between gap-2"><span className="text-muted-foreground">{t('pms.guest.cancelledBookings')}</span><span>{s.cancelled}</span></div>}
          </CardContent>
        </Card>
      </div>
    </div>

  </>);
}

function StayRow({ stay, basePath }: { stay: GuestStay; basePath: string }) {
  const { t, language } = useTranslation();
  const cancelled = stay.status === 'cancelled' || stay.status === 'no_show';
  const request = plainNote(stay.special_requests);
  const details: { icon: typeof Wine; text: string }[] = [];
  if (stay.minibar.length) details.push({ icon: Wine, text: `${t('pms.guest.minibar')}: ${stay.minibar.map((m) => `${m.name} ×${m.qty}`).join(', ')}` });
  if (stay.breakfast_days > 0) details.push({ icon: Coffee, text: t('pms.guest.breakfastMornings').replace('{days}', String(stay.breakfast_days)).replace('{nights}', String(stay.nights)) });
  if (stay.insuite_orders > 0 || stay.requests.length) {
    const parts = [stay.insuite_items.join(', '), stay.requests.map((r) => `${humanize(r.type)} ×${r.count}`).join(', ')].filter(Boolean);
    details.push({ icon: ConciergeBell, text: `In-Suite: ${parts.join(' · ')}` });
  }
  const party = [
    stay.adults ? `${stay.adults} ${t(stay.adults === 1 ? 'pms.guest.adult' : 'pms.guest.adults')}` : null,
    stay.children ? `${stay.children} ${t(stay.children === 1 ? 'pms.guest.child' : 'pms.guest.children')}` : null,
  ].filter(Boolean).join(', ');

  return (
    <li className={`px-4 py-3 ${cancelled ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <Link to={`${basePath}/reservations/${stay.id}`} className="min-w-0 group">
          <div className={`font-medium group-hover:underline ${cancelled ? 'line-through' : ''}`}>
            {formatGuestDate(stay.check_in_date, language)} → {formatGuestDate(stay.check_out_date, language)}
            <span className="ml-2 text-sm font-normal text-muted-foreground">{t(stay.nights === 1 ? 'pms.guest.nightCount' : 'pms.guest.nightsCount').replace('{n}', String(stay.nights))}</span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {[stay.room_number ? `${t('pms.res.room')} ${stay.room_number}` : t('pms.unified.unassigned'), stay.room_type ? displayRoomType(stay.room_type) : null,
              channelLabel(stay.channel), stay.total_amount != null ? money(stay.total_amount, stay.currency, language) : null, party || null, stay.reservation_number]
              .filter(Boolean).join(' · ')}
          </div>
        </Link>
        <Badge className={`${RESERVATION_STATUS_COLORS[stay.status] || 'bg-muted'} shrink-0`}>{STATUS_KEYS[stay.status] ? t(STATUS_KEYS[stay.status]) : stay.status.replace('_', ' ')}</Badge>
      </div>
      {(details.length > 0 || request) && (
        <div className="mt-2 space-y-1 text-xs">
          {details.map((d) => <div key={d.text} className="flex items-start gap-1.5"><d.icon className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />{d.text}</div>)}
          {request && <div className="flex items-start gap-1.5 text-muted-foreground"><MessageSquareText className="mt-px h-3.5 w-3.5 shrink-0" /><span className="line-clamp-3 break-words">{request}</span></div>}
        </div>
      )}
    </li>
  );
}
