import { describe, expect, it } from 'vitest';
import { buildReceptionSyncHealth, syncEventCount, type ReceptionSyncEvent } from './receptionSyncHealth';

const NOW = Date.parse('2026-09-19T06:00:00Z');
const make = (type: string, status: string, time: string, hotel = 'gozsdu-court'): ReceptionSyncEvent => ({ hotel_id: hotel, sync_type: type, sync_status: status, created_at: time });

describe('reception PMS sync health', () => {
  it('does not interpret daily overview/checkout/rate success as reservation success', () => {
    const rows = [
      make('daily_overview_live', 'success', '2026-09-19T05:59:00Z'),
      make('checkouts_poll', 'success', '2026-09-19T05:59:00Z'),
      make('rate_push', 'success', '2026-09-19T05:59:00Z'),
    ];
    const health = buildReceptionSyncHealth(rows, NOW, ['gozsdu-court']);
    expect(health.find(s => s.category === 'reservations')?.state).toBe('missing');
    expect(health.find(s => s.category === 'room_status')?.state).toBe('missing');
    expect(health.find(s => s.category === 'overview')?.state).toBe('ok');
    expect(health.find(s => s.category === 'rates')?.note).toMatch(/OTA delivery is not verified/);
  });

  it('distinguishes last attempt from last success and flags a failed attempt', () => {
    const health = buildReceptionSyncHealth([
      make('reservations', 'failed', '2026-09-19T05:58:00Z'),
      make('reservations', 'success', '2026-09-19T05:50:00Z'),
    ], NOW);
    expect(health[0].state).toBe('warning');
    expect(health[0].lastAttempt?.sync_status).toBe('failed');
    expect(health[0].lastSuccess?.sync_status).toBe('success');
  });

  it('rejects another property and stale reservations while preserving legitimate idle rate pushes', () => {
    const health = buildReceptionSyncHealth([
      make('reservations', 'success', '2026-09-17T06:00:00Z'),
      make('reservations', 'success', '2026-09-19T05:55:00Z', 'ottofiori'),
      make('rate_push', 'success', '2026-09-10T06:00:00Z'),
    ], NOW, ['gozsdu-court']);
    expect(health[0].state).toBe('warning');
    expect(health[0].lastSuccess?.hotel_id).toBe('gozsdu-court');
    expect(health[3].state).toBe('ok');
  });

  it('does not fabricate import counters for unrelated sync payloads', () => {
    expect(syncEventCount(null)).toBeNull();
    expect(syncEventCount({sync_type:'reservations',sync_status:'success',created_at:'2026-09-19',data:{inserted:2,updated:3,unmapped_rooms:1}})).toBe('2 new · 3 updated · 1 unmapped');
    expect(syncEventCount({sync_type:'daily_overview_live',sync_status:'success',created_at:'2026-09-19',data:{foo:4}})).toBeNull();
  });
});
