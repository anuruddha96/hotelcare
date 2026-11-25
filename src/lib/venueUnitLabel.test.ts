import { describe, it, expect } from 'vitest';
import { shortUnitLabel } from './venueUnitLabel';

describe('shortUnitLabel', () => {
  it('drops the repeated property name', () => {
    expect(shortUnitLabel('Silver Rooms 12', 'Silver Rooms')).toBe('12');
    expect(shortUnitLabel('K4 – Room 5', 'K4')).toBe('5');
    expect(shortUnitLabel('St King 11 – Room 2', 'St King 11')).toBe('2');
  });

  it('falls back to a short unit word for single-unit properties', () => {
    expect(shortUnitLabel('CityNest', 'CityNest')).toBe('Unit');
    expect(shortUnitLabel('CityNest', 'CityNest', 'Egység')).toBe('Egység');
  });

  it('keeps the full name when it does not repeat the property', () => {
    expect(shortUnitLabel('Duplex Penthouse Terrace', 'Klauzál utca 5')).toBe('Duplex Penthouse Terrace');
    expect(shortUnitLabel('203', null)).toBe('203');
  });

  it('is tolerant of casing and dash styles', () => {
    expect(shortUnitLabel('silver rooms — 7', 'Silver Rooms')).toBe('7');
  });
});
