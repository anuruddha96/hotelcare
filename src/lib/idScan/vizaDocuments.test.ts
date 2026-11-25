import { describe, expect, it } from 'vitest';
import { readMrz, repairNameFiller } from './mrz';
import { toVizaDocumentScan } from './vizaScan';
import { documentRequired, scanFieldState, vizaMissingFields, vizaProblems } from './guestVizaChecks';
import { guestToVizaGroups } from '../../../supabase/functions/_shared/viza/mapGuest';
import { isDue, NEEDS_CORRECTION, nextAttemptAt, readSubmissionOutcome, retryDelayMinutes } from '../../../supabase/functions/_shared/viza/outcome';

const TODAY = new Date('2026-11-23T12:00:00Z');

// Code lines of the four specimen documents in the VIZA validation guide (v2.01),
// as the reader's OCR returns them — including the text it picks up around the code zone.
const HUNGARIAN_ID = 'I<HUN000000XX<0<<<<<<<<<<<<<<<\n7906307F2201100HUN<<<<<<<<<<<602\nSZEPENE<KISS<<ROZALIA<<<<<<<<<O\n\nIRTBNRRBBBDD';
const BRITISH_PASSPORT = '2055 A720 R B\nP<GBRSPECIMEN<<A<<<<<<<<<<<<<<<<<<<<<<<<<<<<\n6051008033GBR5001013M1701245<<<<<<<<<<<<<<00';
const GREEK_PASSPORT = 'E<6ADX01S5OMC2ALEAJAA<NPC10Y9OCOH6GN1182\nP<GRCELLINAS<<GEORGIOS<<<<<<<<<<<<<<<<<<<<<<\nAE00000057GRC6504049M1208283<<<<<<<<<<<<<<00';
const SWEDISH_PASSPORT_POOR = 'T00PUNIMOSNR OUEASP<<AM9K0\nP<SWESPECIMEN<<SVEN<<<<<<<<<<<<<<<<<<<<<<<<<\n59000001<5SWF8703145M1701027198703142391<<46';

describe('VIZA validation documents', () => {
  it('2.1 reads the Hungarian identity card, ignoring text printed under the code zone', () => {
    const r = readMrz(HUNGARIAN_ID, TODAY);
    expect(r?.format).toBe('TD1');
    expect(r?.valid).toBe(true);
    expect(r?.fields).toMatchObject({
      mrzLastName: 'SZEPENE KISS', mrzFirstName: 'ROZALIA', nationality: 'HU', dateOfBirth: '1979-06-30',
      gender: 'female', documentType: 'id_card', documentNumber: '000000XX',
    });
  });

  it('2.2 reads the foreign (British specimen) passport', () => {
    const r = readMrz(BRITISH_PASSPORT, TODAY);
    expect(r?.valid).toBe(true);
    expect(r?.fields).toMatchObject({ mrzLastName: 'SPECIMEN', mrzFirstName: 'A', nationality: 'GB', documentType: 'passport', documentNumber: '605100803', dateOfBirth: '1950-01-01' });
  });

  it('2.3 reads the Greek passport in the international (Latin) characters of the code zone', () => {
    const r = readMrz(GREEK_PASSPORT, TODAY);
    expect(r?.valid).toBe(true);
    expect(r?.fields).toMatchObject({ mrzLastName: 'ELLINAS', mrzFirstName: 'GEORGIOS', nationality: 'GR', documentNumber: 'AE0000005', dateOfBirth: '1965-04-04' });
  });

  it('2.4 poor-quality passport: a misread nationality is flagged and never sent as document data', () => {
    const r = readMrz(SWEDISH_PASSPORT_POOR, TODAY)!;
    expect(r.unknownCountry).toBe(true);
    const scan = toVizaDocumentScan(r, TODAY);
    expect(scan.fields).toMatchObject({ csaladnev: 'SPECIMEN', utonev: 'SVEN', szuletesiDatum: '1987-03-14', okmanyAzonositoSzam: '59000001', allampolgarsagKod: null });
    // Reception types the nationality: it travels as a manual entry, the reading stays as it was.
    const groups = guestToVizaGroups({ last_name: 'Specimen', first_name: 'Sven', date_of_birth: '1987-03-14', gender: 'male', nationality: 'SE', id_document_type: 'passport', id_document_number: '59000001', birth_place: 'Stockholm', document_scan: scan });
    expect(groups.scanned).toEqual(scan.fields);
    expect(groups.manual).toEqual({ szuletesiHely: 'Stockholm', allampolgarsagKod: 'SE' });
  });
});

