/**
 * Document-reader hardware at the front desk (passport / ID scanners attached
 * to the reception computer), next to the built-in camera scan.
 *
 * A web page cannot talk to a USB reader directly, so readers reach the
 * browser in one of two ways, both handled here without any vendor lock-in:
 *
 *  1. Keyboard output ("keyboard wedge"). Most MRZ readers (ARH/Adaptive
 *     Recognition, Access-IS, Desko, 3M/Gemalto…) can type the code lines of
 *     the document as if on a keyboard. HotelCare listens in a capture field.
 *  2. A small service on the same computer (the vendor's own, or a bridge)
 *     that answers on http://localhost:<port>/… with the code lines or the
 *     scanned picture — the model Plustek and Granus readers use.
 *
 * Everything stays on the workstation: nothing here uploads or stores a scan.
 * Pure functions; the dialog does the I/O.
 */

export type ScannerSource = 'camera' | 'wedge' | 'bridge';

export interface ScannerSettings {
  /** What the scan dialog opens with on this workstation. */
  preferred: ScannerSource;
  /** Loopback URL of the local reader service, e.g. http://localhost:8080/document */
  bridgeUrl: string;
}

export const DEFAULT_SCANNER_SETTINGS: ScannerSettings = { preferred: 'camera', bridgeUrl: '' };
const STORAGE_KEY = 'hotelcare.reception.idScanner.v1';

export function parseScannerSettings(raw: string | null | undefined): ScannerSettings {
  try {
    const parsed = JSON.parse(raw ?? '') as Partial<ScannerSettings>;
    const preferred = (['camera', 'wedge', 'bridge'] as const).includes(parsed.preferred as ScannerSource)
      ? (parsed.preferred as ScannerSource) : 'camera';
    const bridgeUrl = typeof parsed.bridgeUrl === 'string' && isLoopbackUrl(parsed.bridgeUrl) ? parsed.bridgeUrl.trim() : '';
    return { preferred: preferred === 'bridge' && !bridgeUrl ? 'camera' : preferred, bridgeUrl };
  } catch {
    return { ...DEFAULT_SCANNER_SETTINGS };
  }
}

export function loadScannerSettings(): ScannerSettings {
  try { return parseScannerSettings(globalThis.localStorage?.getItem(STORAGE_KEY)); } catch { return { ...DEFAULT_SCANNER_SETTINGS }; }
}

export function saveScannerSettings(settings: ScannerSettings): void {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* storage blocked: lasts for this visit */ }
}

/**
 * Only a service on this very computer may be asked for a scan. A reader URL
 * pointing anywhere else is refused, so guest documents can never be pulled
 * from, or leaked to, another machine by a mistyped or malicious setting.
 */
