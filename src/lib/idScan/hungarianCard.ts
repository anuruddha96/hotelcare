import type { OpticalGuestFields } from './opticalGuestFields';
import type { SourceRect } from './frameCapture';
import { splitPrintedBirthName, stripBirthCountry, titlePrinted } from './printedLabels';

export type PrintedRow = 'birth_place' | 'birth_pair' | 'mother_name';
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const HUNGARIAN_BACK_ROWS: readonly PrintedRow[] = ['birth_place', 'birth_pair', 'mother_name'];

// The older Hungarian TD1 layout in the VIZA specimen. Use only on a
// confirmed layout, never treat a position on an unknown card as identity.
const bands: Record<PrintedRow, [number, number, number, number]> = {
  birth_place: [0.01, 0.135, 0.06, 0.13],
  birth_pair: [0.17, 0.285, 0.22, 0.28],
  mother_name: [0.325, 0.45, 0.38, 0.445],
};
export function printedRowRect(card: SourceRect, field: PrintedRow, valueOnly: boolean): SourceRect {
  const [top, bottom, vTop, vBottom] = bands[field];
  const a = valueOnly ? vTop : top, b = valueOnly ? vBottom : bottom;
  return {x: card.x + card.width * 0.035, y: card.y + card.height * a,
    width: card.width * 0.635, height: card.height * (b-a)};
}

// Detect a bright rectangular card on a dark background in the guide sample.
// If the edges are ambiguous, retain the guide rectangle; text anchors below
// must still verify the layout before a position-derived result can be used.
export function estimateCardRect(gray: Uint8Array, width: number, height: number): SourceRect {
  const full = {x:0,y:0,width,height};
  if (gray.length !== width * height || width < 40 || height < 30) return full;
  const xs = new Array<number>(width).fill(0), ys = new Array<number>(height).fill(0);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    if (gray[y*width+x] >= 115) { xs[x]++; ys[y]++; }
  }
  const range = (p: number[], limit: number) => {
    const good = p.map((v,i)=>v>=limit?i:-1).filter(i=>i>=0);
    return good.length ? [good[0], good[good.length-1]+1] : null;
  };
  const xr=range(xs,height*.48), yr=range(ys,width*.48);
  if (!xr || !yr) return full;
  const w=xr[1]-xr[0], h=yr[1]-yr[0], ratio=w/h;
  if (w<width*.65 || h<height*.65 || ratio<1.42 || ratio>1.78) return full;
  return {x:xr[0], y:yr[0], width:w,height:h};
}
/** A located OCR result can be partial (including an empty object). */
export function needsHungarianPrintedFallback(confirmedHungarian: boolean, fields: OpticalGuestFields): boolean {
  return confirmedHungarian && !(fields.birth_place && fields.birth_last_name && fields.birth_first_name && fields.mother_name?.trim().split(/\s+/).length === 2);
}

export function rowHasLabel(row: PrintedRow, text: string): boolean {
  const s=fold(text);
  if (row==='birth_place') return /place\s*of\s*birth|szuletesi\s*hely|szoletesi\s*he/.test(s);
  if (row==='birth_pair') return /given\s*name\s*at\s*birth|szuletesi\s*csalad|szulelesi\s*salad/.test(s);
  return /mother\s*['’]?\s*s\s*(?:maiden|birth)\s*name|anyja\s*sz[uü]\s*(?:letesi|etesi)\s*nev|aryja\s*sz[uü]\s*etesi\s*nev/.test(s);
}
export function parsePrintedRow(row: PrintedRow, text: string): OpticalGuestFields {
  const clean=text.trim().replace(/[|.,;:]+$/,'').trim();
  const value=row==='birth_place'?stripBirthCountry(clean):clean;
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’\-]{1,79}$/u.test(value)) return {};
  if(row==='birth_pair') return splitPrintedBirthName(value,undefined,true) ?? {};
  return {[row]:titlePrinted(value)};
}

/** Require an independently read Hungarian identity and two matching labels
 * in their expected rows; each proposed field must have its own label. */
export type HungarianRowRead = {row:PrintedRow; label:string; value:string; confidence:number|null};

export function mergeHungarianRows(confirmedHungarian: boolean, rows: HungarianRowRead[]): OpticalGuestFields {
  if (!confirmedHungarian || new Set(rows.filter(r=>rowHasLabel(r.row,r.label)).map(r=>r.row)).size<2) return {};
  const out: OpticalGuestFields={};
  for (const row of HUNGARIAN_BACK_ROWS) {
    const candidates = rows.filter(r => r.row === row && rowHasLabel(row,r.label) && r.confidence !== null && r.confidence >= 65)
      .map(r => parsePrintedRow(row,r.value)).filter(v => Object.keys(v).length > 0);
    if (candidates.length && candidates.every(v => fold(JSON.stringify(v)) === fold(JSON.stringify(candidates[0])))) {
      const accents = (v: OpticalGuestFields) => (JSON.stringify(v).normalize('NFD').match(/[\u0300-\u036f]/g) ?? []).length;
      Object.assign(out, candidates.reduce((best,v) => accents(v) > accents(best) ? v : best));
    }
  }
  return out;
}

/** A spacing correction must be independently corroborated by two targeted
 * reads of the labeled mother's row, not inferred from the number of words. */
export function corroboratedMotherName(rows: HungarianRowRead[]): string | undefined {
  const candidates = rows.filter(r => r.row === 'mother_name' && rowHasLabel(r.row,r.label) && r.confidence !== null && r.confidence >= 65)
    .map(r => parsePrintedRow('mother_name',r.value).mother_name).filter((v): v is string => !!v);
  if (candidates.length < 2 || !candidates.every(v => fold(v) === fold(candidates[0]))) return undefined;
  return candidates.reduce((best,v) => v.normalize('NFD').length > best.normalize('NFD').length ? v : best);
}

/** Preserve located evidence, fill a missing birth-name pair atomically,
 * and repair OCR word segmentation only when the letters agree. Truly
 * ambiguous compound names remain for physical-document review. */
export function mergeHungarianFallback(
  located: OpticalGuestFields, fallback: OpticalGuestFields, confirmedMother?: string,
): OpticalGuestFields {
  const out = { ...located };
  if (!out.birth_place && fallback.birth_place) out.birth_place = fallback.birth_place;
  if (!out.birth_last_name && !out.birth_first_name && fallback.birth_last_name && fallback.birth_first_name) {
    out.birth_last_name = fallback.birth_last_name;
    out.birth_first_name = fallback.birth_first_name;
  }
  if (!out.mother_name && fallback.mother_name) out.mother_name = fallback.mother_name;
  const compact = (v: string) => fold(v).replace(/\s+/g,'');
  if (out.mother_name && confirmedMother && compact(out.mother_name) === compact(confirmedMother)) {
    out.mother_name = confirmedMother;
  }
  return out;
}
