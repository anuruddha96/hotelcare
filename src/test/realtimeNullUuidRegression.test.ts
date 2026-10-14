import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidRealtimeUuid } from '../lib/realtimeUuidFilter';

const readDashboard = (filename: string) =>
  readFileSync(resolve(process.cwd(), 'src/components/dashboard', filename), 'utf8');

describe('no invalid Postgres Changes UUID filters', () => {
  it('rejects the unauthenticated linen-cart initial render', () => {
    expect(isValidRealtimeUuid(null)).toBe(false);
    expect(isValidRealtimeUuid('null')).toBe(false);
    const source = readDashboard('DirtyLinenCartBadge.tsx');
    expect(source).toContain('if (!isValidRealtimeUuid(userId)) return;');
    expect(source.indexOf('if (!isValidRealtimeUuid(userId)) return;')).toBeLessThan(
      source.indexOf('.channel(`dirty-linen-cart-changes-'),
    );
    expect(source).toContain('filter: `housekeeper_id=eq.${userId}`');
  });

  it('guards both housekeeper ID and physical room ID in the linen dialog', () => {
    const source = readDashboard('DirtyLinenDialog.tsx');
    expect(source).toContain('!isValidRealtimeUuid(userId) || !isValidRealtimeUuid(roomId)');
    expect(source).toContain('filter: `room_id=eq.${roomId}`');
  });
});
