/** SLNT terminology: property names change only for the SLNT organizations. */
import { useMemo } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import type { LangCode } from '@/components/training/v2/types';

export type PropertyTerms = {
  singular: string;
  plural: string;
  pickLabel: string;
  isProperty: boolean;
  unit: string;
  unitPlural: string;
  venue: string;
  venuePlural: string;
  checkoutSection: string;
  dailySection: string;
  noShowSection: string;
};

type ExtraTerms = Omit<PropertyTerms, 'singular' | 'plural' | 'pickLabel' | 'isProperty'>;

// Keep RD Hotels and all non-SLNT translations and behavior unchanged.
const HOTEL_EXTRAS: Record<LangCode, ExtraTerms> = {
  en: { unit: 'Room', unitPlural: 'Rooms', venue: 'Hotel', venuePlural: 'Hotels', checkoutSection: 'Checkout Rooms', dailySection: 'Daily Rooms', noShowSection: 'No Show Rooms' },
  hu: { unit: 'Szoba', unitPlural: 'Szobák', venue: 'Szálloda', venuePlural: 'Szállodák', checkoutSection: 'Kijelentkező szobák', dailySection: 'Napi szobák', noShowSection: 'Meg nem jelent szobák' },
  es: { unit: 'Habitación', unitPlural: 'Habitaciones', venue: 'Hotel', venuePlural: 'Hoteles', checkoutSection: 'Habitaciones de salida', dailySection: 'Habitaciones diarias', noShowSection: 'Habitaciones no-show' },
  vi: { unit: 'Phòng', unitPlural: 'Phòng', venue: 'Khách sạn', venuePlural: 'Khách sạn', checkoutSection: 'Phòng trả', dailySection: 'Phòng hàng ngày', noShowSection: 'Phòng khách không đến' },
  mn: { unit: 'Өрөө', unitPlural: 'Өрөөнүүд', venue: 'Зочид буудал', venuePlural: 'Зочид буудлууд', checkoutSection: 'Гарах өрөө', dailySection: 'Өдөр тутмын өрөө', noShowSection: 'Ирээгүй өрөө' },
  uk: { unit: 'Номер', unitPlural: 'Номери', venue: 'Готель', venuePlural: 'Готелі', checkoutSection: 'Номери на виїзд', dailySection: 'Щоденні номери', noShowSection: 'Номери без заїзду' },
};

// Fruzsi named a Daily Cleaning type in the 2026-09-21 email, but did not
// define its frequency. SLNT label changes must NOT alter the canonical
// checkout/daily classification, assignment type or service-cycle scheduler.
const PROPERTY_EXTRAS: Record<LangCode, ExtraTerms> = {
  en: { unit: 'Unit', unitPlural: 'Units', venue: 'Venue', venuePlural: 'Venues', checkoutSection: 'Checkout Units', dailySection: 'Daily Cleaning', noShowSection: 'No Show Units' },
  hu: { unit: 'Egység', unitPlural: 'Egységek', venue: 'Helyszín', venuePlural: 'Helyszínek', checkoutSection: 'Kijelentkező egységek', dailySection: 'Napi takarítás', noShowSection: 'Meg nem jelent egységek' },
  es: { unit: 'Unidad', unitPlural: 'Unidades', venue: 'Ubicación', venuePlural: 'Ubicaciones', checkoutSection: 'Unidades de salida', dailySection: 'Limpieza diaria', noShowSection: 'Unidades no-show' },
  vi: { unit: 'Căn hộ', unitPlural: 'Căn hộ', venue: 'Địa điểm', venuePlural: 'Địa điểm', checkoutSection: 'Căn hộ trả', dailySection: 'Dọn phòng hàng ngày', noShowSection: 'Căn hộ khách không đến' },
  mn: { unit: 'Байр', unitPlural: 'Байрууд', venue: 'Байршил', venuePlural: 'Байршлууд', checkoutSection: 'Гарах байр', dailySection: 'Өдөр тутмын цэвэрлэгээ', noShowSection: 'Ирээгүй байр' },
  uk: { unit: 'Помешкання', unitPlural: 'Помешкання', venue: 'Локація', venuePlural: 'Локації', checkoutSection: 'Помешкання на виїзд', dailySection: 'Щоденне прибирання', noShowSection: 'Помешкання без заїзду' },
};

const HOTEL_TERMS: Record<LangCode, PropertyTerms> = {
  en: { singular: 'Hotel', plural: 'Hotels', pickLabel: 'Select hotel', isProperty: false, ...HOTEL_EXTRAS.en },
  hu: { singular: 'Szálloda', plural: 'Szállodák', pickLabel: 'Válassz szállodát', isProperty: false, ...HOTEL_EXTRAS.hu },
  es: { singular: 'Hotel', plural: 'Hoteles', pickLabel: 'Elegir hotel', isProperty: false, ...HOTEL_EXTRAS.es },
  vi: { singular: 'Khách sạn', plural: 'Khách sạn', pickLabel: 'Chọn khách sạn', isProperty: false, ...HOTEL_EXTRAS.vi },
  mn: { singular: 'Зочид буудал', plural: 'Зочид буудлууд', pickLabel: 'Буудлаа сонго', isProperty: false, ...HOTEL_EXTRAS.mn },
  uk: { singular: 'Готель', plural: 'Готелі', pickLabel: 'Оберіть готель', isProperty: false, ...HOTEL_EXTRAS.uk },
};

const PROPERTY_TERMS: Record<LangCode, PropertyTerms> = {
  en: { singular: 'Property', plural: 'Properties', pickLabel: 'Select property', isProperty: true, ...PROPERTY_EXTRAS.en },
  hu: { singular: 'Ingatlan', plural: 'Ingatlanok', pickLabel: 'Válassz ingatlant', isProperty: true, ...PROPERTY_EXTRAS.hu },
  es: { singular: 'Propiedad', plural: 'Propiedades', pickLabel: 'Elegir propiedad', isProperty: true, ...PROPERTY_EXTRAS.es },
  vi: { singular: 'Tài sản', plural: 'Tài sản', pickLabel: 'Chọn tài sản', isProperty: true, ...PROPERTY_EXTRAS.vi },
  mn: { singular: 'Байр', plural: 'Байрууд', pickLabel: 'Байраа сонго', isProperty: true, ...PROPERTY_EXTRAS.mn },
  uk: { singular: 'Об’єкт', plural: 'Об’єкти', pickLabel: 'Оберіть об’єкт', isProperty: true, ...PROPERTY_EXTRAS.uk },
};

const PROPERTY_ORG_SLUGS = new Set<string>(['slnt', 'slnt-group']);

export function propertyTermsFor(orgSlug: string | null | undefined, lang: LangCode = 'en'): PropertyTerms {
  const slug = (orgSlug ?? '').toLowerCase();
  const isProperty = PROPERTY_ORG_SLUGS.has(slug);
  const table = isProperty ? PROPERTY_TERMS : HOTEL_TERMS;
  return table[lang] ?? table.en;
}

export function usePropertyTerms(lang: LangCode = 'en'): PropertyTerms {
  let slug: string | undefined;
  try {
    slug = useTenant().organization?.slug;
  } catch {
    slug = undefined;
  }
  return useMemo(() => propertyTermsFor(slug, lang), [slug, lang]);
}
