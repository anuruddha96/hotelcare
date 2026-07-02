/**
 * SLNT group operates airbnbs / long-term rentals, not hotels, so we relabel
 * "Hotel" as "Property" everywhere in their UI. Every other organization
 * (memories, mika, etc.) keeps the "Hotel" wording unchanged.
 *
 * Usage:
 *   const t = usePropertyTerms(); // { singular: 'Property', plural: 'Properties', pickLabel: 'Select property' }
 *   <Label>{t.singular}</Label>
 */

import { useMemo } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import type { LangCode } from '@/components/training/v2/types';

export type PropertyTerms = {
  singular: string;
  plural: string;
  pickLabel: string;
  isProperty: boolean; // true for SLNT-like orgs
};

const HOTEL_TERMS: Record<LangCode, PropertyTerms> = {
  en: { singular: 'Hotel', plural: 'Hotels', pickLabel: 'Select hotel', isProperty: false },
  hu: { singular: 'Szálloda', plural: 'Szállodák', pickLabel: 'Válassz szállodát', isProperty: false },
  es: { singular: 'Hotel', plural: 'Hoteles', pickLabel: 'Elegir hotel', isProperty: false },
  vi: { singular: 'Khách sạn', plural: 'Khách sạn', pickLabel: 'Chọn khách sạn', isProperty: false },
  mn: { singular: 'Зочид буудал', plural: 'Зочид буудлууд', pickLabel: 'Буудлаа сонго', isProperty: false },
};

const PROPERTY_TERMS: Record<LangCode, PropertyTerms> = {
  en: { singular: 'Property', plural: 'Properties', pickLabel: 'Select property', isProperty: true },
  hu: { singular: 'Ingatlan', plural: 'Ingatlanok', pickLabel: 'Válassz ingatlant', isProperty: true },
  es: { singular: 'Propiedad', plural: 'Propiedades', pickLabel: 'Elegir propiedad', isProperty: true },
  vi: { singular: 'Tài sản', plural: 'Tài sản', pickLabel: 'Chọn tài sản', isProperty: true },
  mn: { singular: 'Байр', plural: 'Байрууд', pickLabel: 'Байраа сонго', isProperty: true },
};

/** Orgs that use "Property" terminology. Extend when new rental-style orgs onboard. */
const PROPERTY_ORG_SLUGS = new Set<string>(['slnt']);

export function propertyTermsFor(orgSlug: string | null | undefined, lang: LangCode = 'en'): PropertyTerms {
  const slug = (orgSlug ?? '').toLowerCase();
  const isProperty = PROPERTY_ORG_SLUGS.has(slug);
  const table = isProperty ? PROPERTY_TERMS : HOTEL_TERMS;
  return table[lang] ?? table.en;
}

export function usePropertyTerms(lang: LangCode = 'en'): PropertyTerms {
  // Safe outside a TenantProvider (e.g. TrainingV2Provider mounts above the
  // tenant router). Fall back to hotel terminology when no tenant context.
  let slug: string | undefined;
  try {
    slug = useTenant().organization?.slug;
  } catch {
    slug = undefined;
  }
  return useMemo(() => propertyTermsFor(slug, lang), [slug, lang]);
}
