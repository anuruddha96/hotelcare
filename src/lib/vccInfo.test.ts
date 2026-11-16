import { describe, expect, it } from 'vitest';
import { deriveVccInfo, normalizeNoteDate } from './vccInfo';

const TODAY = '2026-11-16';

describe('normalizeNoteDate', () => {
  it('reads the date formats OTAs use', () => {
    expect(normalizeNoteDate('2026-11-20')).toBe('2026-11-20');
    expect(normalizeNoteDate('20.11.2026')).toBe('2026-11-20');
    expect(normalizeNoteDate('5/1/2027')).toBe('2027-01-05');
    expect(normalizeNoteDate('20 November 2026')).toBe('2026-11-20');
    expect(normalizeNoteDate('soon')).toBeNull();
    expect(normalizeNoteDate(null)).toBeNull();
  });
});

describe('deriveVccInfo', () => {
  it('returns nothing for a booking the guest pays at the hotel', () => {
    expect(deriveVccInfo({ source: 'previo', total_amount: 200, balance_due: 200 }, TODAY)).toBeNull();
    expect(deriveVccInfo({ source: 'direct', payment_collect: 'property' }, TODAY)).toBeNull();
  });

  it('infers a virtual card when the OTA collects (Channex booking) and points at the PCI vault', () => {
    const info = deriveVccInfo({ source: 'channex', channex_booking_id: 'b1', payment_collect: 'ota', ota_name: 'Booking.com', total_amount: 230, balance_due: 230, currency: 'EUR' }, TODAY);
    expect(info).toMatchObject({ virtualCard: true, confidence: 'inferred', state: 'unknown', amountToCharge: 230, currency: 'EUR', channel: 'Booking.com', cardLocation: 'pci_vault' });
  });

  it('knows a Previo booking is already charged when Previo reports it paid', () => {
    const info = deriveVccInfo({ source: 'previo', payment_collect: 'ota', pms_payment_status: 'paid', total_amount: 300, balance_due: 0 }, TODAY);
    expect(info).toMatchObject({ state: 'charged', amountToCharge: 0, cardLocation: 'pms' });
  });

  // As stored by the Previo importer for a Booking.com virtual-card booking.
  const NOTE = `Recepce - VCC</br></br>Systém - <span classcontainer-1>Partner <span classvalue-1>Booking.com XML</span></span><br><span classcontainer-9>Comment <span classvalue-9>You have received a virtual credit card for this reservation.You may charge it as of 2026-11-20.</span></span><br><span classcontainer-14>Payment <span classvalue-14>300.19 EUR (ota). Calculated amount 300.19 EUR. Payment - Virtual Credit Card. Needs to be charged from Virtual Credit Card.</span></span>`;
  const previo = { source: 'previo', special_requests: NOTE, pms_channel: 'Booking.com', total_amount: 300.19, balance_due: 300.19, currency: 'EUR', pms_payment_status: 'unpaid' };

  it('reads a stated virtual card and its activation date from the Previo note', () => {
    expect(deriveVccInfo(previo, TODAY)).toMatchObject({
      confidence: 'stated', state: 'not_yet', chargeableFrom: '2026-11-20', daysUntilChargeable: 4,
      amountToCharge: 300.19, cardLocation: 'pms',
    });
    expect(deriveVccInfo(previo, TODAY)?.instructions.join(' ')).toMatch(/charged from Virtual Credit Card/i);
  });

  it('turns chargeable on the activation date', () => {
    expect(deriveVccInfo(previo, '2026-11-20')).toMatchObject({ state: 'chargeable', daysUntilChargeable: 0 });
    expect(deriveVccInfo(previo, '2026-12-01')).toMatchObject({ state: 'chargeable' });
  });
});
