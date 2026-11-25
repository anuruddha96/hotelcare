// Small dependency-free ZIP (STORE, UTF-8) for exact evidence text. No XML
// reformatting or compression transforms; paths are restricted to flat names.
export interface EvidenceFile { name: string; text: string }

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function safeEvidenceName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'message';
}
export function evidenceZip(files: EvidenceFile[]): Blob {
  if (files.length > 65535) throw new Error('Too many files; choose a shorter date range.');
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0, centralSize = 0;
  const names = new Set<string>();
  for (const file of files) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(file.name) || file.name.startsWith('.') || names.has(file.name)) throw new Error('Invalid or duplicate evidence filename');
    names.add(file.name);
    const name = encoder.encode(file.name), data = encoder.encode(file.text), crc = crc32(data);
    const header = new Uint8Array(30 + name.length);
    const h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint16(12, 33, true); // valid DOS date 1980-01-01
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true); header.set(name, 30);
    const directory = new Uint8Array(46 + name.length);
    const d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x0800, true);
    d.setUint16(14, 33, true); d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true);
    d.setUint16(28, name.length, true); d.setUint32(42, offset, true); directory.set(name, 46);
    local.push(header, data); central.push(directory);
    offset += header.length + data.length; centralSize += directory.length;
    if (offset + centralSize > 64 * 1024 * 1024) throw new Error('Evidence ZIP exceeds 64 MB; narrow your dates.');
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
  const bytes = new Uint8Array(offset + centralSize + 22);
  let position = 0;
  for (const part of [...local, ...central, end]) { bytes.set(part, position); position += part.length; }
  return new Blob([bytes.buffer], { type: 'application/zip' });
}
