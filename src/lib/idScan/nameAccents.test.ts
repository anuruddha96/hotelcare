import { describe, expect, it } from 'vitest';
import { accentedFromReadings, harmonizeNameAccents, restoreDocumentNames } from './nameAccents';

// Real Tesseract output for the VIZA 2.1 specimen card front (Hungarian model
// unless noted). Each reading alone is imperfect; together with the code-line
// letters they give the printed name.
const HUNGARIAN_ONLY_LINE = 'SZÉPENÉ KISS ROZÁHA. N';
const HUNGARIAN_ONLY_CARD = ['. MAGYARORSZÁG / HUNGARY e) 1', 'SZEMÉLYAZONOSÍTÓ IGAZOLVÁNY / IDENTITY:GARD ÉG', 'p—— Családi é éz ne aA nat — A', 'i (4 SZÉPENÉ SS ROZÁMA:', 'WV dl . FI sül 99. [124 VEEHsÉt'].join('\n');
const LOW_RES_CARD = ['. MAGYARORSZÁG / HUNGARY 2', 'SZEMÉLYAZONOSÍTÓ IGAZOLVÁNY / IDENTITY:GARD 8', 'MEZ Családi és sénőlyanesvcéó ame E', '(4 SZÉPEN. ISS ROZÁMA', 'Ko mA S éneseNŐET —— MannyolgárságAtotinalty: HUN', 'Fe: ÉYTS sádsudásane 30 06 1979'].join('\n');
const MIXED_MODEL_LINE = 'SZEPENE KISS ROZALIA. 4'; // Hungarian + English model: right letters, no accents

describe('accents for the code-line name', () => {
  it('takes accents from the printed name and letters from the code lines', () => {
    expect(accentedFromReadings('SZEPENE KISS ROZALIA', [HUNGARIAN_ONLY_LINE], true)).toBe('SZÉPENÉ KISS ROZÁLIA');
    expect(accentedFromReadings('SZEPENE KISS ROZALIA', HUNGARIAN_ONLY_CARD.split('\n'), true)).toBe('SZÉPENÉ KISS ROZÁLIA');
  });

  it('combines readings: a reading without an accent does not remove one', () => {
    expect(accentedFromReadings('SZEPENE KISS ROZALIA', [MIXED_MODEL_LINE, ...LOW_RES_CARD.split('\n'), HUNGARIAN_ONLY_LINE], true)).toBe('SZÉPENÉ KISS ROZÁLIA');
    // The low-resolution reading alone misses the last É but never invents a letter.
    expect(accentedFromReadings('SZEPENE KISS ROZALIA', LOW_RES_CARD.split('\n'), true)).toBe('SZÉPENE KISS ROZÁLIA');
  });

  it('ignores lines that do not match the code-line name', () => {
    expect(accentedFromReadings('SZEPENE KISS ROZALIA', ['SZEMÉLYAZONOSÍTÓ IGAZOLVÁNY / IDENTITY CARD', 'MAGYARORSZÁG / HUNGARY'], true)).toBeNull();
    expect(accentedFromReadings('NAGY PETER', ['SZÉPENÉ KISS ROZÁLIA'], true)).toBeNull();
  });

  it('drops an accent the readings disagree on', () => {
    expect(accentedFromReadings('KOVACS EVA', ['KOVÁCS ÉVA', 'KOVÁCS ÉVA', 'KOVÄCS ÉVA'], false)).toBe('KOVACS ÉVA');
  });

  it('handles the German code-line spelling of Ü and keeps plain letters', () => {
    expect(accentedFromReadings('MUELLER', ['MÜLLER'])).toBe('MÜLLER');
    expect(accentedFromReadings('MULLER', ['MÜLLER'])).toBe('MÜLLER');
    expect(accentedFromReadings('SPECIMEN', ['SPECIMEN'])).toBe('SPECIMEN');
  });

  it('accepts only Hungarian accents on a Hungarian document', () => {
    expect(accentedFromReadings('KISS ANNA', ['KÌSS ANNA'], true)).toBe('KISS ANNA');
  });
});

describe('current names from the printed text', () => {
  it('fills the Hungarian card name with accents, split as in the code lines', () => {
    expect(restoreDocumentNames('SZEPENE KISS', 'ROZALIA', [HUNGARIAN_ONLY_CARD, MIXED_MODEL_LINE], true))
      .toEqual({ last_name: 'Szépené Kiss', first_name: 'Rozália' });
  });

  it('finds names printed on separate passport lines', () => {
    expect(restoreDocumentNames('TOTH', 'ERZSEBET', ['Surname/Nom', 'TÓTH', 'Given names/Prénoms', 'ERZSÉBET'], true))
      .toEqual({ last_name: 'Tóth', first_name: 'Erzsébet' });
  });

  it('returns nothing when no accent can be confirmed', () => {
    expect(restoreDocumentNames('SPECIMEN', 'A', ['SPECIMEN', 'A'], false)).toEqual({});
    expect(restoreDocumentNames('SZEPENE KISS', 'ROZALIA', [MIXED_MODEL_LINE], true)).toEqual({});
  });

  it('fixes a misplaced accent in a Hungarian given name using the official list', () => {
    expect(restoreDocumentNames('KISS', 'ROZALIA', ['KISS RÓZALIA'], true)).toEqual({ first_name: 'Rozália' });
  });
});

describe('the same name written twice', () => {
  it('gives the birth name the accents of the current name', () => {
    expect(harmonizeNameAccents({ first_name: 'Rozália', last_name: 'Szépené Kiss', birth_first_name: 'Rozalia', birth_last_name: 'Kiss', mother_name: 'Kalcsó Irma' }, true))
      .toEqual({ first_name: 'Rozália', last_name: 'Szépené Kiss', birth_first_name: 'Rozália', birth_last_name: 'Kiss', mother_name: 'Kalcsó Irma' });
  });

  it('never changes letters, only accents', () => {
    expect(harmonizeNameAccents({ first_name: 'Rozália', birth_first_name: 'Rozina' }, true)).toEqual({ first_name: 'Rozália', birth_first_name: 'Rozina' });
  });
});

describe('names are not borrowed from other people on the document', () => {
  it('does not take the guest given name from the birth-name or mother line', () => {
    expect(restoreDocumentNames('EXAMPLE', 'EVA', ['Születési név: Minta Éva', 'Anyja születési neve: Példa Éva'], true)).toEqual({});
  });
  it('accepts a labeled printed value', () => {
    expect(restoreDocumentNames('TOTH', 'EVA', ['Surname: TÓTH'], true, ['Tóth'])).toEqual({ last_name: 'Tóth' });
  });
});
