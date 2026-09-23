import { describe, expect, it } from 'vitest';
import { matchesSlntBoardFilter, slntSingleRoomLabel } from './slntFlatRoomBoard';

describe('SLNT flat room board label and display-only filters', () => {
  it('uses the complete apartment name in a single chip without duplicating Unit', () => {
    expect(slntSingleRoomLabel('CityNest', 'CityNest')).toBe('CityNest');
    expect(slntSingleRoomLabel('Downtown Terrace Passion', 'Downtown Terrace Passion')).toBe('Downtown Terrace Passion');
    expect(slntSingleRoomLabel('Unit', 'Urban Oasis')).toBe('Urban Oasis');
    expect(slntSingleRoomLabel('Dorothilux Apartment', 'Dorothilux Apartment')).toBe('Dorothilux Apartment');
  });

  it('keeps a meaningful PMS suffix to disambiguate a one-room venue', () => {
    expect(slntSingleRoomLabel('Elisabeth Downtown One Bedroom', 'Elisabeth Downtown')).toBe('Elisabeth Downtown · One Bedroom');
    expect(slntSingleRoomLabel('Duplex Penthouse Terrace', 'Klauzál utca 11')).toBe('Klauzál utca 11 · Duplex Penthouse Terrace');
  });

  it('searches both full property and room identity without changing assignments', () => {
    expect(matchesSlntBoardFilter('Silver Rooms 7', 'Silver Rooms', 'silver', false, false)).toBe(true);
    expect(matchesSlntBoardFilter('Silver Rooms 7', 'Silver Rooms', ' 7 ', false, false)).toBe(true);
    expect(matchesSlntBoardFilter('Silver Rooms 7', 'Silver Rooms', 'st king', false, true)).toBe(false);
    expect(matchesSlntBoardFilter('K4 - Room 5', 'K4', '', false, false)).toBe(true);
  });

  it('only shows genuinely unassigned units with the optional unassigned toggle', () => {
    expect(matchesSlntBoardFilter('CityNest', 'CityNest', '', true, true)).toBe(true);
    expect(matchesSlntBoardFilter('CityNest', 'CityNest', '', true, false)).toBe(false);
    expect(matchesSlntBoardFilter('CityNest', 'CityNest', 'city', true, true)).toBe(true);
    expect(matchesSlntBoardFilter('CityNest', 'CityNest', 'silver', true, true)).toBe(false);
  });
});
