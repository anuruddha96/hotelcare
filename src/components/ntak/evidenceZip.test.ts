import { describe, expect, it } from 'vitest';
import { crc32, evidenceZip, safeEvidenceName } from './evidenceZip';

describe('NTAK evidence ZIP', () => {
  it('preserves the original UTF-8 XML and creates a valid STORE central directory', async () => {
    const xml = '<?xml version="1.0"?>\n<xml>Árvíztűrő tükörfúrógép</xml>';
    const files = [{ name: 'ELO_FOGL_04_request.xml', text: xml }, { name: 'AD_01_verify_response.xml', text: '<result/>' }];
    const blob = evidenceZip(files);
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(bytes.buffer);
    const decoder = new TextDecoder();
    let pos = 0;
    for (const file of files) {
      expect(dv.getUint32(pos, true)).toBe(0x04034b50);
      const length = dv.getUint32(pos + 18, true), nameLength = dv.getUint16(pos + 26, true);
      expect(decoder.decode(bytes.slice(pos + 30, pos + 30 + nameLength))).toBe(file.name);
      const payload = bytes.slice(pos + 30 + nameLength, pos + 30 + nameLength + length);
      expect(decoder.decode(payload)).toBe(file.text);
      expect(dv.getUint32(pos + 14, true)).toBe(crc32(payload));
      pos += 30 + nameLength + length;
    }
    expect(dv.getUint32(pos, true)).toBe(0x02014b50);
    expect(dv.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    expect(dv.getUint16(bytes.length - 12, true)).toBe(2);
    expect(dv.getUint32(bytes.length - 6, true)).toBe(pos);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('rejects traversal and duplicate filenames', () => {
    expect(safeEvidenceName('../FOGL 04')).toBe('___FOGL_04');
    expect(() => evidenceZip([{ name: '../x.xml', text: 'x' }])).toThrow();
    expect(() => evidenceZip([{ name: 'same.xml', text: 'a' }, { name: 'same.xml', text: 'b' }])).toThrow();
  });
});
