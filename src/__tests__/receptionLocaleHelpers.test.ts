import { describe, expect, it } from 'vitest';
import '@/lib/pms-reception-translations';
import '@/lib/ntak-translations';
import '@/lib/pms-unified-reception-translations';
import { pmsTranslations } from '@/lib/pms-translations';
import { createLocaleFormat } from '@/lib/i18n/localeFormat';
import { bookingSourceLabel, documentTypeLabel, paymentStatusLabel, reportingStateLabel,
  reservationEventLabel, reservationStatusLabel, roomStatusLabel } from '@/lib/i18n/receptionLabels';

describe('Hungarian reception display helpers', () => {
  const fmt = createLocaleFormat('hu', 'Europe/Budapest');
  it('formats Hungarian civil dates, times, amounts and month names', () => {
    expect(fmt.formatDate('2026-11-24')).toBe('2026. 11. 24.');
    expect(fmt.formatDateTime('2026-11-24T21:57:00Z')).toBe('2026. 11. 24. 22:57');
    expect(fmt.formatShortDate('2026-11-25')).toBe('nov. 25.');
    expect(fmt.formatShortDateTime('2026-11-25T09:00:00Z')).toBe('nov. 25., 10:00');
    expect(fmt.formatMonthYear('2026-11-25')).toBe('2026. november');
    expect(fmt.formatTime('2026-11-25T09:00:00Z')).toBe('10:00');
    expect(fmt.formatNumber(12500)).toBe('12 500');
    expect(fmt.formatMoney(200, 'EUR')).toBe('200 €');
    expect(fmt.formatMoney(12500, 'HUF')).toBe('12 500 Ft');
  });
  it('uses the requested Budapest timezone and keeps civil booking dates stable', () => {
    expect(fmt.formatDateTime('2026-11-25T23:30:00Z')).toBe('2026. 11. 26. 00:30');
    expect(createLocaleFormat('hu', 'America/New_York').formatDate('2026-11-25')).toBe('2026. 11. 25.');
    expect(createLocaleFormat('tl').intlLocale).toBe('en-GB');
  });
  const t = (key: string) => (pmsTranslations.hu as Record<string, string>)[key] ?? key;
  it('translates known codes without altering the input', () => {
    expect(reservationStatusLabel('checked_out', t)).toBe('Kijelentkezett');
    expect(bookingSourceLabel('BookingCom', t)).toBe('Booking.com');
    expect(bookingSourceLabel(' WALK_IN ', t)).toBe('Helyszíni foglalás');
    expect(documentTypeLabel('passport', t)).toBe('Útlevél');
    expect(documentTypeLabel('driver_license', t)).toBe('Vezetői engedély');
    expect(roomStatusLabel('dirty', t)).toBe('Piszkos');
    expect(paymentStatusLabel('partially_paid', t)).toBe('Részben fizetve');
    expect(reservationEventLabel('check_out', t)).toBe('Kijelentkezés');
    expect(reportingStateLabel('sent', t)).toBe('Elküldve');
  });
  it('hides unknown technical codes from display labels', () => {
    for (const fn of [bookingSourceLabel, documentTypeLabel, paymentStatusLabel, reportingStateLabel,
      reservationEventLabel, reservationStatusLabel, roomStatusLabel]) {
      expect(fn('unknown_raw_code', t)).toBe('Egyéb');
      expect(fn('__proto__', t)).toBe('Egyéb');
    }
  });
});