describe('document reading', () => {
  it('restores filler that OCR read as letters after the given names', () => {
    expect(repairNameFiller('P<GRCELLINAS<<GEORGIOS<<<<<<KKKKKKKKKKKKKK<<')).toBe('P<GRCELLINAS<<GEORGIOS<<<<<<<<<<<<<<<<<<<<<<');
    expect(repairNameFiller('ERIKSSON<<ANNA<MARIA<<<<<<<K<<')).toBe('ERIKSSON<<ANNA<MARIA<<<<<<<<<<');
    expect(repairNameFiller('ERIKSSON<<ANNA<MARIA<<<<<<<<<<')).toBe('ERIKSSON<<ANNA<MARIA<<<<<<<<<<');
  });

  it('keeps the given names on German passports, whose country code is D<<', () => {
    expect(repairNameFiller('P<D<<MUSTERMANN<<ERIKA<<<<<<<<<<<<<<<<<<<<<<', 5)).toBe('P<D<<MUSTERMANN<<ERIKA<<<<<<<<<<<<<<<<<<<<<<');
    expect(repairNameFiller('P<D<<MUSTERMANN<<ERIKA<<<<<<KKKKKKKKKKKKKK<<', 5)).toBe('P<D<<MUSTERMANN<<ERIKA<<<<<<<<<<<<<<<<<<<<<<');
    const r = readMrz('P<D<<MUSTERMANN<<ERIKA<<<<<<<<<<<<<<<<<<<<<<\nC01X00T478D<<6408125F3108284<<<<<<<<<<<<<<<0', TODAY)!;
    expect(r.valid).toBe(true);
    expect(r.fields).toMatchObject({ lastName: 'Mustermann', firstName: 'Erika', nationality: 'DE', documentNumber: 'C01X00T47', expiryDate: '2031-08-28' });
  });

  it('keeps the names exactly as the code lines carry them', () => {
    const scan = toVizaDocumentScan(readMrz(HUNGARIAN_ID, TODAY)!, TODAY);
    expect(scan.fields).toMatchObject({ csaladnev: 'SZEPENE KISS', utonev: 'ROZALIA', allampolgarsagKod: 'HU', nem: 'NO', okmanyTipus: 'SZEM_IG', okmanyAzonositoSzam: '000000XX' });
  });

  it('sends an accent corrected by hand as manual data, with both halves of the name', () => {
    const scan = toVizaDocumentScan(readMrz(HUNGARIAN_ID, TODAY)!, TODAY);
    const guest = { last_name: 'Szépéné Kiss', first_name: 'Rozália', date_of_birth: '1979-06-30', gender: 'female', nationality: 'HU', id_document_type: 'id_card', id_document_number: '000000XX', document_scan: scan };
    expect(scanFieldState('last_name', guest, scan)).toBe('corrected');
    expect(scanFieldState('date_of_birth', guest, scan)).toBe('fromDocument');
    expect(scanFieldState('birth_place', guest, scan)).toBeNull();
    const groups = guestToVizaGroups(guest);
    expect(groups.scanned).toEqual(scan.fields);
    expect(groups.manual).toEqual({ csaladnev: 'Szépéné Kiss', utonev: 'Rozália' });
  });
});

