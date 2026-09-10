import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(
    here,
    '../../../../supabase/migrations/20260910134124_fix_housekeeping_section_hotel_identity.sql',
  ),
  'utf8',
);

describe('housekeeping section room mapping policies', () => {
  it('resolves room slugs and section display names through one hotel identity', () => {
    expect(migration).toContain('join public.hotel_configurations hotel');
    expect(migration).toContain('hotel.hotel_id = room.hotel or hotel.hotel_name = room.hotel');
    expect(migration).toContain(
      'hotel.hotel_id = section.hotel_name or hotel.hotel_name = section.hotel_name',
    );
  });

  it('keeps reads and every manager write operation hotel-scoped', () => {
    expect(migration.match(/create policy /g)).toHaveLength(4);
    expect(migration.match(/public\.user_can_access_hotel\(\(select auth\.uid\(\)\), hotel\.hotel_id\)/g)).toHaveLength(5);
    expect(migration).toContain('for insert to authenticated');
    expect(migration).toContain('for update to authenticated');
    expect(migration).toContain('for delete to authenticated');
  });
});
