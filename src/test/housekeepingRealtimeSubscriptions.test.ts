import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(resolve(process.cwd(), 'src/components/dashboard', name), 'utf8');

describe('housekeeping Realtime subscriptions', () => {
  it('uses one room assignment filter in the mobile housekeeping screen', () => {
    const source = read('MobileHousekeepingView.tsx');
    expect(source.match(/table: 'room_assignments'/g)).toHaveLength(1);
    expect(source).not.toContain(".channel('assignment_changes')");
    expect(source).toContain("event: '*'");
    expect(source).toContain("payload.eventType === 'INSERT' || payload.eventType === 'DELETE'");
    expect(source).toContain('void fetchSummary()');
  });

  it('uses one filter for staff updates and new assignment notifications', () => {
    const source = read('HousekeepingStaffView.tsx');
    expect(source.match(/table: 'room_assignments'/g)).toHaveLength(1);
    expect(source).toContain("event: '*'");
    expect(source).toContain("payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE'");
    expect(source).toContain("t('notifications.newAssignment')");
  });
});
