import { describe, expect, it } from 'vitest';
import {
  calculateGrossLine,
  canManagePmsServiceCatalogue,
  summarizeFinancialAccount,
} from '@/lib/pmsFinance';

describe('pmsFinance', () => {
  it('calculates VAT from a gross-priced service deterministically', () => {
    expect(calculateGrossLine(2, 100, 27)).toEqual({
      gross: 200,
      net: 157.48,
      vat: 42.52,
    });
  });

  it('keeps special/unmapped VAT lines gross-equal-net until fiscal mapping', () => {
    expect(calculateGrossLine(3, 12.5, null)).toEqual({
      gross: 37.5,
      net: 37.5,
      vat: 0,
    });
  });

  it('summarizes base stay, extras and recorded payments without counting voided/reversed rows', () => {
    expect(
      summarizeFinancialAccount(
        1000,
        [
          { gross_total: 100, status: 'open' },
          { gross_total: 50, status: 'invoiced' },
          { gross_total: 999, status: 'voided' },
        ],
        [
          { amount: 400, status: 'recorded' },
          { amount: 200, status: 'captured' },
          { amount: 300, status: 'reversed' },
        ],
      ),
    ).toEqual({
      base: 1000,
      extras: 150,
      charges: 1150,
      paid: 600,
      balance: 550,
    });
  });

  it('restricts catalogue management to management roles', () => {
    expect(canManagePmsServiceCatalogue('manager')).toBe(true);
    expect(canManagePmsServiceCatalogue('top_management')).toBe(true);
    expect(canManagePmsServiceCatalogue('reception')).toBe(false);
  });
});
