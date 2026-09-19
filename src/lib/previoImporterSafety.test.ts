import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Importing the Deno handler would start a live server. These source-level
// release guards cover the production handler without invoking Previo or the DB.
const source = readFileSync(new URL('../../supabase/functions/previo-sync-reservations/index.ts', import.meta.url), 'utf8');

describe('Previo reservation importer production safety contract', () => {
  it('paginates canonical existing reservations below the API row cap', () => {
    expect(source).toContain('const PAGE_SIZE = 500');
    expect(source).toMatch(/\.eq\("hotel_id", hotelId\)\.eq\("source", "previo"\)\.order\("id"\)\.range\(offset, offset \+ PAGE_SIZE - 1\)/);
    expect(source).toContain('if (error || !data) throw new Error("Unable to read all existing Previo reservations")');
  });

  it('aborts before writing if any Previo response is incomplete', () => {
    const fail = source.indexOf('if (!response.ok)');
    const upsert = source.indexOf('.upsert(chunk.map(item => item.record)');
    expect(fail).toBeGreaterThan(-1);
    expect(upsert).toBeGreaterThan(fail);
    expect(source.slice(fail, upsert)).toContain('return json({ success: false, complete: false');
  });

  it('counts only successful upsert batches and avoids false success on failed batches', () => {
    const upsert = source.indexOf('.upsert(chunk.map(item => item.record)');
    const batchError = source.indexOf('if (error) {', upsert);
    const committed = source.indexOf('committedInserted++', upsert);
    expect(upsert).toBeGreaterThan(0);
    expect(batchError).toBeGreaterThan(upsert);
    expect(committed).toBeGreaterThan(batchError);
    expect(source).toContain('errors.length ? committed ? "partial" : "failed" : "success"');
    expect(source).toContain('completed_batches_only: true');
  });

  it('does not mark the property as fully synced when any import batch fails', () => {
    expect(source).toContain('if (status === "success")');
    expect(source).toContain('return json({ success: status === "success", complete: status === "success"');
    expect(source).not.toContain('syncStatus = errors.length === 0 ? "success" : payload.length > 0');
  });
});
