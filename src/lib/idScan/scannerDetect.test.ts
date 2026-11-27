import { describe, expect, it } from 'vitest';
import { BURST_GAP_MS, ReaderBurst, looksLikeDocumentScanner, pickCamera, pickScanner, type VideoDevice } from './scannerDetect';
import { parseScannerSettings, wedgeInputToMrzText } from './scannerDevices';
import { readMrz } from './mrz';

const facetime: VideoDevice = { deviceId: 'cam-1', label: 'FaceTime HD Camera' };
const back: VideoDevice = { deviceId: 'cam-2', label: 'Back Camera' };
const webcam: VideoDevice = { deviceId: 'cam-3', label: 'Logitech C920 HD Pro Webcam (046d:082d)' };
const ipevo: VideoDevice = { deviceId: 'scan-1', label: 'IPEVO V4K Document Camera (1778:0216)' };
const plustek: VideoDevice = { deviceId: 'scan-2', label: 'Plustek SecureScan X-Cube' };

describe('camera-type scanners', () => {
  it('tells scanners from built-in and ordinary cameras by name', () => {
    expect(looksLikeDocumentScanner(ipevo.label)).toBe(true);
    expect(looksLikeDocumentScanner(plustek.label)).toBe(true);
    expect(looksLikeDocumentScanner('USB Document Scanner')).toBe(true);
    expect(looksLikeDocumentScanner(facetime.label)).toBe(false);
    expect(looksLikeDocumentScanner(back.label)).toBe(false);
    expect(looksLikeDocumentScanner(webcam.label)).toBe(false);
    expect(looksLikeDocumentScanner('')).toBe(false);
  });

  it('finds a newly plugged-in scanner by itself', () => {
    expect(pickScanner([facetime, ipevo])).toEqual(ipevo);
    expect(pickScanner([facetime, webcam])).toBeNull();
    // Names are empty until camera access is allowed: nothing is guessed.
    expect(pickScanner([{ deviceId: '', label: '' }])).toBeNull();
  });

  it('keeps the remembered scanner, also after its id changed', () => {
    expect(pickScanner([facetime, ipevo, plustek], 'scan-2')).toEqual(plustek);
    expect(pickScanner([facetime, { ...webcam, deviceId: 'new-id' }], 'old-id', webcam.label)).toEqual({ ...webcam, deviceId: 'new-id' });
  });

  it('picks a real camera, not the scanner, for the Camera choice', () => {
    expect(pickCamera([ipevo, facetime], 'scan-1')).toEqual(facetime);
    expect(pickCamera([ipevo, facetime, back], 'scan-1')).toEqual(back);
    expect(pickCamera([ipevo], 'scan-1')).toBeNull();
  });

  it('remembers the scanner in the workstation settings', () => {
    const saved = parseScannerSettings(JSON.stringify({ preferred: 'scanner', scannerId: 'scan-1', scannerLabel: ipevo.label }));
    expect(saved).toMatchObject({ preferred: 'scanner', scannerId: 'scan-1', scannerLabel: ipevo.label });
    expect(parseScannerSettings(JSON.stringify({ preferred: 'scanner' })).preferred).toBe('camera');
    expect(parseScannerSettings(null)).toMatchObject({ preferred: 'camera', scannerId: '', scannerLabel: '' });
  });
});

describe('keyboard-output reader recognition', () => {
  const L1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
  const L2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';
  const type = (burst: ReaderBurst, text: string, gap: number, start = 1000) => {
    let at = start;
    for (const char of text) { burst.push(char === '\n' ? 'Enter' : char, at); at += gap; }
    return at;
  };

  it('recognises a reader typing a passport code zone', () => {
    const burst = new ReaderBurst();
    const end = type(burst, `${L1}\n${L2}\n`, 8);
    expect(burst.finished(end + 10)).toBeNull(); // still typing
    const text = burst.finished(end + BURST_GAP_MS * 4 + 10);
    expect(text).not.toBeNull();
    expect(readMrz(wedgeInputToMrzText(text!), new Date('2026-11-16'))?.fields.documentNumber).toBe('L898902C3');
  });

  it('never takes a person typing for a scan', () => {
    const burst = new ReaderBurst();
    const end = type(burst, `${L1}${L2}`, 150);
    expect(burst.finished(end + 1000)).toBeNull();
  });

  it('ignores a short fast burst such as a barcode', () => {
    const burst = new ReaderBurst();
    const end = type(burst, 'RES-20261127-0001\n', 5);
    expect(burst.finished(end + 1000)).toBeNull();
  });
});