describe('front-desk checks', () => {
  const complete = { last_name: 'Kiss', first_name: 'Rozália', nationality: 'HU', date_of_birth: '1979-06-30', birth_place: 'Debrecen', gender: 'female', id_document_type: 'id_card', id_document_number: '000000XX' };

  it('lists what is still missing', () => {
    expect(vizaMissingFields(complete, TODAY)).toEqual([]);
    expect(vizaMissingFields({ ...complete, birth_place: ' ', id_document_number: null }, TODAY)).toEqual(['birth_place', 'id_document_number']);
  });

  it('does not ask a guest under 14 for a document', () => {
    expect(documentRequired('2012-11-24', TODAY)).toBe(false); // turns 14 tomorrow
    expect(documentRequired('2012-11-23', TODAY)).toBe(true);
    expect(vizaMissingFields({ ...complete, date_of_birth: '2015-05-01', id_document_type: null, id_document_number: null }, TODAY)).toEqual([]);
  });

  it('finds values the THF would refuse', () => {
    expect(vizaProblems(complete, TODAY)).toEqual([]);
    expect(vizaProblems({ ...complete, birth_last_name: 'Kiss', mother_name: 'Irma', entry_date: '2026-11-24', nationality: 'XYZ', date_of_birth: '1890-01-01' }, TODAY))
      .toEqual(['birthNamePair', 'motherName', 'entryDate', 'nationality', 'birthDate']);
    expect(vizaProblems({ ...complete, birth_last_name: 'Kiss', birth_first_name: 'Rozália', mother_name: 'Kalcsó Irma', entry_date: '2026-11-22' }, TODAY)).toEqual([]);
  });
});

describe('THF answer per guest', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const answer = (ok: boolean, items: string) => `<ns2:erkezesiAdatokBekuldeseResponse xmlns:ns2="http://vizainfo.hu/thf/v1"><ns2:valaszAdat><ns2:sikeresBefogadas>${ok}</ns2:sikeresBefogadas><ns2:fogadasAzonosito>f0f0</ns2:fogadasAzonosito>${items}</ns2:valaszAdat></ns2:erkezesiAdatokBekuldeseResponse>`;
  const item = (id: string, code: string, text = '') => `<ns2:hibaLista><ns2:erkezesAzonosito>${id}</ns2:erkezesAzonosito><ns2:hibaKod>${code}</ns2:hibaKod><ns2:hibaSzoveg>${text}</ns2:hibaSzoveg></ns2:hibaLista>`;

  it('marks every guest accepted when the THF took the message', () => {
    const outcome = readSubmissionOutcome(answer(true, item(A, 'OK') + item(B, 'OK')), [A, B]);
    expect(outcome).toMatchObject({ accepted: true, fogadasAzonosito: 'f0f0' });
    expect(outcome?.guests.map((g) => g.result)).toEqual(['accepted', 'accepted']);
  });

  it('holds a refused guest for correction and sends the others again', () => {
    const outcome = readSubmissionOutcome(answer(false, item(A, 'OK') + item(B, 'EF0047', 'Születési dátum hiányzik/érvénytelen.')), [A, B]);
    expect(outcome?.guests).toEqual([
      { erkezesAzonosito: A, result: 'resend' },
      { erkezesAzonosito: B, result: 'rejected', code: 'EF0047', text: 'Születési dátum hiányzik/érvénytelen.' },
    ]);
  });

  it('treats a fault, an empty body or a refusal that names no guest as a failed send', () => {
    expect(readSubmissionOutcome('<soap:Fault><faultstring>boom</faultstring></soap:Fault>', [A])).toBeNull();
    expect(readSubmissionOutcome(null, [A])).toBeNull();
    expect(readSubmissionOutcome(answer(false, ''), [A])).toBeNull();
  });
});

describe('resend schedule (interface guide 6.2)', () => {
  it('waits longer after each failed send, then daily without end', () => {
    expect([0, 1, 2, 3, 4, 40].map(retryDelayMinutes)).toEqual([0, 0, 60, 360, 1440, 1440]);
  });

  it('knows when a failed send is due and never retries a refused guest by itself', () => {
    const tried = '2026-11-23T10:00:00Z';
    expect(isDue(2, tried, new Date('2026-11-23T10:59:00Z'))).toBe(false);
    expect(isDue(2, tried, new Date('2026-11-23T11:00:00Z'))).toBe(true);
    expect(nextAttemptAt(3, tried)?.toISOString()).toBe('2026-11-23T16:00:00.000Z');
    expect(isDue(NEEDS_CORRECTION, tried, new Date('2030-01-01T00:00:00Z'))).toBe(false);
  });
});
