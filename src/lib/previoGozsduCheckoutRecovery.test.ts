import { describe, expect, it } from 'vitest';
import { buildGozsduRoomAliases, mergeGozsduCheckoutEvidence } from '../../supabase/functions/_shared/previoGozsduCheckoutRecovery';

const date = '2026-09-19';
const document = (...blocks: string[]) => `<?xml version="1.0"?><response><reservations>${blocks.join('')}</reservations></response>`;
const reservation = (roomId: number, name: string, status: number, from = '2026-09-15', to = date) =>
  `<reservation><resId>booking-${roomId}</resId><from>${from}</from><to>${to}</to>` +
  `<statusId>${status}</statusId><object><objId>${roomId}</objId><name>${name}</name></object></reservation>`;

const roster = [
  { roomId: 2245399, name: '1B-4005' },
  { roomId: 1856761, name: '1BBALC-410' },
  { roomId: 100, name: 'ST-109' },
  { roomId: 101, name: 'AP-109' },
];

describe('Gozsdu checkout poll recovery', () => {
  it('matches a departure for room 4005 by the same unambiguous physical identifier used by the room importer', () => {
    const aliases = buildGozsduRoomAliases(roster);
    expect(aliases.get(2245399)).toEqual({ originalName: '1B-4005', localNumber: '4005' });
    expect(aliases.get(1856761)?.localNumber).toBe('410');
    expect(aliases.has(100)).toBe(false);
    expect(aliases.has(101)).toBe(false);
    const result = mergeGozsduCheckoutEvidence(
      document(reservation(999, 'ST-201', 5, '2026-09-18', '2026-09-21')),
      document(reservation(2245399, '1B-4005', 6)), aliases, date,
    );
    expect(result.added).toBe(1);
    expect(result.xml).toContain('<objId>2245399</objId><name>4005</name>');
    expect(result.xml).toContain('<statusId>6</statusId>');
    expect(result.xml).toContain('<name>ST-201</name>');
    expect((result.xml.match(/<reservation>/g) || [])).toHaveLength(2);
    expect(result.xml.startsWith('<?xml')).toBe(true);
  });

  it('does not treat absent REST reservation data, dirty room status, or housekeeping activity as checkout evidence', () => {
    const aliases = buildGozsduRoomAliases(roster);
    expect(mergeGozsduCheckoutEvidence(document(), document(), aliases, date)).toEqual({ xml: document(), added: 0 });
    const stillIn = document(reservation(2245399, '1B-4005', 5, '2026-09-15', '2026-09-20'));
    const result = mergeGozsduCheckoutEvidence(stillIn, document(reservation(2245399, '1B-4005', 6)), aliases, date);
    expect(result.added).toBe(0);
    expect(result.xml).not.toContain('<name>4005</name>');
  });

  it('retains explicit checkout when an overlap query is empty, but refuses a future departure or a checked-in guest', () => {
    const aliases = buildGozsduRoomAliases(roster);
    const valid = mergeGozsduCheckoutEvidence(document(), document(reservation(2245399, '1B-4005', 9)), aliases, date);
    expect(valid.added).toBe(1);
    expect(valid.xml).toContain('<name>4005</name>');
    const future = mergeGozsduCheckoutEvidence(document(), document(reservation(2245399, '1B-4005', 6, date, '2026-09-20')), aliases, date);
    expect(future).toEqual({ xml: document(), added: 0 });
    const occupied = mergeGozsduCheckoutEvidence(document(), document(reservation(2245399, '1B-4005', 5)), aliases, date);
    expect(occupied).toEqual({ xml: document(), added: 0 });
  });

  it('does not double count a checkout present in both query modes', () => {
    const aliases = buildGozsduRoomAliases(roster);
    const checkout = reservation(2245399, '1B-4005', 6);
    const result = mergeGozsduCheckoutEvidence(document(checkout), document(checkout), aliases, date);
    expect(result.added).toBe(0);
    expect((result.xml.match(/<reservation>/g) || [])).toHaveLength(1);
    expect(result.xml).toContain('<name>4005</name>');
  });

  it('never rewrites duplicate room numbers or a mismatched Previo room ID/name', () => {
    const aliases = buildGozsduRoomAliases(roster);
    const result = mergeGozsduCheckoutEvidence(document(), document(reservation(100, 'ST-109', 6)), aliases, date);
    expect(result.xml).toContain('<name>ST-109</name>');
    expect(result.xml).not.toContain('<name>109</name>');
    const mismatch = mergeGozsduCheckoutEvidence(document(), document(reservation(2245399, '2B-4005', 6)), aliases, date);
    expect(mismatch.xml).toContain('<name>2B-4005</name>');
    expect(mismatch.xml).not.toContain('<name>4005</name>');
  });
});
