// Step 2: one card per room type with photos, details and every rate plan for
// the stay (price, meal plan, cancellation terms). Blocked rates explain why.
import { useState } from 'react';
import { BedDouble, Check, ChevronLeft, ChevronRight, Coffee, Maximize2, Users, X } from 'lucide-react';
import { BrandButton } from './BookingUi';
import { bookingPlural, bookingT, type BookingLang } from '@/lib/bookingEngine/i18n';
import {
  formatDate, formatMoney, freeCancellationDate, pick, remainingOfType,
  type EngineRoomType, type Offer, type Selection,
} from '@/lib/bookingEngine/logic';
import { cn } from '@/lib/utils';

interface Props {
  lang: BookingLang;
  roomTypes: EngineRoomType[];
  offers: Offer[];
  selections: Selection[];
  roomsWanted: number;
  party: { adults: number; children: number };
  checkIn: string;
  nights: number;
  today: string;
  headingClass: string;
  onSelect: (selection: Selection) => void;
  onRemove: (index: number) => void;
}

function Gallery({ photos, name }: { photos: EngineRoomType['photos']; name: string }) {
  const [index, setIndex] = useState(0);
  if (!photos.length) {
    return <div className="grid h-full min-h-[180px] place-items-center bg-stone-100 text-stone-400"><BedDouble className="h-10 w-10" aria-hidden="true" /></div>;
  }
  const go = (delta: number) => setIndex((i) => (i + delta + photos.length) % photos.length);
  return (
    <div className="relative h-full min-h-[200px] overflow-hidden bg-stone-100">
      <img src={photos[index].url} alt={name} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      {photos.length > 1 && <>
        <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className="absolute left-2 top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-full bg-white/85 text-stone-800 shadow hover:bg-white"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" onClick={() => go(1)} aria-label="Next photo" className="absolute right-2 top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-full bg-white/85 text-stone-800 shadow hover:bg-white"><ChevronRight className="h-4 w-4" /></button>
        <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">{index + 1}/{photos.length}</span>
      </>}
    </div>
  );
}

