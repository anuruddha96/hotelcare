/**
 * Tolerant parser for NTAK v9 responses (10.6, examples 11.x): synchronous
 * acceptance (feldolgozasAzonosito), synchronous rejection (SOAP Fault whose
 * <detail> holds <error hibaKulcs=.. /> attributes, or hibaLista elements) and
 * verification results (ellenorzesResponse). Prefix-agnostic, no DOM needed.
 */
import { ERROR_KEYS } from './codes.ts';

export interface NtakIssue {
  field: string; value: string | null; key: string; message: string; hint?: string;
  /** Where NTAK located the problem (HibaType epulet / szobaszam / foglalasiSzam), when it says. */
  building?: string; room?: string; bookingNo?: string;
}

export interface NtakVerification {
  processingId: string;
  status: string;
  warnings: NtakIssue[];
  errors: NtakIssue[];
  /** Only for adatszolgaltatasKezdoDatum queries: from the separate
   * adatszolgaltatasKezdoDatumok list of ellenorzesResponse (or, in older
   * examples, inside uzenetValaszok). */
  expectedStartDate: string | null;
}

export type NtakResponse =
  | { kind: 'accepted'; processingId: string; warnings: NtakIssue[] }
  | { kind: 'rejected'; faultCode: string | null; faultString: string | null; errors: NtakIssue[]; warnings: NtakIssue[] }
  | { kind: 'verification'; results: NtakVerification[] }
  | { kind: 'unparseable'; snippet: string };

export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** Inner XML of every element with this local name (any prefix). Self-closing tags yield ''. */
export function innerOf(xml: string, local: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<(?:[\\w.-]+:)?${local}(?:\\s[^>]*?)?(\\/)?>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[1]) { out.push(''); continue; }
    const closeRe = new RegExp(`</(?:[\\w.-]+:)?${local}\\s*>`, 'g');
    closeRe.lastIndex = re.lastIndex;
    const c = closeRe.exec(xml);
    if (!c) break;
    out.push(xml.slice(re.lastIndex, c.index));
    re.lastIndex = closeRe.lastIndex;
  }
  return out;
}

const first = (xml: string, local: string): string | null => {
  const v = innerOf(xml, local)[0];
  return v === undefined ? null : decodeEntities(v.replace(/<[^>]+>/g, '').trim());
};

const withHint = (i: Omit<NtakIssue, 'hint'>): NtakIssue => (ERROR_KEYS[i.key] ? { ...i, hint: ERROR_KEYS[i.key] } : i);

/** <hiba><mezoNeve/>..</hiba> items of a list element. */
function issuesFromList(listXml: string | undefined): NtakIssue[] {
  if (!listXml) return [];
  return innerOf(listXml, 'hiba').map((h) => {
    const issue: NtakIssue = withHint({
      field: first(h, 'mezoNeve') ?? 'GLOBAL',
      value: first(h, 'kuldottErtek'),
      key: first(h, 'hibaKulcs') ?? 'UNKNOWN',
      message: first(h, 'hibaUzenet') ?? '',
    });
    const building = first(h, 'epulet'), room = first(h, 'szobaszam'), bookingNo = first(h, 'foglalasiSzam');
    if (building) issue.building = building;
    if (room) issue.room = room;
    if (bookingNo) issue.bookingNo = bookingNo;
    return issue;
  });
}

/** <error hibaKulcs=".." hibaUzenet=".." kuldottErtek=".." mezoNeve=".."/> inside a Fault detail. */
function issuesFromFaultDetail(detail: string): NtakIssue[] {
  const out: NtakIssue[] = [];
  const re = /<(?:[\w.-]+:)?error\s([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(detail))) {
    const attrs: Record<string, string> = {};
    const ar = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(m[1]))) attrs[a[1].replace(/^.*:/, '')] = decodeEntities(a[3] ?? a[4] ?? '');
    out.push(withHint({
      field: attrs.mezoNeve || 'GLOBAL',
      value: attrs.kuldottErtek ?? null,
      key: attrs.hibaKulcs || 'UNKNOWN',
      message: attrs.hibaUzenet || '',
    }));
  }
  return out;
}

export function parseNtakResponse(xml: string): NtakResponse {
  const text = String(xml ?? '');
  const fault = innerOf(text, 'Fault')[0];
  if (fault !== undefined) {
    const detail = innerOf(fault, 'detail')[0] ?? '';
    const errors = [...issuesFromFaultDetail(detail), ...issuesFromList(innerOf(detail, 'hibaLista')[0])];
    return {
      kind: 'rejected',
      faultCode: first(fault, 'faultcode'),
      faultString: first(fault, 'faultstring'),
      errors,
      warnings: issuesFromList(innerOf(detail, 'figyelmeztetesLista')[0]),
    };
  }

  // ellenorzesResponse: adatszolgaltatasKezdoDatumok (start dates) and
  // uzenetValaszok (statuses) are two optional lists keyed by processing id.
  const startDates = new Map<string, string | null>();
  for (const d of innerOf(text, 'adatszolgaltatasKezdoDatumok')) {
    startDates.set(first(d, 'feldolgozasAzonosito') ?? '', first(d, 'elvartAdatszolgaltatasKezdoDatuma'));
  }
  const answers = innerOf(text, 'uzenetValaszok');
  if (answers.length || startDates.size) {
    const results: NtakVerification[] = answers.map((a) => {
      const processingId = first(a, 'feldolgozasAzonosito') ?? '';
      return {
        processingId,
        status: first(a, 'statusz') ?? 'UNKNOWN',
        warnings: issuesFromList(innerOf(a, 'figyelmeztetesLista')[0]),
        errors: issuesFromList(innerOf(a, 'hibaLista')[0]),
        expectedStartDate: startDates.get(processingId) ?? first(a, 'elvartAdatszolgaltatasKezdoDatuma'),
      };
    });
    // A start date returned without a status line means the query was processed.
    for (const [processingId, expectedStartDate] of startDates) {
      if (!results.some((r) => r.processingId === processingId)) {
        results.push({ processingId, status: 'TELJESEN_SIKERES', warnings: [], errors: [], expectedStartDate });
      }
    }
    return { kind: 'verification', results };
  }

  const processingId = first(text, 'feldolgozasAzonosito');
  const errors = issuesFromList(innerOf(text, 'hibaLista')[0]);
  const warnings = issuesFromList(innerOf(text, 'figyelmeztetesLista')[0]);
  if (processingId && !errors.length) return { kind: 'accepted', processingId, warnings };
  if (errors.length) return { kind: 'rejected', faultCode: null, faultString: null, errors, warnings };
  return { kind: 'unparseable', snippet: text.replace(/\s+/g, ' ').slice(0, 300) };
}

/** True when the answer means "fix the data and resend the whole message". */
export const needsCorrection = (status: string) => status === 'TELJESEN_HIBAS' || status === 'VIZSGALANDO';
