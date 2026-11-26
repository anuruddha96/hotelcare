/**
 * Second, tighter reading of the code lines (MRZ) and of the printed zone
 * next to them. Pure array maths: no canvas, no I/O, nothing stored.
 *
 * Why: a first OCR pass over a wide band misreads the first and last
 * characters of each line (card edge, dark background, tilt) and small
 * printed text. The first pass still finds WHERE the code lines are; this
 * module straightens that block, evens out the lighting, pads it with white
 * and hands it back for a clean second pass. The same geometry locates the
 * printed fields above the code lines.
 */
import { parse } from 'mrz';

export type Gray = { data: Uint8ClampedArray; width: number; height: number };
export type OcrLine = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  baseline?: { x0: number; y0: number; x1: number; y1: number } | null;
};
/** Code-line block in frame pixels. `angle` is the text slope in degrees
 * (positive: the lines run downwards to the right). */
export type CodeGeometry = {
  cx: number; cy: number; width: number; height: number;
  angle: number; lineHeight: number; lines: number; left: number; top: number;
};

const MRZ_ONLY = /[^A-Z0-9<]/g;
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };

/** Luminance of an RGBA buffer (canvas ImageData). */
export function toGray(rgba: ArrayLike<number>, width: number, height: number): Gray {
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    data[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  return { data, width, height };
}

/** Find the code lines among first-pass OCR lines. `scale` and the offsets
 * map the OCR image back to frame pixels. */
export function codeLineGeometry(lines: OcrLine[], scale = 1, offsetX = 0, offsetY = 0, expectedLines?: 2 | 3): CodeGeometry | null {
  const candidates = lines.filter(l => {
    const t = l.text.toUpperCase().replace(/\s/g, '').replace(/[«‹]/g, '<').replace(MRZ_ONLY, '');
    return t.length >= 22 && l.bbox.x1 > l.bbox.x0 && l.bbox.y1 > l.bbox.y0;
  });
  if (candidates.length < 2) return null;
  // The code zone is the last block of 2–3 similar-width lines.
  const last = candidates.slice(-(expectedLines ?? 3));
  const widest = Math.max(...last.map(l => l.bbox.x1 - l.bbox.x0));
  const block = last.filter(l => l.bbox.x1 - l.bbox.x0 >= widest * 0.7);
  if (block.length < 2) return null;
  const slopes = block.map(l => {
    const b = l.baseline;
    return b && b.x1 - b.x0 > 20 ? (b.y1 - b.y0) / (b.x1 - b.x0) : 0;
  });
  const slope = Math.max(-0.2, Math.min(0.2, median(slopes)));
  const x0 = Math.min(...block.map(l => l.bbox.x0)), x1 = Math.max(...block.map(l => l.bbox.x1));
  const y0 = Math.min(...block.map(l => l.bbox.y0)), y1 = Math.max(...block.map(l => l.bbox.y1));
  const width = (x1 - x0) / scale;
  const skew = Math.abs(slope) * width;
  const height = Math.max(8, (y1 - y0) / scale - skew);
  const lineHeight = Math.max(4, median(block.map(l => l.bbox.y1 - l.bbox.y0)) / scale - skew);
  const cx = (x0 + x1) / 2 / scale + offsetX, cy = (y0 + y1) / 2 / scale + offsetY;
  return {
    cx, cy, width, height, lineHeight, lines: block.length,
    angle: Math.atan(slope) * 180 / Math.PI, left: cx - width / 2, top: cy - height / 2,
  };
}

/** Bilinear sample of a straightened rectangle. (u0,v0,u1,v1) are offsets
 * from (cx,cy) along / across the text direction, in source pixels. */
export function sampleStraight(src: Gray, cx: number, cy: number, angle: number,
  u0: number, v0: number, u1: number, v1: number, outWidth: number): Gray {
  const sw = Math.max(1, u1 - u0), sh = Math.max(1, v1 - v0);
  const width = Math.max(8, Math.round(outWidth));
  const height = Math.max(8, Math.round(width * sh / sw));
  const out = new Uint8ClampedArray(width * height);
  const rad = angle * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const { data, width: W, height: H } = src;
  for (let y = 0; y < height; y++) {
    const v = v0 + (y + 0.5) * sh / height;
    for (let x = 0; x < width; x++) {
      const u = u0 + (x + 0.5) * sw / width;
      const sx = cx + u * cos - v * sin - 0.5, sy = cy + u * sin + v * cos - 0.5;
      if (sx < 0 || sy < 0 || sx > W - 1 || sy > H - 1) { out[y * width + x] = 128; continue; }
      const xi = Math.floor(sx), yi = Math.floor(sy);
      const xj = Math.min(W - 1, xi + 1), yj = Math.min(H - 1, yi + 1);
      const fx = sx - xi, fy = sy - yi;
      const top = data[yi * W + xi] * (1 - fx) + data[yi * W + xj] * fx;
      const bottom = data[yj * W + xi] * (1 - fx) + data[yj * W + xj] * fx;
      out[y * width + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return { data: out, width, height };
}

/** Separable box mean with edge clamping. */
export function boxBlur(src: Float32Array, width: number, height: number, kx: number, ky: number): Float32Array {
  const pass = (input: Float32Array, k: number, horizontal: boolean) => {
    if (k <= 1) return input;
    const r = k >> 1, out = new Float32Array(input.length);
    const n = horizontal ? width : height, m = horizontal ? height : width;
    const step = horizontal ? 1 : width;
    for (let j = 0; j < m; j++) {
      const base = horizontal ? j * width : j;
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += input[base + Math.max(0, Math.min(n - 1, i)) * step];
      for (let i = 0; i < n; i++) {
        out[base + i * step] = sum / (2 * r + 1);
        sum += input[base + Math.min(n - 1, i + r + 1) * step] - input[base + Math.max(0, i - r) * step];
      }
    }
    return out;
  };
  return pass(pass(src, kx, true), ky, false);
}

function percentile(values: ArrayLike<number>, q: number): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) hist[Math.max(0, Math.min(255, Math.round(values[i])))]++;
  let n = 0; const target = q * values.length;
  for (let i = 0; i < 256; i++) { n += hist[i]; if (n >= target) return i; }
  return 255;
}

/** Even out lighting along the code lines: each column is rescaled against
 * its own bright (card background) level, then contrast is stretched. */
export function normalizeCodeBlock(block: Gray, charWidth: number): Gray {
  const { data, width, height } = block;
  const bright = new Float32Array(width);
  const column = new Uint8ClampedArray(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) column[y] = data[y * width + x];
    bright[x] = percentile(column, 0.85);
  }
  const k = Math.max(5, Math.round(charWidth * 3)) | 1;
  const smooth = boxBlur(bright, width, 1, k, 1);
  const dark = percentile(data, 0.03);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i++) {
    const level = (data[i] - dark) / Math.max(20, smooth[i % width] - dark);
    out[i] = 255 * Math.max(0, Math.min(1, (level - 0.15) / 0.7));
  }
  return { data: out, width, height };
}

