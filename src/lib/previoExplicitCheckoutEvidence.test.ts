import { describe, expect, it } from 'vitest';
import { verifiedGozsduCheckouts } from '../../supabase/functions/_shared/previoExplicitCheckoutEvidence';

const today = '2026-09-23';
const roster = new Map([[1856755, '1BBALC-3002'], [1856763, '1BBALC-5002']]);
const mapped = new Set([1856755, 1856763]);
const block = (id: number, name: string, status: number, to = today) =>
  `<reservation><resId>r${id}</resId><statusId>${status}</statusId><term><from>2026-09-20</from><to>${to}</to></term><object><objId>${id}</objId><name>${name}</name></object></reservation>`;
const xml = (...items: string[]) => `<?xml version="1.0"?><reservations>${items.join('')}</reservations>`;

describe('Gozsdu independent explicit Previo checkout evidence', () => {
  it('recovers 1BBALC-3002 when Previo explicitly returns today's completed checkout', () => {
    expect(verifiedGozsduCheckouts(xml(block(1856755, '1BBALC-3002', 6)), today, roster, mapped, new Set()))
      .toEqual([{ objId: 1856755, roomName: '1BBALC-3002', reservationId: 'r1856755' }]);
  });
  it('never marks RTC from a scheduled departure, dirty room or missing reservation', () => {
    expect(verifiedGozsduCheckouts(xml(), today, roster, mapped, new Set())).toEqual([]);
    expect(verifiedGozsduCheckouts(xml(block(1856755, '1BBALC-3002', 3)), today, roster, mapped, new Set())).toEqual([]);
    expect(verifiedGozsduCheckouts(xml(block(1856755, '1BBALC-3002', 5)), today, roster, mapped, new Set())).toEqual([]);
  });
  it('refuses a guest still in-house, a later departure, and an unmatched physical object or name', () => {
    expect(verifiedGozsduCheckouts(xml(block(1856755, '1BBALC-3002', 6)), today, roster, mapped, new Set([1856755]))).toEqual([]);
    expect(verifiedGozsduCheckouts(xml(block(1856755, '1BBALC-3002', 6, '2026-09-24')), today, roster, mapped, new Set())).toEqual([]);
    expect(verifiedGozsduCheckouts(xml(block(1856755, 'OTHER-3002', 6), block(999, '1BBALC-3002', 6)), today, roster, mapped, new Set())).toEqual([]);
  });
  it('deduplicates a physical room in a repeated check-out response', () => {
    const b = block(1856755, '1BBALC-3002', 9);
    expect(verifiedGozsduCheckouts(xml(b, b), today, roster, mapped, new Set())).toHaveLength(1);
  });
});
