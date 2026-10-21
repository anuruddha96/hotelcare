import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getMemoriesDailyBoardCarry } from '@/lib/memoriesDailyBoardCarry';

const source = '2026-10-20';
const today = '2026-10-21';
const verified = {
  active: true,
  property_id: 'memories-budapest',
  service_type: 'towel_change',
  reason: 'dnd',
  source_business_date: source,
  original_due_date: source,
  attempt_count: 1,
};

const read = (override: Record<string, unknown> = {}) =>
  getMemoriesDailyBoardCarry({
    hotel: 'Hotel Memories Budapest',
    selectedDate: today,
    today,
    isCheckout: false,
    cachedCarry: verified,
    ...override,
  });

describe('HMB room-board carry before assignments', () => {
  it('shows yesterday’s proven DND T when the room is daily and unassigned', () => {
    expect(read()?.serviceType).toBe('towel_change');
    expect(read()?.originalDueDate).toBe(source);
  });

  it('supports an outstanding Change Room service', () => {
    expect(read({ cachedCarry: { ...verified, service_type: 'full_clean', reason: 'no_service' } })?.serviceType).toBe('full_clean');
  });

  it('does not carry checkout rooms or successfully cleaned assignments', () => {
    expect(read({ isCheckout: true })).toBeNull();
    expect(read({ assignment: { service_result: 'cleaned' } })).toBeNull();
  });

  it('does not leak to other hotels, historical dates or stale source dates', () => {
    expect(read({ hotel: 'Hotel Ottofiori' })).toBeNull();
    expect(read({ today: '2026-10-22' })).toBeNull();
    expect(read({ cachedCarry: { ...verified, source_business_date: '2026-10-19' } })).toBeNull();
    expect(read({ cachedCarry: { ...verified, property_id: 'gozsdu-court' } })).toBeNull();
  });

  it('does not invent tasks from No Service without proof', () => {
    expect(read({ cachedCarry: null })).toBeNull();
    expect(read({ cachedCarry: { ...verified, active: false } })).toBeNull();
  });

  it('uses original-due snapshot proof and is HMB only at the SQL level', () => {
    const sql = readFileSync('supabase/migrations/20261021081500_memories_unassigned_room_carry_board.sql', 'utf8');
    expect(sql).toContain('hc_prove_housekeeping_carry_context');
    expect(sql).toContain('hc_memories_previous_service_context');
    expect(sql).toContain('hotelcare-memories-daily-carry-board');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain("'hotel memories budapest'");
    expect(sql).not.toMatch(/UPDATE\s+public\.rooms\s/i);
    expect(sql).not.toContain('INSERT INTO public.room_assignments');
  });
});
