/**
 * Canonical RD Hotels property IDs for schedule ownership. Profiles may store
 * either a human-friendly hotel name or the immutable configuration key.
 * These aliases MUST NOT confer access: database RLS remains authoritative.
 */
const RD_HOTELS = [
  { id: 'memories-budapest', name: 'Hotel Memories Budapest' },
  { id: 'mika-downtown', name: 'Hotel Mika Downtown' },
  { id: 'gozsdu-court', name: 'Gozsdu Court Budapest' },
  { id: 'ottofiori', name: 'Hotel Ottofiori' },
] as const;

export function canonicalRdHotelId(value: string | null | undefined): string | null {
  const text = value?.trim().toLocaleLowerCase();
  if (!text) return null;
  return RD_HOTELS.find(h => h.id === text || h.name.toLocaleLowerCase() === text)?.id ?? value!.trim();
}

export function rdHotelDisplayName(value: string | null | undefined): string | null {
  const hotel = RD_HOTELS.find(h => h.id === canonicalRdHotelId(value));
  return hotel?.name ?? value ?? null;
}

export function isSameRdHotel(left: string | null | undefined, right: string | null | undefined): boolean {
  return !!left && !!right && canonicalRdHotelId(left) === canonicalRdHotelId(right);
}
