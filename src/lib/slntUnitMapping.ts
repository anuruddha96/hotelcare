// SLNT-only helpers for turning Previo housekeeping export rows into draft
// unit mappings. Pure functions so they can be unit-tested and reused by the
// XLSX importer and the review UI. Nothing here runs for other tenants.

export const TECHNICAL_ROW_NAMES = ['technikai'];

export type MappingStatus =
  | 'suggested'
  | 'confirmed'
  | 'needs_review'
  | 'conflict'
  | 'ignored'
  | 'applied';

export type UnitMapping = {
  id: string;
  organization_slug: string;
  hotel_id: string;
  pms_account_id: string | null;
  pms_hotel_id: string | null;
  external_type_id: string | null;
  external_room_id: string | null;
  source_name: string;
  normalized_name: string;
  canonical_room_name: string | null;
  suggested_venue_name: string | null;
  venue_id: string | null;
  room_id: string | null;
  status: MappingStatus;
  confidence: number;
  conflict_reason: string | null;
  review_notes: string | null;
  source_kind: string;
  source_file: string | null;
  source_date: string | null;
  metadata: Record<string, unknown>;
};

/** Matches the SQL normalisation used by the unique index. */
export function normalizeUnitName(raw: string): string {
  return String(raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isTechnicalRow(raw: string): boolean {
  return TECHNICAL_ROW_NAMES.includes(normalizeUnitName(raw));
}

/**
 * Marketing-suffix-free key for a Previo unit name.
 * Previo REST returns long listing names ("CityNest - City center apartment",
 * "Giselle Apartment with Private Parking by Staymood Holidays") while the app
 * stores the short canonical unit name. Cutting at the first separator /
 * "with" / "by" gives a stable join key for both sides.
 */
export function coreUnitKey(raw: string): string {
  const n = String(raw ?? '').trim();
  const cut = n.split(/\s+[-–—·|]\s+|\s+by\s+|\s+with\s+|\s*\(/i)[0];
  return normalizeUnitName(cut || n);
}

export type UnitResolver = {
  resolve: (rawName: string, externalRoomId?: string | null) => string | null;
  size: number;
};

/**
 * Build a tolerant Previo-name → local room id resolver.
 * Lookup order: external room id → exact normalized name → marketing-suffix
 * stripped core key → unique prefix match. Ambiguous keys are dropped so a
 * name can never be matched to the wrong unit.
 */
export function buildUnitResolver(
  entries: Array<{ roomId: string; names: Array<string | null | undefined>; externalIds?: Array<string | null | undefined> }>,
): UnitResolver {
  const byExternal = new Map<string, string>();
  const byExact = new Map<string, string>();
  const byCore = new Map<string, string | null>(); // null => ambiguous

  for (const entry of entries) {
    for (const ext of entry.externalIds ?? []) {
      if (ext) byExternal.set(String(ext), entry.roomId);
    }
    for (const name of entry.names) {
      if (!name) continue;
      const exact = normalizeUnitName(String(name));
      if (exact && !byExact.has(exact)) byExact.set(exact, entry.roomId);
      const core = coreUnitKey(String(name));
      if (!core) continue;
      const existing = byCore.get(core);
      if (existing === undefined) byCore.set(core, entry.roomId);
      else if (existing !== entry.roomId) byCore.set(core, null);
    }
  }

  const resolve = (rawName: string, externalRoomId?: string | null): string | null => {
    if (externalRoomId) {
      const hit = byExternal.get(String(externalRoomId));
      if (hit) return hit;
    }
    const exact = normalizeUnitName(rawName);
    if (exact && byExact.has(exact)) return byExact.get(exact)!;
    const core = coreUnitKey(rawName);
    if (core) {
      const hit = byCore.get(core);
      if (hit) return hit;
      const exactAsCore = byExact.get(core);
      if (exactAsCore) return exactAsCore;
    }
    // Unique prefix match: local unit name is a prefix of the Previo listing
    // name (e.g. "Dandelion Apartment" ⊂ "Dandelion Apartment with free parking").
    if (exact.length >= 5) {
      let found: string | null = null;
      for (const [key, roomId] of byExact) {
        if (key.length < 5) continue;
        if (exact === key || exact.startsWith(`${key} `) || key.startsWith(`${exact} `)) {
          if (found && found !== roomId) return null;
          found = roomId;
        }
      }
      if (found) return found;
    }
    return null;
  };

  return { resolve, size: byExact.size + byExternal.size };
}



/** Suggested canonical unit name + venue cluster for a raw Previo name. */
export function deriveSuggestion(name: string): {
  unit: string;
  venue: string;
  confidence: number;
} {
  const n = String(name ?? '').trim();
  let m: RegExpMatchArray | null;

  if ((m = n.match(/^Grandio\s+(\d+)/i))) {
    return { unit: `Grandio ${m[1]}`, venue: 'Grandio', confidence: 0.9 };
  }
  if (/^Elisabeth Downtown/i.test(n)) {
    return { unit: n, venue: 'Elisabeth Downtown', confidence: 0.9 };
  }
  if (/^WR Pension\s+\d+$/i.test(n)) {
    return { unit: n, venue: 'WR Pension', confidence: 0.95 };
  }
  if ((m = n.match(/^St King 11 Room\s+(\d+)$/i))) {
    return { unit: `St King 11 – Room ${m[1]}`, venue: 'St King 11', confidence: 0.95 };
  }
  if ((m = n.match(/^K4 Room\s+(\d+)$/i))) {
    return { unit: `K4 – Room ${m[1]}`, venue: 'K4', confidence: 0.95 };
  }
  if (/^Silver Rooms\s+\d+$/i.test(n)) {
    return { unit: n, venue: 'Silver Rooms', confidence: 0.95 };
  }
  if (/^Duplex Penthouse/i.test(n)) {
    return { unit: 'Duplex Penthouse Terrace', venue: 'Klauzál utca 11', confidence: 0.6 };
  }

  const short = n.split(/\s+-\s+|\s+·\s+|\s+with\s+|\s+by\s+/i)[0].trim() || n;
  return { unit: short, venue: short, confidence: 0.6 };
}

/**
 * Extract the accommodation rows from a parsed housekeeping export.
 * Only the `Room` column is used — guest data is deliberately dropped.
 */
export function extractRoomNames(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const key = Object.keys(row).find((k) => normalizeUnitName(k) === 'room');
    const raw = String((key ? row[key] : '') ?? '').trim();
    if (!raw) continue;
    if (isTechnicalRow(raw)) continue;
    const norm = normalizeUnitName(raw);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(raw);
  }
  return out;
}

export const STATUS_LABELS: Record<MappingStatus, string> = {
  suggested: 'Suggested',
  confirmed: 'Confirmed',
  needs_review: 'Needs review',
  conflict: 'Conflict',
  ignored: 'Ignored',
  applied: 'Applied',
};
