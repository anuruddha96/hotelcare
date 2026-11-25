import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendNow: vi.fn(),
  announce: vi.fn(),
  toast: Object.assign(vi.fn(), { loading: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('./vizaDesk', () => ({ vizaSendNow: mocks.sendNow, announceVizaRejected: mocks.announce }));
vi.mock('sonner', () => ({ toast: mocks.toast }));

import { startVizaInstantSend } from './instantSend';

const t = (key: string) => key;
const result = (outcome: string, extra: Record<string, unknown> = {}) => ({ event_id: 'e1', phase: 'arrival', outcome, receipt: null, error: null, guest_name: 'Specimen A', reservation_number: 'RES-1', ...extra });

describe('instant VIZA send after check-in', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows a small success note when VIZA accepts', async () => {
    mocks.sendNow.mockResolvedValue({ ok: true, enabled: true, results: [result('accepted', { receipt: 'r1' })] });
    await startVizaInstantSend({ hotelId: 'h1', reservationId: 'res1', phase: 'arrival', t });
    expect(mocks.sendNow).toHaveBeenCalledWith({ hotelId: 'h1', reservationId: 'res1', phase: 'arrival', t });
    expect(mocks.toast.success).toHaveBeenCalledWith('pms.viza.instant.acceptedArrival', expect.objectContaining({ description: 'Specimen A' }));
  });

  it('opens the correction popup when VIZA refuses', async () => {
    mocks.sendNow.mockResolvedValue({ ok: true, enabled: true, results: [result('rejected', { error: 'THF EF0051: too long' })] });
    await startVizaInstantSend({ hotelId: 'h1', reservationId: 'res1', phase: 'arrival', t });
    expect(mocks.toast.error).toHaveBeenCalledWith('pms.viza.instant.rejected', expect.any(Object));
    expect(mocks.announce).toHaveBeenCalledWith({ hotelId: 'h1', eventIds: ['e1'] });
  });

  it('reassures reception when VIZA cannot be reached', async () => {
    mocks.sendNow.mockResolvedValue({ ok: true, enabled: true, unreachable: true, next_try_at: '2026-11-25T14:04:01Z', results: [result('pending')] });
    await startVizaInstantSend({ hotelId: 'h1', reservationId: 'res1', phase: 'arrival', t });
    expect(mocks.toast.warning).toHaveBeenCalledWith('pms.viza.instant.unreachable', expect.objectContaining({ description: 'pms.viza.instant.unreachableHint' }));
  });

  it('stays silent for hotels without VIZA and never throws', async () => {
    mocks.sendNow.mockResolvedValue({ ok: true, enabled: false, results: [] });
    await expect(startVizaInstantSend({ hotelId: 'h1', reservationId: 'res1', phase: 'departure', t })).resolves.toMatchObject({ enabled: false });
    mocks.sendNow.mockRejectedValue(new Error('network'));
    await expect(startVizaInstantSend({ hotelId: 'h1', reservationId: 'res1', phase: 'departure', t })).resolves.toBeNull();
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.toast.loading).not.toHaveBeenCalled();
  });
});