/** Even out lighting for small printed text (two-dimensional). */
export function normalizeText(zone: Gray): Gray {
  const { data, width, height } = zone;
  const k = Math.max(31, Math.round(width * 0.05)) | 1;
  const a = Float32Array.from(data);
  const mean = boxBlur(a, width, height, k, k);
  const lifted = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) lifted[i] = Math.max(a[i], mean[i]);
  const high = boxBlur(lifted, width, height, k, k);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < a.length; i++) {
    const level = Math.min(1.05, a[i] / Math.max(30, high[i]));
    out[i] = 255 * Math.max(0, Math.min(1, (level - 0.35) / 0.6));
  }
  return { data: out, width, height };
}

/** OCR page segmentation is steadier with a clean white margin. */
export function padWhite(image: Gray, pad: number): Gray {
  const width = image.width + 2 * pad, height = image.height + 2 * pad;
  const data = new Uint8ClampedArray(width * height).fill(255);
  for (let y = 0; y < image.height; y++) {
    data.set(image.data.subarray(y * image.width, (y + 1) * image.width), (y + pad) * width + pad);
  }
  return { data, width, height };
}

/** The straightened, evenly lit code-line block, ready for a second OCR pass. */
export function refineCodeBlock(frame: Gray, geometry: CodeGeometry, outWidth = 1100): Gray {
  const chars = geometry.lines >= 3 ? 30 : 44;
  const charWidth = geometry.width / chars;
  const halfW = geometry.width / 2 + charWidth * 0.35;
  const halfH = geometry.height / 2 + geometry.lineHeight * 0.25;
  const block = sampleStraight(frame, geometry.cx, geometry.cy, geometry.angle, -halfW, -halfH, halfW, halfH, outWidth);
  return padWhite(normalizeCodeBlock(block, outWidth / (chars + 0.7)), 40);
}

/** Printed zone beside the code lines.
 * ID card back (3 code lines): the labelled rows in the upper left part.
 * Passport page (2 code lines): the whole data page above the code lines. */
export function printedZone(frame: Gray, geometry: CodeGeometry, outWidth = 1500): Gray {
  const idCard = geometry.lines >= 3;
  // Code lines span about 89.5% of an ID-1 card and 95% of a passport page.
  const docWidth = geometry.width / (idCard ? 0.895 : 0.95);
  const zoneHeight = idCard ? docWidth * 0.63 * 0.66 : docWidth * 0.704 * 0.74;
  const u0 = -geometry.width / 2 - docWidth * 0.02;
  const u1 = idCard ? u0 + docWidth * 0.68 : geometry.width / 2 + docWidth * 0.02;
  const v1 = -geometry.height / 2 - geometry.height * 0.10;
  const zone = sampleStraight(frame, geometry.cx, geometry.cy, geometry.angle, u0, v1 - zoneHeight, u1, v1, outWidth);
  return padWhite(normalizeText(zone), 30);
}

