import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260925180000_portfolio_missed_service_carry_forward.sql',
  'utf8',
);
const card = readFileSync('src/components/dashboard/AssignedRoomCardLegacy.tsx', 'utf8');
const overview = readFileSync('src/components/dashboard/HotelRoomOverviewLive.tsx', 'utf8');

describe('portfolio missed-service carry-forward contract', () => {
  it('is gated to Mika, Ottofiori and Gozsdu and starts after the live 25 Sep shift', () => {
    expect(migration).toContain("'mika-downtown'");
    expect(migration).toContain("'ottofiori'");
    expect(migration).toContain("'gozsdu-court'");
    expect(migration).toContain("DATE '2026-09-26'");
    expect(migration).not.toContain("WHEN 'memories-budapest'");
  });

  it('keeps checkout/new-arrival/no-show authority ahead of carry-forward', () => {
    expect(migration).toContain('scheduledDepartureToday');
    expect(migration).toContain('arrivalToday');
    expect(migration).toContain('isNoShow');
    expect(migration).toContain('isCancelled');
    expect(migration).toContain('notArrived');
    expect(migration).toContain('v_same_reservation');
  });

  it('keeps Gozsdu carry separate from the underlying room service-cycle flags', () => {
    const materialize = migration.split('CREATE OR REPLACE FUNCTION public.hc_materialize_gozsdu_carry_assignments')[1]
      .split('REVOKE ALL ON FUNCTION public.hc_materialize_gozsdu_carry_assignments')[0];
    expect(materialize).toContain("gozsduAvailability,status");
    expect(materialize).toContain("jsonb_build_object('carry_forward',v_payload)");
    expect(materialize).not.toContain('UPDATE public.rooms');
    expect(materialize).not.toContain('towel_change_required =');
    expect(materialize).not.toContain('linen_change_required =');
  });

  it('shows the instruction to housekeepers and managers', () => {
    expect(card).toContain('Carried service from yesterday');
    expect(card).toContain('setTranslatedCarryNote');
    expect(overview).toContain('Carried service from yesterday');
    expect(overview).toContain('effectiveCarryServiceFlags');
  });
});
