import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VizaGuestRecoveryCard } from './VizaGuestRecoveryCard';
import { announceVizaRejected } from '@/lib/viza/vizaDesk';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/frontdesk/GuestDetailsSection', () => ({
  GuestDetailsSection: ({ onSavePendingChange, focusProblem }: { onSavePendingChange: (pending: boolean) => void; focusProblem?: { field: string } | null }) => <>
    <input aria-label="Birth place" data-focus={focusProblem?.field ?? ''} onChange={() => onSavePendingChange(true)} />
    <button onClick={() => onSavePendingChange(false)}>Autosaved</button>
  </>,
}));

const rejected = { id: 'event-1', guest_id: 'guest-1', reservation_id: 'reservation-1', guest_name: 'Test Guest', reservation_number: 'RES-123', last_error: 'THF EF0051: Születési hely túl hosszú.' };

function desk(sendNow: Record<string, unknown>, status: Record<string, unknown> = { ok: true, total: 1, events: [rejected], outage: null }) {
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (_name, { body }) => ({ error: null, data:
    body.action === 'desk_status' ? status
      : body.action === 'desk_send_now' ? sendNow
        : { ok: true } }));
}
const calls = (action: string) => mocks.invoke.mock.calls.filter(([, options]) => options.body.action === action);

describe('VizaGuestRecoveryCard', () => {
  it('lists the guest with a plain reason only, then fixes and sends in one step with the result shown', async () => {
    desk({ ok: true, enabled: true, results: [{ event_id: 'event-1', phase: 'arrival', outcome: 'accepted', receipt: 'receipt-123', error: null, guest_name: 'Test Guest', reservation_number: 'RES-123' }] });
    render(<VizaGuestRecoveryCard hotelId="hotel-1" />);
    expect(await screen.findByText('pms.viza.reason.tooLong')).toBeInTheDocument();
    expect(screen.queryByText(/THF EF0051/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'pms.viza.fix.open' }));
    expect(await screen.findByText('pms.viza.fix.title')).toBeInTheDocument();
    // The official answer stays visible in small print, and the form jumps to the field VIZA named.
    expect(screen.getByText(/pms.viza.fix.thfAnswer: THF EF0051/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Birth place' })).toHaveAttribute('data-focus', 'birth_place');

    // Still saving: the send waits for the save, then goes out by itself.
    fireEvent.change(screen.getByRole('textbox', { name: 'Birth place' }), { target: { value: 'Gibraltar' } });
    fireEvent.click(screen.getByRole('button', { name: 'pms.viza.fix.saveAndSend' }));
    expect(calls('desk_retry')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Autosaved' }));
    await waitFor(() => expect(calls('desk_send_now')).toHaveLength(1));
    expect(calls('desk_retry')[0][1].body).toEqual({ action: 'desk_retry', hotel_id: 'hotel-1', event_id: 'event-1' });
    expect(calls('desk_send_now')[0][1].body).toMatchObject({ action: 'desk_send_now', hotel_id: 'hotel-1', event_id: 'event-1', phase: 'arrival' });
    expect(await screen.findByText('pms.viza.fix.accepted')).toBeInTheDocument();
    expect(screen.getByText(/receipt-123/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'pms.viza.fix.done' })).toBeInTheDocument();
  });

  it('says when VIZA still refuses the data, so the user can correct and send again', async () => {
    desk({ ok: true, enabled: true, results: [{ event_id: 'event-1', phase: 'arrival', outcome: 'rejected', receipt: null, error: 'THF EF0051: Születési hely túl hosszú.', guest_name: 'Test Guest', reservation_number: 'RES-123' }] });
    render(<VizaGuestRecoveryCard hotelId="hotel-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'pms.viza.fix.open' }));
    fireEvent.click(await screen.findByRole('button', { name: 'pms.viza.fix.saveAndSend' }));
    expect(await screen.findByText('pms.viza.fix.stillRejected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'pms.viza.fix.saveAndSend' })).toBeEnabled();
  });

  it('opens the correction popup by itself when an instant send reports a rejection', async () => {
    desk({ ok: true, enabled: true, results: [] });
    render(<VizaGuestRecoveryCard hotelId="hotel-1" />);
    await screen.findByText('pms.viza.reason.tooLong');
    expect(screen.queryByText('pms.viza.fix.title')).not.toBeInTheDocument();
    act(() => announceVizaRejected({ hotelId: 'hotel-1', eventIds: ['event-1'] }));
    expect(await screen.findByText('pms.viza.fix.title')).toBeInTheDocument();
  });

  it('tells reception in plain words when VIZA cannot be reached, with nothing to correct', async () => {
    desk({ ok: true }, { ok: true, total: 0, events: [], outage: { since: '2026-11-25T13:50:00Z', last_attempt_at: '2026-11-25T13:54:01Z', next_try_at: '2999-01-01T00:00:00Z', waiting: 2, support_notified_at: null } });
    render(<VizaGuestRecoveryCard hotelId="hotel-1" />);
    expect(await screen.findByText('pms.viza.outageTitle')).toBeInTheDocument();
    expect(screen.getByText('pms.viza.outageDesk')).toBeInTheDocument();
    expect(screen.getByText('pms.viza.outageQueued')).toBeInTheDocument();
    expect(screen.getByText('pms.viza.outageNextTryAt')).toBeInTheDocument();
    expect(screen.getByText('pms.viza.outageAction')).toBeInTheDocument();
  });
});
