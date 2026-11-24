import { describe, expect, it } from 'vitest';
import { isVizaPlaceholder, vizaArrivalExtras } from '../../../supabase/functions/_shared/viza/fieldRules';
import { guestToVizaGroups } from '../../../supabase/functions/_shared/viza/mapGuest';

const stay = 'specimen-stay';
const raw = { csaladnev: 'SPECIMEN', utonev: 'A', szuletesiDatum: '1950-01-01', allampolgarsagKod: 'GB', nem: 'FERFI', okmanyTipus: 'UTLEVEL', okmanyAzonositoSzam: '605100803' } as const;
const guest = { first_name: 'A', last_name: 'SPECIMEN', nationality: 'GB', date_of_birth: '1950-01-01', gender: 'male',
  id_document_type: 'passport', id_document_number: '605100803', birth_place: 'Gibraltar',
  visa_number: '0123456789', entry_date: '2026-11-23', entry_place: 'Budapest', document_scan: { fields: raw } };
describe('VIZA case 2.2 arrival data mapping', () => {
  it('preserves the original reader group and only supplies the printed birthplace manually', () => {
    expect(guestToVizaGroups(guest)).toEqual({ scanned: raw, manual: { szuletesiHely: 'Gibraltar' } });
    expect(vizaArrivalExtras(guest, stay)).toEqual({ vizumEngedelySzam: '0123456789', beutazasDatuma: '2026-11-23', beutazasHelye: 'Budapest' });
  });
  it('does not send stale values for a valid stay-scoped exemption', () => {
    expect(vizaArrivalExtras({ ...guest, viza_review: { reservation_id: stay, visa_exempt: true, entry_details_absent: true, entry_details_reason: 'other', entry_details_reason_text: 'Documented reason' } }, stay)).toEqual({ vizumEngedelySzam: null, beutazasDatuma: null, beutazasHelye: null });
    expect(vizaArrivalExtras({ ...guest, viza_review: { reservation_id: 'old-stay', visa_exempt: true } }, stay).vizumEngedelySzam).toBe('0123456789');
    expect(vizaArrivalExtras({ ...guest, viza_review: { reservation_id: stay, visa_exempt: true, entry_details_absent: true, entry_details_reason: 'lives_in_hungary_with_permit' } }, stay).vizumEngedelySzam).toBe('0123456789');
  });
  it('excludes non-third-country entry fields and filters placeholders', () => {
    expect(vizaArrivalExtras({ ...guest, nationality: 'DE' }, stay)).toEqual({ vizumEngedelySzam: null, beutazasDatuma: null, beutazasHelye: null });
    expect(vizaArrivalExtras({ ...guest, visa_number: '000', entry_place: ' NÁ ' }, stay)).toMatchObject({ vizumEngedelySzam: null, beutazasHelye: null });
    expect(guestToVizaGroups({ ...guest, birth_place: 'N/A' }).manual).toBeNull();
    expect(isVizaPlaceholder('0')).toBe(true);
    expect(isVizaPlaceholder('0123456789')).toBe(false);
  });
});
