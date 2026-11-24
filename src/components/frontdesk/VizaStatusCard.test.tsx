import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VizaStatusCard } from './VizaStatusCard';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
    rpc: mocks.rpc,
    from: mocks.from,
  },
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('VizaStatusCard failed enqueue recovery', () => {
  it('exposes the recorded failure and permits an authorized retry', async () => {
    mocks.invoke.mockResolvedValue({
      data: {
        configured: true, can_manage: false, queued: 0,
        settings: {
          enabled: true, environment: 'test', thf_url: 'https://example.test',
          last_error: 'VIZA queue error for reservation 0000',
          last_status_code: null, last_status_at: null, failed_count: 1, unsent_count: 0,
        },
        events: [],
      },
      error: null,
    });
    const pending = {
      id: 'failure-01', reservation_id: 'reservation-01',
      last_error: 'simulated enqueue failure',
      attempts: 1, updated_at: '2026-11-23T10:00:00Z',
      reservation: { reservation_number: 'RES-TEST-123', guest: { first_name: 'Luca', last_name: 'Ferri' } },
    };
    const query = {
      select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), limit: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.limit.mockResolvedValue({ data: [pending], error: null });
    mocks.from.mockReturnValue(query);
    mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });

    render(<VizaStatusCard hotelId="hotel-01" />);
    expect(await screen.findByText('pms.viza.queueFailed')).toBeInTheDocument();
    expect(screen.getByText('simulated enqueue failure')).toBeInTheDocument();
    expect(screen.getByText(/RES-TEST-123 · Luca Ferri/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'pms.viza.retryQueue' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      'pms_retry_viza_trigger_failure', { _failure_id: 'failure-01' },
    ));
    expect(mocks.from).toHaveBeenCalledWith('viza_trigger_failures');
  });
});
