import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VizaGuestRecoveryCard } from './VizaGuestRecoveryCard';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/frontdesk/GuestDetailsSection', () => ({
  GuestDetailsSection: ({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) => <>
    <input aria-label="Birth place" onChange={() => onDirtyChange(true)} />
    <button onClick={() => onDirtyChange(false)}>Save</button>
  </>,
}));
describe('VizaGuestRecoveryCard', () => {
  it('shows the THF rejection and cannot requeue until corrections are saved', async () => {
    mocks.invoke.mockImplementation(async (_name, { body }) => ({ error: null, data: body.action === 'desk_status'
      ? { ok: true, total: 1, events: [{ id: 'event-1', guest_id: 'guest-1', reservation_id: 'reservation-1', guest_name: 'Test Guest', reservation_number: 'RES-123', last_error: 'THF EF0051: Születési hely túl hosszú.' }] }
      : { ok: true } }));
    render(<VizaGuestRecoveryCard hotelId="hotel-1" />);
    expect(await screen.findByText('THF EF0051: Születési hely túl hosszú.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'pms.stayGuest.details' }));
    const send = screen.getByRole('button', { name: 'pms.viza.sendAgain' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Birth place' }), { target: { value: 'Budapest' } });
    expect(send).toBeDisabled();
    expect(screen.getByText('pms.viza.saveCorrections')).toBeInTheDocument();
    fireEvent.click(send);
    expect(mocks.invoke.mock.calls.some(([, options]) => options.body.action === 'desk_retry')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('viza-thf', { body: { action: 'desk_retry', hotel_id: 'hotel-1', event_id: 'event-1' } }));
  });
});
