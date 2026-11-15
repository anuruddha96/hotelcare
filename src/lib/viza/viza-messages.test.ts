import { describe, expect, it } from 'vitest';
import {
  applyNamePairRule,
  buildArrivalBody,
  buildDepartureBody,
  buildEllenorzoString,
  buildStatusBody,
  escapeXml,
  readXmlTag,
  readXmlTags,
  vizaTimestamp,
  type EnvelopeCommon,
} from '../../../supabase/functions/_shared/viza/messages.ts';
import { guestToVizaGroups, splitMotherName } from '../../../supabase/functions/_shared/viza/mapGuest.ts';
import { iso3ToIso2 } from '../../../supabase/functions/_shared/viza/country.ts';

const HOTEL = {
  adatszolgaltatasiAzonosito: 'MA000001',
  szallasNev: 'Hotel Memories Budapest',
  szallashelySzolgaltatoAdoszam: '32571376-2-42',
  szallashelySzolgaltatoNev: 'Ceylon Business Services Kft.',
};

const COMMON: EnvelopeCommon = {
  uzenetAzonosito: '11111111-1111-4111-8111-111111111111',
  hotel: HOTEL,
  bejelentesIdopontja: '2026-11-23T14:00:00.000+01:00',
  alairas: 'c2ln', // base64 placeholder
  alairoTanusitvany: 'Y2VydA==',
};

describe('country codes', () => {
  it('converts ISO3 to ISO2 including MRZ specials', () => {
    expect(iso3ToIso2('HUN')).toBe('HU');
    expect(iso3ToIso2('DEU')).toBe('DE');
    expect(iso3ToIso2('D')).toBe('DE'); // German passports use D
    expect(iso3ToIso2('GBR')).toBe('GB');
    expect(iso3ToIso2('GBD')).toBe('GB'); // British dependent territories citizen
    expect(iso3ToIso2('RKS')).toBe('XK'); // Kosovo
    expect(iso3ToIso2('LKA')).toBe('LK');
  });
  it('passes through alpha-2 and rejects unknowns', () => {
    expect(iso3ToIso2('HU')).toBe('HU');
    expect(iso3ToIso2('ZZZ')).toBeNull();
    expect(iso3ToIso2('')).toBeNull();
    expect(iso3ToIso2(null)).toBeNull();
  });
});

describe('ellenorzoString', () => {
  it('joins id, arrival uuids and report time with pipes', () => {
    expect(buildEllenorzoString('MA000001', ['a', 'b'], '2026-11-23T14:00:00.000+01:00'))
      .toBe('MA000001|a|b|2026-11-23T14:00:00.000+01:00');
  });
});

describe('name-pair rule', () => {
  it('pulls the missing half of a pair from the scan into manual', () => {
    const out = applyNamePairRule(
      { csaladnev: 'KOVACS', utonev: 'ANNA' },
      { utonev: 'Anna-Maria' }, // receptionist corrected only the given name
    );
    expect(out).toEqual({ utonev: 'Anna-Maria', csaladnev: 'KOVACS' });
  });
  it('leaves complete pairs and empty manual untouched', () => {
    expect(applyNamePairRule({ csaladnev: 'X' }, null)).toBeNull();
    expect(applyNamePairRule(null, { csaladnev: 'A', utonev: 'B' }))
      .toEqual({ csaladnev: 'A', utonev: 'B' });
  });
});

describe('arrival body', () => {
  const guest = {
    erkezesAzonosito: '22222222-2222-4222-8222-222222222222',
    erkezesIdeje: '2026-11-23T14:05:00.000+01:00',
    tavozasVarhatoDatuma: '2026-11-25',
    scanned: { csaladnev: 'KOVACS', utonev: 'ANNA', allampolgarsagKod: 'HU', okmanyTipus: 'SZEM_IG' as const, okmanyAzonositoSzam: '123456AB' },
    manual: { szuletesiDatum: '1990-01-02', szuletesiHely: 'Budapest' },
  };

  it('builds a namespaced request with validation block and both data groups', () => {
    const { xml, ellenorzoString } = buildArrivalBody(COMMON, [guest]);
    expect(xml.startsWith('<v1:erkezesiAdatokBekuldeseRequest xmlns:v1="http://vizainfo.hu/thf/v1">')).toBe(true);
    expect(ellenorzoString).toBe(`MA000001|${guest.erkezesAzonosito}|${COMMON.bejelentesIdopontja}`);
    expect(readXmlTag(xml, 'ellenorzoString')).toBe(ellenorzoString);
    expect(readXmlTag(xml, 'adatszolgaltatasiAzonosito')).toBe('MA000001');
    expect(xml).toContain('<v1:okmanybolBeolvasottAdat>');
    expect(xml).toContain('<v1:manualisanRogzitettAdat>');
    // scanned data travels unchanged
    expect(xml).toContain('<v1:okmanyAzonositoSzam>123456AB</v1:okmanyAzonositoSzam>');
  });

  it('enforces the 1–10 guest limit', () => {
    expect(() => buildArrivalBody(COMMON, [])).toThrow();
    expect(() => buildArrivalBody(COMMON, Array.from({ length: 11 }, () => guest))).toThrow();
    expect(() => buildArrivalBody(COMMON, Array.from({ length: 10 }, () => guest))).not.toThrow();
  });

  it('escapes XML in values', () => {
    const { xml } = buildArrivalBody(COMMON, [{
      ...guest, scanned: null, manual: { csaladnev: 'O<Neil & Co', utonev: '"A"' },
    }]);
    expect(xml).toContain('O&lt;Neil &amp; Co');
    expect(xml).toContain('&quot;A&quot;');
    expect(escapeXml("'")).toBe('&apos;');
  });
});

