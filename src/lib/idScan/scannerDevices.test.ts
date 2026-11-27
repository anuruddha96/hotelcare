import { describe, expect, it, vi } from 'vitest';
import {
  fetchBridgeScan, isLoopbackUrl, parseBridgeResponse, parseScannerSettings, wedgeInputLooksComplete, wedgeInputToMrzText,
} from './scannerDevices';
import { readMrz } from './mrz';

// ICAO 9303 specimen passport.
const L1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
const L2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';

describe('keyboard-output readers', () => {
  it('accepts lines separated by Enter, Tab or control bytes', () => {
    expect(wedgeInputToMrzText(`${L1}\r\n${L2}\r\n`)).toBe(`${L1}\n${L2}`);
    expect(wedgeInputToMrzText(`${L1}\t${L2}`)).toBe(`${L1}\n${L2}`);
    expect(wedgeInputToMrzText(`\u0002${L1}\u001e${L2}\u0003`)).toBe(`${L1}\n${L2}`);
  });

  it('splits one unbroken run into the code lines', () => {
    expect(wedgeInputToMrzText(L1 + L2)).toBe(`${L1}\n${L2}`);
    expect(wedgeInputToMrzText('A'.repeat(90)).split('\n').map((l) => l.length)).toEqual([30, 30, 30]);
  });

  it('produces text the MRZ reader understands', () => {
    const typed = (L1 + L2).toLowerCase();
    expect(wedgeInputLooksComplete(typed.slice(0, 40))).toBe(false);
    expect(wedgeInputLooksComplete(typed)).toBe(true);
    const result = readMrz(wedgeInputToMrzText(typed), new Date('2026-11-16'));
    expect(result?.fields).toMatchObject({ lastName: 'Eriksson', firstName: 'Anna Maria', documentNumber: 'L898902C3', dateOfBirth: '1974-08-12' });
  });
});

describe('local reader service', () => {
  it('only ever talks to this computer', () => {
    expect(isLoopbackUrl('http://localhost:8080/document')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.1:9000/granus')).toBe(true);
    expect(isLoopbackUrl('https://reader.localhost/scan')).toBe(true);
    expect(isLoopbackUrl('http://192.168.1.20:8080/document')).toBe(false);
    expect(isLoopbackUrl('http://localhost.evil.example/scan')).toBe(false);
    expect(isLoopbackUrl('http://user:pw@localhost/scan')).toBe(false);
    expect(isLoopbackUrl('file:///etc/passwd')).toBe(false);
    expect(isLoopbackUrl('')).toBe(false);
  });

  it('reads code lines from the usual JSON shapes', () => {
    expect(parseBridgeResponse('application/json', JSON.stringify({ mrz: `${L1}\n${L2}` }))).toEqual({ kind: 'mrz', text: `${L1}\n${L2}` });
    expect(parseBridgeResponse('application/json', JSON.stringify({ result: { MRZ: [L1, L2] } }))).toEqual({ kind: 'mrz', text: `${L1}\n${L2}` });
    expect(parseBridgeResponse('text/plain', `${L1}\r\n${L2}`)).toEqual({ kind: 'mrz', text: `${L1}\n${L2}` });
  });

  it('falls back to the scanned picture, and reports an empty glass', () => {
    const b64 = 'A'.repeat(400);
    expect(parseBridgeResponse('application/json', JSON.stringify({ image: b64 }))).toEqual({ kind: 'image', dataUrl: `data:image/jpeg;base64,${b64}` });
    expect(parseBridgeResponse('application/json', '{"status":"no document"}')).toEqual({ kind: 'none', reason: 'no_document' });
    expect(parseBridgeResponse('application/json', '{oops')).toEqual({ kind: 'none', reason: 'invalid_json' });
    expect(parseBridgeResponse(null, '')).toEqual({ kind: 'none', reason: 'empty' });
  });

  it('never calls a remote address', async () => {
    const fetchImpl = vi.fn();
    expect(await fetchBridgeScan('http://10.0.0.5/scan', fetchImpl as unknown as typeof fetch)).toEqual({ kind: 'none', reason: 'not_local' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports an unreachable service instead of throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('refused'));
    expect(await fetchBridgeScan('http://localhost:8080/document', fetchImpl as unknown as typeof fetch)).toEqual({ kind: 'none', reason: 'unreachable' });
  });
});

describe('scanner settings', () => {
  it('drops a non-local service URL and unknown sources', () => {
    expect(parseScannerSettings('{"preferred":"bridge","bridgeUrl":"http://evil.example/x"}')).toEqual({ preferred: 'camera', bridgeUrl: '', scannerId: '', scannerLabel: '' });
    expect(parseScannerSettings('{"preferred":"wedge","bridgeUrl":"http://localhost:8080/document"}')).toEqual({ preferred: 'wedge', bridgeUrl: 'http://localhost:8080/document', scannerId: '', scannerLabel: '' });
    expect(parseScannerSettings('nope')).toEqual({ preferred: 'camera', bridgeUrl: '', scannerId: '', scannerLabel: '' });
  });
});
