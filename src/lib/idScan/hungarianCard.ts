import type { OpticalGuestFields } from './opticalGuestFields';
import type { SourceRect } from './frameCapture';

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
export function rowHasLabel(row: PrintedRow, text: string): boolean {
  const s=fold(text);
  if (row==='birth_place') return /place\s*of\s*birth|szuletesi\s*hely|szoletesi\s*he/.test(s);
  if (row==='birth_pair') return /given\s*name\s*at\s*birth|szuletesi\s*csalad|szulelesi\s*salad/.test(s);
  return /mother.?s\s*(?:maiden|birth)\s*name|anyja\s*sz[uü]\s*(?:letesi|etesi)\s*nev|aryja\s*sz[uü]\s*etesi\s*nev/.test(s);
}
export function parsePrintedRow(row: PrintedRow, text: string): OpticalGuestFields {
  const clean=text.trim().replace(/[|.,;:]+$/,'').trim();
  const value=row==='birth_place'?clean.replace(/\s*\([A-Z]{2,3}\)\s*$/i,'').trim():clean;
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’\-]{1,79}$/u.test(value)) return {};
  const words=value.split(/\s+/);
  if (row==='birth_pair' && words.length!==2) return {};
  if (row==='mother_name' && words.length<2) return {};
  const title=(s:string)=>s.toLowerCase().replace(/(^|[\s\-’'])\p{L}/gu,c=>c.toUpperCase());
  if(row==='birth_pair') return {birth_last_name:title(words[0]),birth_first_name:title(words[1])};
  return {[row]:title(value)};
}

/** Require an independently read Hungarian identity and two matching labels
 * in their expected rows; each proposed field must have its own label. */
export function mergeHungarianRows(confirmedHungarian: boolean, rows: Array<{row:PrintedRow; label:string; value:string; confidence:number|null}>): OpticalGuestFields {
  if (!confirmedHungarian || new Set(rows.filter(r=>rowHasLabel(r.row,r.label)).map(r=>r.row)).size<2) return {};
  const out: OpticalGuestFields={};
  for(const r of rows) if(rowHasLabel(r.row,r.label) && r.confidence!==null && r.confidence>=65) Object.assign(out,parsePrintedRow(r.row,r.value));
  return out;
}
