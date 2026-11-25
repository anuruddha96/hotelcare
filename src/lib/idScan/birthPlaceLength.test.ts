import { describe, expect, it } from 'vitest';
import { vizaFieldRequirements, type GuestVizaValues } from './guestVizaChecks';

const stay = 'test-stay';
const day = new Date('2026-11-24T00:00:00Z');
const guest: GuestVizaValues = {
  first_name: 'A', last_name: 'Specimen', nationality: 'GB', gender: 'male',
  date_of_birth: '1950-01-01', id_document_type: 'passport', id_document_number: '605100803',
  birth_place: 'Gibraltar',
  viza_review: { reservation_id: stay, manual_reason: 'Scanner failed', mother_name_absent: true, birth_name_absent: true },
};

describe('place of birth length (THF EF0051: at most 200 characters, 254 bytes)', () => {
  it('flags a place of birth the THF would refuse before check-in', () => {
    expect(vizaFieldRequirements(guest, stay, day).birth_place.ok).toBe(true);
    expect(vizaFieldRequirements({ ...guest, birth_place: 'G'.repeat(200) }, stay, day).birth_place.ok).toBe(true);
    expect(vizaFieldRequirements({ ...guest, birth_place: 'G'.repeat(201) }, stay, day).birth_place.ok).toBe(false);
    // 128 two-byte letters: 128 characters but 256 bytes in UTF-8.
    expect(vizaFieldRequirements({ ...guest, birth_place: 'ő'.repeat(128) }, stay, day).birth_place.ok).toBe(false);
  });
});
