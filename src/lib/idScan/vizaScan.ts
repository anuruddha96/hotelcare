/**
 * Shape a document scan for storage on the guest (guests.document_scan).
 *
 * VIZA requires data read from the document to travel UNCHANGED in the
 * arrival message, separately from anything typed by hand — so the reader's
 * output is frozen here, in VIZA vocabulary, at the moment the receptionist
 * accepts the scan.
 */
import type { MrzReadResult } from './mrz';
import { iso3ToIso2 } from '../../../supabase/functions/_shared/viza/country';

export interface VizaDocumentScan {
  source: 'mrz_camera';
  format: string;
  valid: boolean;
  read_at: string;
  fields: {
    csaladnev: string | null;
    utonev: string | null;
    szuletesiDatum: string | null;
    allampolgarsagKod: string | null; // ISO alpha-2
    nem: 'NO' | 'FERFI' | 'EGYEB_VAGY_NEM_ISMERT' | null;
    okmanyTipus: 'SZEM_IG' | 'UTLEVEL' | 'VEZ_ENG' | 'EGYEB' | null;
    okmanyAzonositoSzam: string | null;
  };
}

const GENDER: Record<string, VizaDocumentScan['fields']['nem']> = {
  male: 'FERFI',
  female: 'NO',
  other: 'EGYEB_VAGY_NEM_ISMERT',
};

export function toVizaDocumentScan(result: MrzReadResult, now = new Date()): VizaDocumentScan {
  const f = result.fields;
  // The code lines hold only A–Z: pass the reader's own capitals through, never a re-cased copy.
  const asRead = (mrz: string | undefined, shown: string) => (mrz ?? shown.toUpperCase()) || null;
  // A country code the reader got wrong must not travel as "read from the
  // document" (the THF rejects the whole guest); staff then type the right one.
  const country = iso3ToIso2(f.nationality);
  return {
    source: 'mrz_camera',
    format: result.format,
    valid: result.valid,
    read_at: now.toISOString(),
    fields: {
      csaladnev: asRead(f.mrzLastName, f.lastName),
      utonev: asRead(f.mrzFirstName, f.firstName),
      szuletesiDatum: f.dateOfBirth,
      allampolgarsagKod: country && !result.unknownCountry ? country : null,
      nem: f.gender ? GENDER[f.gender] ?? 'EGYEB_VAGY_NEM_ISMERT' : null,
      okmanyTipus: f.documentType === 'passport' ? 'UTLEVEL' : 'SZEM_IG',
      okmanyAzonositoSzam: f.documentNumber || null,
    },
  };
}
