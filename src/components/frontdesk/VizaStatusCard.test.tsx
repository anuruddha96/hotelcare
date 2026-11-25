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
// Keys come back as themselves; the two texts with placeholders keep them so the filled values can be checked.
const templates: Record<string, string> = {
  'pms.viza.outageQueued': 'pms.viza.outageQueued {count}',
  'pms.viza.outageNextTryAt': 'pms.viza.outageNextTryAt {time}',
};
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => templates[key] ?? key }),
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


function reportFixture(settings: Record<string, unknown> = {}, events: Record<string, unknown>[] = [], canManage = true) {
  const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), limit: vi.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query); query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: [], error: null });
  mocks.from.mockReturnValue(query);
  return { configured: true, can_manage: canManage, queued: 0, events,
    settings: { enabled: true, last_status_code: 'OK', last_status_at: '2026-11-24T22:04:01Z', updated_at: '2026-11-24T22:14:01Z', last_error: null, failed_count: 0, unsent_count: 0, ...settings } };
}
describe('VIZA validation report', () => {
  it('shows current connection failure instead of stale OK, with Budapest times', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-24T22:15:00Z'));
    try {
      mocks.invoke.mockResolvedValue({ data: { ...reportFixture({ last_error: 'Connection failed' }), queued: 2 }, error: null });
      render(<VizaStatusCard hotelId="hotel-01" report />);
      expect(await screen.findByText('pms.viza.notReachable')).toBeInTheDocument();
      expect(screen.queryByText('OK')).not.toBeInTheDocument();
      expect(screen.getByText(/pms.viza.lastSuccessfulCheck: .*23:04:01/)).toBeInTheDocument();
      expect(screen.getByText(/pms.viza.lastAttempt: .*23:14:01.*ntak.vizaState.failed/)).toBeInTheDocument();
      // Plain words first: desk keeps working, how many reports wait, next automatic try, what to do.
      const alert = screen.getByText('pms.viza.outageTitle').closest('[role="alert"]') as HTMLElement;
      expect(alert).toHaveTextContent('pms.viza.outageDesk');
      expect(alert).toHaveTextContent('pms.viza.outageQueued 2');
      expect(alert).toHaveTextContent('pms.viza.outageNextTryAt 23:24');
      expect(alert).toHaveTextContent('pms.viza.outageAction');
      // The technical error stays visible for support.
      expect(alert).toHaveTextContent('pms.viza.technicalDetails: Connection failed');
    } finally {
      vi.useRealTimers();
    }
  });
  it('says nothing is waiting and hides a next try that is long past', async () => {
    mocks.invoke.mockResolvedValue({ data: reportFixture({ last_error: 'Connection failed', updated_at: '2020-01-01T00:00:00Z' }), error: null });
    render(<VizaStatusCard hotelId="hotel-01" report />);
    const alert = (await screen.findByText('pms.viza.outageTitle')).closest('[role="alert"]') as HTMLElement;
    expect(alert).toHaveTextContent('pms.viza.outageNothingQueued');
    expect(alert).not.toHaveTextContent('pms.viza.outageNextTryAt');
  });
  it('explains warning flags and tells staff to notify the operator', async () => {
    mocks.invoke.mockResolvedValue({ data: reportFixture({ last_status_code: 'WARNING|VIZA-OFFLINE|FUTURE-FLAG' }), error: null });
    render(<VizaStatusCard hotelId="hotel-01" report />);
    expect(await screen.findByText('WARNING')).toBeInTheDocument();
    expect(screen.getByText('pms.viza.flag.VIZA-OFFLINE')).toBeInTheDocument();
    expect(screen.getByText('FUTURE-FLAG')).toBeInTheDocument();
    expect(screen.getByText('pms.viza.notifyOperator')).toBeInTheDocument();
  });
  it('loads both lists, renders extra fields and empty list, then displays a refresh error', async () => {
    const status = reportFixture();
    mocks.invoke.mockImplementation(async (_name, { body }) => body.action === 'status'
      ? { data: status, error: null }
      : { data: { ok: true, lists: {
        NEMBEKULDOTT: { eredmenyKod: 'OK', items: [{ uzenetAzonosito: 'message-123', adatszolgaltatasiAzonosito: 'NTAK1234', hibaUzenet: 'Waiting', extra: 'extra-value' }] },
        HIBAS: { eredmenyKod: 'OK', items: [] },
      } }, error: null });
    render(<VizaStatusCard hotelId="hotel-01" report />);
    fireEvent.click(await screen.findByRole('button', { name: 'pms.viza.messageLists' }));
    expect(await screen.findByText('message-123')).toBeInTheDocument();
    expect(screen.getByText('NTAK1234')).toBeInTheDocument();
    expect(screen.getByText('extra-value')).toBeInTheDocument();
    expect(screen.getByText('pms.viza.noMessages')).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith('viza-thf', { body: { action: 'unsent_list', hotel_id: 'hotel-01' } });
    mocks.invoke.mockResolvedValue({ data: { ok: false, error: 'THF unavailable' }, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'pms.fd.refresh' }));
    expect(await screen.findByText('THF unavailable')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'pms.fd.refresh' })).toBeEnabled());
  });
  it('shows booking, arrival/departure times and distinct full receipt IDs', async () => {
    mocks.invoke.mockResolvedValue({ data: reportFixture({}, [{
      id: 'event', guest_name: 'Test Guest', reservation_number: 'RES-123', arrival_state: 'sent', departure_state: 'sent',
      erkezes_ideje: '2026-11-24T20:00:01Z', tavozas_ideje: '2026-11-24T21:00:02Z', updated_at: '2026-11-24T22:04:01Z',
      arrival_fogadas_azonosito: 'arrival-12345678', departure_fogadas_azonosito: 'departure-12345678',
    }]), error: null });
    render(<VizaStatusCard hotelId="hotel-01" report />);
    expect(await screen.findByText('RES-123 · Test Guest')).toBeInTheDocument();
    expect(screen.getByText(/pms.rep.arrivals.*21:00:01/)).toBeInTheDocument();
    expect(screen.getByText(/pms.rep.departures.*22:00:02/)).toBeInTheDocument();
    expect(screen.getByTitle('arrival-12345678')).toHaveTextContent('arrival-…');
    expect(screen.getByTitle('departure-12345678')).toHaveTextContent('departur…');
    expect(screen.getAllByRole('button', { name: 'pms.viza.copyReceipt' })).toHaveLength(2);
  });
  it('does not expose the lists button to non-managers', async () => {
    mocks.invoke.mockResolvedValue({ data: reportFixture({}, [], false), error: null });
    render(<VizaStatusCard hotelId="hotel-01" report />);
    expect(await screen.findByText('OK')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'pms.viza.messageLists' })).not.toBeInTheDocument();
  });
});