export function isLoopbackUrl(raw: string | null | undefined): boolean {
  try {
    const url = new URL(String(raw ?? '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

const MRZ_LINE_LENGTHS: ReadonlyArray<readonly [number, number]> = [[88, 44], [90, 30], [72, 36]];

/**
 * Turn what a reader typed into OCR-like text lines for readMrz().
 * Readers separate the code lines with Enter, Tab or nothing at all (one long
 * run of 88 / 90 / 72 characters), and some wrap the data in start/stop bytes.
 */
export function wedgeInputToMrzText(raw: string): string {
  const cleaned = String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0002\u0003\u001c-\u001f]/g, '\n')
    .replace(/\t/g, '\n')
    .toUpperCase();
  const lines = cleaned.split(/[\r\n]+/).map((line) => line.replace(/\s+/g, '')).filter(Boolean);
  if (lines.length === 1) {
    const only = lines[0];
    for (const [total, per] of MRZ_LINE_LENGTHS) {
      if (only.length === total) {
        const parts: string[] = [];
        for (let i = 0; i < total; i += per) parts.push(only.slice(i, i + per));
        return parts.join('\n');
      }
    }
  }
  return lines.join('\n');
}

/** True once the typed text is long enough to be a complete code zone (so parsing is worth trying). */
export function wedgeInputLooksComplete(raw: string): boolean {
  const compact = wedgeInputToMrzText(raw).replace(/\n/g, '');
  return compact.length >= 72 && compact.includes('<');
}

export type BridgeScan =
  | { kind: 'mrz'; text: string }
  | { kind: 'image'; dataUrl: string }
  | { kind: 'none'; reason: string };

const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|bmp|webp|tiff?);base64,[A-Za-z0-9+/=\s]+$/i;
const BASE64 = /^[A-Za-z0-9+/=\s]{200,}$/;

function findField(value: unknown, names: readonly string[], depth = 0): unknown {
  if (!value || typeof value !== 'object' || depth > 4) return undefined;
  const record = value as Record<string, unknown>;
  for (const [key, inner] of Object.entries(record)) {
    if (names.includes(key.toLowerCase()) && inner != null && inner !== '') return inner;
  }
  for (const inner of Object.values(record)) {
    const found = findField(inner, names, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Understand the answer of a local reader service. Vendors differ, so common
 * shapes are accepted: code lines as text or as an array (mrz / MRZ / lines /
 * mrzText …), or the scanned picture as a data URL / base64 (image / photo …).
 * Code lines win over a picture: they need no OCR.
 */
export function parseBridgeResponse(contentType: string | null | undefined, body: string): BridgeScan {
  const type = String(contentType ?? '').toLowerCase();
  const text = String(body ?? '').trim();
  if (!text) return { kind: 'none', reason: 'empty' };
  if (type.includes('json') || /^[{[]/.test(text)) {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return { kind: 'none', reason: 'invalid_json' }; }
    const mrz = findField(parsed, ['mrz', 'mrztext', 'mrz_text', 'mrzlines', 'mrz_lines', 'lines', 'machinereadablezone']);
    const mrzText = Array.isArray(mrz) ? mrz.map(String).join('\n') : typeof mrz === 'string' ? mrz : '';
    if (mrzText.replace(/\s/g, '').length >= 60) return { kind: 'mrz', text: wedgeInputToMrzText(mrzText) };
    const image = findField(parsed, ['image', 'imagedata', 'image_base64', 'photo', 'picture', 'document', 'scan', 'visible', 'white']);
    if (typeof image === 'string') {
      if (IMAGE_DATA_URL.test(image)) return { kind: 'image', dataUrl: image };
      if (BASE64.test(image)) return { kind: 'image', dataUrl: `data:image/jpeg;base64,${image.replace(/\s/g, '')}` };
    }
    return { kind: 'none', reason: 'no_document' };
  }
  if (IMAGE_DATA_URL.test(text)) return { kind: 'image', dataUrl: text };
  if (text.includes('<') && text.replace(/\s/g, '').length >= 60) return { kind: 'mrz', text: wedgeInputToMrzText(text) };
  return { kind: 'none', reason: 'unrecognised' };
}

/** Ask the local reader service for the document on the glass. Loopback only; 20 s limit. */
export async function fetchBridgeScan(bridgeUrl: string, fetchImpl: typeof fetch = fetch): Promise<BridgeScan> {
  if (!isLoopbackUrl(bridgeUrl)) return { kind: 'none', reason: 'not_local' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchImpl(bridgeUrl.trim(), {
      method: 'GET', signal: controller.signal, cache: 'no-store', credentials: 'omit',
      headers: { Accept: 'application/json, image/*;q=0.9, text/plain;q=0.8' },
    });
    if (!response.ok) return { kind: 'none', reason: `http_${response.status}` };
    const type = response.headers.get('content-type');
    if (type && type.toLowerCase().startsWith('image/')) {
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      return { kind: 'image', dataUrl };
    }
    return parseBridgeResponse(type, await response.text());
  } catch {
    return { kind: 'none', reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