// ---------------------------------------------------------------------------
// Check-digit guided repair of look-alike characters

const weight = [7, 3, 1];
const charValue = (c: string) => c === '<' ? 0 : c >= '0' && c <= '9' ? c.charCodeAt(0) - 48 : c.charCodeAt(0) - 55;
export function checkDigit(text: string): string {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum += charValue(text[i]) * weight[i % 3];
  return String(sum % 10);
}

/** Characters OCR confuses with each other on documents. Only these swaps
 * are ever tried, and only one per field. */
const LOOK_ALIKE: Record<string, string> = {
  O: '0', Q: '0', D: '0', G: '06', I: '1', L: '1', Z: '27', S: '5', B: '8', T: '7', A: '4',
  '0': 'OQDG', '1': 'IL', '2': 'Z7', '5': 'S9', '8': 'B3', '7': 'Z2T1', '6': 'G', '9': '5', '3': '8', '4': 'A',
};

type Field = { line: number; start: number; end: number; check: number; digitsOnly?: boolean };
const FIELDS: Record<'TD1' | 'TD2' | 'TD3', Field[]> = {
  TD1: [
    { line: 0, start: 5, end: 14, check: 14 },
    { line: 1, start: 0, end: 6, check: 6, digitsOnly: true },
    { line: 1, start: 8, end: 14, check: 14, digitsOnly: true },
  ],
  TD2: [
    { line: 1, start: 0, end: 9, check: 9 },
    { line: 1, start: 13, end: 19, check: 19, digitsOnly: true },
    { line: 1, start: 21, end: 27, check: 27, digitsOnly: true },
  ],
  TD3: [
    { line: 1, start: 0, end: 9, check: 9 },
    { line: 1, start: 13, end: 19, check: 19, digitsOnly: true },
    { line: 1, start: 21, end: 27, check: 27, digitsOnly: true },
  ],
};

function allValid(lines: string[]): boolean {
  try { return parse(lines, { autocorrect: false }).details.filter(d => !d.valid).every(d => /state code/i.test(String(d.error ?? ''))); }
  catch { return false; }
}

/**
 * When a field fails its check digit, try swapping ONE look-alike character
 * in that field (or its check digit). The repair is used only if exactly one
 * plausible swap makes the field's own check digit correct and, with all repairs
 * applied, every check digit on the document passes, the overall one
 * included. Names carry no check digit and are never touched.
 */
export function repairLookAlikes(lines: string[], format: 'TD1' | 'TD2' | 'TD3'): string[] | null {
  if (allValid(lines)) return lines;
  // Per field: the reading as it is (when its own check digit passes) or
  // every single look-alike swap that makes its check digit pass.
  const choices: Array<{ field: Field; values: string[] }> = [];
  for (const field of FIELDS[format]) {
    const row = lines[field.line];
    if (!row || row.length <= field.check) return null;
    const whole = row.slice(field.start, field.end) + row[field.check];
    const passes = (v: string) => /^\d$/.test(v.slice(-1)) && checkDigit(v.slice(0, -1)) === v.slice(-1)
      && (!field.digitsOnly || /^\d+$/.test(v.slice(0, -1)));
    if (passes(whole)) { choices.push({ field, values: [whole] }); continue; }
    const options = new Set<string>();
    for (let i = 0; i < whole.length; i++) {
      for (const swap of LOOK_ALIKE[whole[i]] ?? '') {
        const next = whole.slice(0, i) + swap + whole.slice(i + 1);
        if (passes(next)) options.add(next);
      }
    }
    if (!options.size) return null;
    // Document numbers are blocks of digits and letters: of several passing
    // swaps, keep those with the fewest changes between digits and letters.
    const runs = (v: string) => v.slice(0, -1).replace(/<+$/, '').replace(/\d+/g, '9').replace(/[A-Z]+/g, 'A').length;
    const fewest = Math.min(...[...options].map(runs));
    choices.push({ field, values: [...options].filter(v => runs(v) === fewest) });
  }
  // The overall check digit must then single out one combination.
  const valid: string[][] = [];
  const walk = (index: number, current: string[]) => {
    if (valid.length > 1) return;
    if (index === choices.length) { if (allValid(current)) valid.push(current); return; }
    const { field, values } = choices[index];
    for (const value of values) {
      const next = [...current];
      const row = next[field.line];
      next[field.line] = row.slice(0, field.start) + value.slice(0, -1) + row.slice(field.end, field.check) + value.slice(-1) + row.slice(field.check + 1);
      walk(index + 1, next);
    }
  };
  walk(0, [...lines]);
  return valid.length === 1 ? valid[0] : null;
}