describe('departure body', () => {
  it('only references the arrival uuid plus departure time', () => {
    const { xml, ellenorzoString } = buildDepartureBody(COMMON, [
      { erkezesAzonosito: 'uuid-1', tavozasIdeje: '2026-11-25T10:00:00.000+01:00' },
    ]);
    expect(xml).toContain('<v1:tavozasiAdatokBekuldeseRequest');
    expect(xml).toContain('<v1:tavozoVendeg><v1:erkezesAzonosito>uuid-1</v1:erkezesAzonosito>');
    expect(xml).not.toContain('okmanybolBeolvasottAdat');
    expect(ellenorzoString).toBe(`MA000001|uuid-1|${COMMON.bejelentesIdopontja}`);
  });
});

describe('status body + xml readers', () => {
  it('builds the status request and reads namespaced responses', () => {
    expect(buildStatusBody()).toContain('allapotLekerdezesRequest');
    const resp = '<ns2:valaszAdat><ns2:statusz>OK</ns2:statusz><ns2:uzenet>a</ns2:uzenet><ns2:uzenet>b</ns2:uzenet></ns2:valaszAdat>';
    expect(readXmlTag(resp, 'statusz')).toBe('OK');
    expect(readXmlTags(resp, 'uzenet')).toEqual(['a', 'b']);
    expect(readXmlTag(resp, 'missing')).toBeNull();
  });
});

describe('vizaTimestamp', () => {
  it('renders Budapest time with milliseconds and numeric offset', () => {
    // 2026-11-23 is CET (+01:00); 13:00Z -> 14:00 local
    expect(vizaTimestamp(new Date('2026-11-23T13:00:00.123Z'))).toBe('2026-11-23T14:00:00.123+01:00');
    // 2026-07-01 is CEST (+02:00)
    expect(vizaTimestamp(new Date('2026-07-01T12:00:00.000Z'))).toBe('2026-07-01T14:00:00.000+02:00');
  });
});

describe('guestToVizaGroups', () => {
  it('keeps the scan frozen and routes differing values to manual', () => {
    const { scanned, manual } = guestToVizaGroups({
      first_name: 'Anna-Maria', // differs from scan
      last_name: 'Kovacs', // same as scan (case-insensitive)
      date_of_birth: '1990-01-02', // absent from scan -> manual
      nationality: 'HUN', // alpha-3 -> HU, same as scan
      gender: 'female',
      id_document_type: 'passport',
      id_document_number: 'X1234567',
      document_scan: { fields: { csaladnev: 'KOVACS', utonev: 'ANNA', allampolgarsagKod: 'HU', okmanyTipus: 'UTLEVEL', okmanyAzonositoSzam: 'X1234567', nem: 'NO' } },
    });
    expect(scanned?.utonev).toBe('ANNA');
    expect(manual?.utonev).toBe('Anna-Maria');
    expect(manual?.csaladnev).toBeUndefined(); // unchanged half stays scanned (pair rule applies later)
    expect(manual?.szuletesiDatum).toBe('1990-01-02');
    expect(manual?.allampolgarsagKod).toBeUndefined();
  });

  it('with no scan, everything typed is manual', () => {
    const { scanned, manual } = guestToVizaGroups({
      first_name: 'John', last_name: 'Smith', nationality: 'GBR', gender: 'male', id_document_type: 'id_card',
    });
    expect(scanned).toBeNull();
    expect(manual).toEqual({
      csaladnev: 'Smith', utonev: 'John', allampolgarsagKod: 'GB', nem: 'FERFI', okmanyTipus: 'SZEM_IG',
    });
  });

  it('splits mother name in Hungarian order', () => {
    expect(splitMotherName('Nagy  Ilona Maria')).toEqual({ csalad: 'Nagy', uto: 'Ilona Maria' });
    expect(splitMotherName('Nagy')).toEqual({ csalad: 'Nagy', uto: null });
    expect(splitMotherName('')).toEqual({ csalad: null, uto: null });
  });
});
