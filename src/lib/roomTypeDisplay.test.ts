import { describe, expect, it } from 'vitest';
import { displayRoomType } from './roomTypeDisplay';
import { plainNote } from './plainNote';

describe('displayRoomType', () => {
  it('shows known Previo names in English, ignoring case and stray spaces', () => {
    expect(displayRoomType('Luxusní třílůžkový pokoj ')).toBe('Deluxe Triple Room');
    expect(displayRoomType('Ekonomický dvoulůžkový pokoj')).toBe('Economy Double Room');
    expect(displayRoomType('Deluxe Čtyřlůžkový Pokoj ')).toBe('Deluxe Quadruple Room');
    expect(displayRoomType('Superior lakosztály')).toBe('Superior Suite');
  });
  it('leaves English names untouched', () => {
    expect(displayRoomType('Deluxe Twin Room')).toBe('Deluxe Twin Room');
    expect(displayRoomType('Double or twin 2+1 ')).toBe('Double or twin 2+1');
  });
  it('translates word by word when the full name is new', () => {
    expect(displayRoomType('Komfortní třílůžkový pokoj s balkonem')).toBe('Comfort Triple Room with Balcony');
  });
  it('handles empty input', () => {
    expect(displayRoomType(null)).toBe('');
  });
});

describe('plainNote', () => {
  it('returns plain text unchanged', () => {
    expect(plainNote('Late arrival, quiet room')).toBe('Late arrival, quiet room');
  });
  it('strips Previo markup and keeps line breaks', () => {
    const raw = 'Kuchyně - <b>BREAKFAST IN </b></br></br>Recepce - VCC 79.72</br></br>Systém - <span classcontainer-1>Partner <span classvalue-1>Booking.com XML</span></span><br>';
    expect(plainNote(raw)).toBe('Kuchyně - BREAKFAST IN\n\nRecepce - VCC 79.72\n\nSystém - Partner Booking.com XML');
  });
});