export function RoomResults(props: Props) {
  const { lang, offers, selections } = props;
  const t = (key: string, values?: Record<string, string | number>) => bookingT(lang, key, values);
  const [open, setOpen] = useState<string | null>(null);
  const partySize = props.party.adults + props.party.children;
  const single = props.roomsWanted === 1;

  const cards = props.roomTypes
    .map((room) => ({ room, roomOffers: offers.filter((o) => o.room_type_id === room.id) }))
    .filter(({ room, roomOffers }) => roomOffers.length > 0 && room.rate_plans.length > 0)
    // Bookable rooms first, then by lowest price.
    .sort((a, b) => {
      const best = (list: Offer[]) => Math.min(...list.filter((o) => !o.blocked).map((o) => o.total), Infinity);
      const ba = best(a.roomOffers), bb = best(b.roomOffers);
      return (ba === Infinity ? 1 : 0) - (bb === Infinity ? 1 : 0) || ba - bb;
    });

  if (cards.length === 0 || cards.every(({ roomOffers }) => roomOffers.every((o) => o.blocked))) {
    return <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-stone-600">{t('noRooms')}</div>;
  }

  return (
    <div className="space-y-5">
      {cards.map(({ room, roomOffers }) => {
        const name = pick(room.names, lang, room.name);
        const description = pick(room.description, lang);
        const beds = pick(room.beds, lang);
        const left = remainingOfType(offers, selections, room.id);
        const available = Math.max(0, ...roomOffers.map((o) => o.available));
        const tooSmall = single && (room.max_occupancy < partySize || room.max_adults < props.party.adults || room.max_children < props.party.children);
        const chosenHere = selections.filter((s) => s.roomTypeId === room.id).length;
        return (
          <article key={room.id} className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm" aria-label={name}>
            <div className="grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <Gallery photos={room.photos} name={name} />
              <div className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <h3 className={`text-xl text-stone-900 ${props.headingClass}`}>{name}</h3>
                  {available > 0 && available <= 3 && <span className="shrink-0 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">{t('onlyLeft', { n: available })}</span>}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600">
                  <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4" />{t('upToGuests', { n: room.max_occupancy })}</span>
                  {room.size_sqm ? <span className="inline-flex items-center gap-1.5"><Maximize2 className="h-4 w-4" />{t('sqm', { n: room.size_sqm })}</span> : null}
                  {beds && <span className="inline-flex items-center gap-1.5"><BedDouble className="h-4 w-4" />{beds}</span>}
                </div>
                {room.amenities.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5" aria-label="Amenities">
                    {room.amenities.slice(0, open === room.id ? undefined : 5).map((a) => (
                      <li key={a} className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-700"><Check className="h-3 w-3" />{t(`am_${a}`)}</li>
                    ))}
                  </ul>
                )}
                {(description || room.amenities.length > 5) && (
                  <div>
                    {open === room.id && description && <p className="whitespace-pre-line text-sm leading-relaxed text-stone-700">{description}</p>}
                    <button type="button" className="mt-1 text-sm font-medium text-[var(--be-primary)] hover:underline" aria-expanded={open === room.id}
                      onClick={() => setOpen(open === room.id ? null : room.id)}>
                      {open === room.id ? t('hideDetails') : t('roomDetails')}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="divide-y divide-stone-100 border-t border-stone-200">
              {room.rate_plans.map((plan) => {
                const offer = roomOffers.find((o) => o.rate_plan_id === plan.id);
                if (!offer) return null;
                const deadline = freeCancellationDate(plan, props.checkIn, props.today);
                const reason = offer.blocked
                  ? t(`blocked_${offer.blocked}`, { n: offer.blocked === 'max_stay' ? offer.max_stay ?? '' : offer.min_stay ?? '' })
                  : tooSmall ? t('blocked_capacity', { n: room.max_occupancy }) : null;
                const blocked = Boolean(reason) || left <= 0;
                const meal = plan.meal_plan ? t(`meal_${plan.meal_plan}`) : '';
                return (
                  <div key={plan.id} className={cn('grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:px-5', blocked && 'bg-stone-50/60')}>
                    <div className="space-y-1">
                      <div className="font-semibold text-stone-900">{pick(plan.names, lang, plan.name)}</div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        {meal && <span className="inline-flex items-center gap-1.5 text-stone-700"><Coffee className="h-4 w-4" />{meal}</span>}
                        {deadline
                          ? <span className="inline-flex items-center gap-1.5 text-emerald-700"><Check className="h-4 w-4" />{t('freeCancelUntil', { date: formatDate(deadline, lang) })}</span>
                          : <span className="inline-flex items-center gap-1.5 text-stone-500"><X className="h-4 w-4" />{t('nonRefundable')}</span>}
                      </div>
                      <div className="text-xs text-stone-500">{t('payAtHotel')}</div>
                    </div>
                    <div className="flex items-center justify-between gap-4 sm:justify-end">
                      <div className="text-right">
                        {blocked && reason ? (
                          <div className="text-sm font-medium text-stone-500">{reason}</div>
                        ) : (
                          <>
                            <div className="text-xl font-bold text-stone-900 tabular-nums">{formatMoney(offer.total, offer.currency, lang)}</div>
                            <div className="text-xs text-stone-500">{bookingPlural(lang, 'nights', props.nights)} · {t('avgPerNight', { price: formatMoney(offer.total / Math.max(1, props.nights), offer.currency, lang) })}</div>
                          </>
                        )}
                      </div>
                      <BrandButton disabled={blocked || (!single && selections.length >= props.roomsWanted)}
                        onClick={() => props.onSelect({ roomTypeId: room.id, ratePlanId: plan.id })}
                        aria-label={`${t('select')}: ${name}, ${pick(plan.names, lang, plan.name)}`}>
                        {t('select')}
                      </BrandButton>
                    </div>
                  </div>
                );
              })}
            </div>
            {!single && chosenHere > 0 && (
              <div className="border-t border-stone-200 bg-[var(--be-soft)] px-5 py-2.5 text-sm text-stone-800">
                {selections.map((s, index) => s.roomTypeId === room.id && (
                  <span key={index} className="mr-3 inline-flex items-center gap-1.5">
                    <Check className="h-4 w-4 text-[var(--be-primary)]" />
                    {pick(room.rate_plans.find((p) => p.id === s.ratePlanId)?.names, lang, room.rate_plans.find((p) => p.id === s.ratePlanId)?.name ?? '')}
                    <button type="button" className="text-xs text-stone-500 underline hover:text-stone-800" onClick={() => props.onRemove(index)}>{t('remove')}</button>
                  </span>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
