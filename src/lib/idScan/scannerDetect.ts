/**
 * Automatic scanner detection at the front desk.
 *
 * A web page sees two kinds of USB document scanner without any driver or
 * setting on HotelCare's side:
 *
 *  1. Scanners that connect as a camera (document cameras, visualisers and
 *     most passport / ID scanners with an image sensor). The browser lists them
 *     as video inputs; HotelCare recognises them by name, opens them instead of
 *     the built-in camera and reads them with the same OCR as the camera scan.
 *  2. Readers that type the code lines like a keyboard. They are recognised by
 *     their typing speed: a person cannot type 60+ characters with '<' signs in
 *     well under a second.
 *
 * The choice is remembered per workstation (see scannerDevices settings), so a
 * scanner is set up once, automatically, the first time it is plugged in.
 * Nothing here touches guest data; only device names and ids are kept.
 */
import { wedgeInputLooksComplete } from './scannerDevices';

export interface VideoDevice {
  deviceId: string;
  label: string;
}

/** Names used by document cameras, visualisers and passport / ID scanners. */
const SCANNER_NAME = /\b(scan|scanner|document|doc[\s-]?cam|visuali[sz]er|presenter|overhead|id[\s-]?reader|passport|mrz|ipevo|czur|plustek|avision|fujitsu|ricoh|kodak|ambir|elmo|aver|hovercam|thustar|okiolabs|joyusing|inswan|desko|access[\s-]?is|regula|adaptive recognition|\barh\b|combosmart|osmond|gemalto|thales|3m|ocr)/i;

/** Names of cameras built into phones, tablets and laptops. */
const BUILT_IN_NAME = /(facetime|front|back|rear|truedepth|ultra wide|telephoto|integrated|built-?in|internal|user facing|environment facing|camera2 \d|iphone|ipad|desk view)/i;

export function looksLikeBuiltInCamera(label: string | null | undefined): boolean {
  return BUILT_IN_NAME.test(String(label ?? ''));
}

export function looksLikeDocumentScanner(label: string | null | undefined): boolean {
  const name = String(label ?? '').trim();
  if (!name) return false;
  if (BUILT_IN_NAME.test(name)) return false;
  return SCANNER_NAME.test(name);
}

/**
 * The scanner to use: the remembered one while it is still connected,
 * otherwise the first connected device whose name says it is a scanner.
 * A device the receptionist marked as scanner once is found again by its id
 * or, after a browser update changed the id, by its name.
 */
export function pickScanner(devices: readonly VideoDevice[], savedId = '', savedLabel = ''): VideoDevice | null {
  const usable = devices.filter((device) => device.deviceId);
  if (savedId) {
    const byId = usable.find((device) => device.deviceId === savedId);
    if (byId) return byId;
  }
  if (savedLabel) {
    const byLabel = usable.find((device) => device.label === savedLabel);
    if (byLabel) return byLabel;
  }
  return usable.find((device) => looksLikeDocumentScanner(device.label)) ?? null;
}

/** The camera for the "Camera" choice: any connected camera that is not the scanner. */
export function pickCamera(devices: readonly VideoDevice[], scannerId = '', savedId = ''): VideoDevice | null {
  const cameras = devices.filter((device) => device.deviceId && device.deviceId !== scannerId && !looksLikeDocumentScanner(device.label));
  return cameras.find((device) => device.deviceId === savedId)
    ?? cameras.find((device) => /back|rear|environment/i.test(device.label))
    ?? cameras[0]
    ?? null;
}

/** Connected cameras and camera-type scanners. Names are empty until camera access was allowed once. */
export async function listVideoInputs(): Promise<VideoDevice[]> {
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices?.();
    return (devices ?? [])
      .filter((device) => device.kind === 'videoinput')
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
  } catch {
    return [];
  }
}

/** Calls back whenever a camera or scanner is plugged in or out. Returns the unsubscribe function. */
export function onDevicesChanged(callback: () => void): () => void {
  const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!media?.addEventListener) return () => undefined;
  media.addEventListener('devicechange', callback);
  return () => media.removeEventListener('devicechange', callback);
}

/** Longest pause between two keys of one reader burst. Readers type a key every 1–30 ms. */
export const BURST_GAP_MS = 60;

/**
 * Recognises a keyboard-output reader by how it types. Feed every key press
 * (with its time); finished() then gives the typed code lines when a complete
 * code zone arrived in one fast burst. A slower key starts again,
 * so normal typing by a person is never taken for a scan.
 * Call finished() a moment after the last key.
 */
export class ReaderBurst {
  private text = '';
  private last = -Infinity;

  push(key: string, at: number): void {
    const char = key === 'Enter' || key === 'Tab' ? '\n' : key.length === 1 ? key : '';
    if (!char) return;
    if (at - this.last > BURST_GAP_MS) this.text = '';
    this.last = at;
    this.text += char;
    if (this.text.length > 400) this.text = this.text.slice(-400);
  }

  /**
   * Once the burst has ended (a quarter second without keys), the typed code
   * lines if they make a complete code zone; otherwise null. Waiting for the
   * end matters: a 3-line ID card zone is complete before a passport's 88th character.
   */
  finished(at: number): string | null {
    if (at - this.last < BURST_GAP_MS * 4) return null;
    const value = this.text;
    this.text = '';
    this.last = -Infinity;
    return wedgeInputLooksComplete(value) ? value : null;
  }

}
