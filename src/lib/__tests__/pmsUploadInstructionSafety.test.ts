import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Guard the real import path rather than a detached helper that may never be used.
const source = readFileSync('src/components/dashboard/PMSUpload.tsx', 'utf8');
const rowUpdate = source.split('const updateData: any = {')[1]?.split('// Update room_type')[0];

describe('PMS Excel import must not erase manager-owned room instructions', () => {
  it('does not reset bed configuration when clearing daily PMS service flags', () => {
    expect(source).toMatch(/\.update\(\{ towel_change_required: false, linen_change_required: false \} as any\)/);
    expect(source).not.toContain('bed_configuration: null');
  });

  it('never replaces manual room notes with the PMS spreadsheet cell or a blank cell', () => {
    expect(rowUpdate).toBeDefined();
    expect(rowUpdate).not.toMatch(/^\s*notes\s*:/m);
    expect(rowUpdate).toContain('pmsUploadNote: roomNotes');
    expect(rowUpdate).toContain('pmsUploadStatusNote: statusNote');
  });
});
