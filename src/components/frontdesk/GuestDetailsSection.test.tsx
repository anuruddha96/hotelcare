import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GuestDetailsSection, type GuestVizaRow } from './GuestDetailsSection';
import { useStayGuestRoster } from './StayGuestRoster';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: mocks }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/frontdesk/IdScanDialog', () => ({ IdScanDialog: () => null }));
vi.mock('@/components/guests/GuestSearchSelect', () => ({ GuestSearchSelect: () => null }));
vi.mock('@/lib/pmsLifecycle', () => ({ addStayGuest: vi.fn(), guestTransitionReservation: vi.fn() }));

const guest: GuestVizaRow = {
  id: 'guest-1', first_name: 'Test', last_name: 'Guest',
  nationality: null, birth_last_name: null, birth_first_name: null,
  mother_name: null, date_of_birth: '1990-01-01', birth_place: 'Budapest',
  gender: 'female', id_document_type: 'passport', id_document_number: 'TEST123',
  visa_number: null, entry_date: null, entry_place: null,
};

beforeEach(() => vi.clearAllMocks());

describe('in-dialog guest registration repair', () => {
  it('opens an incomplete guest form, saves the repair and keeps the editor accessible', async () => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), update: vi.fn() };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({ data: guest, error: null });
    query.update.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mocks.from.mockReturnValue(query);
    const onCompletenessChange = vi.fn();
    const onSaved = vi.fn();
    render(<GuestDetailsSection guestId={guest.id} onCompletenessChange={onCompletenessChange} onSaved={onSaved} />);

    await screen.findByPlaceholderText('HU / DE / USA…');
    const toggle = screen.getByRole('button', { name: /pms.guest.detailsTitle/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(onCompletenessChange).toHaveBeenLastCalledWith(['nationality']);

    fireEvent.click(toggle);
    expect(screen.queryByPlaceholderText('HU / DE / USA…')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.change(screen.getByPlaceholderText('HU / DE / USA…'), { target: { value: 'HU' } });
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'pms.guest.save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...guest, nationality: 'HU' }));
    expect(onCompletenessChange).toHaveBeenLastCalledWith([]);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByPlaceholderText('HU / DE / USA…')).toHaveValue('HU');
  });

  it('revalidates only the saved roster guest without resetting selected arrivals', async () => {
    const other = { ...guest, id: 'guest-2', nationality: 'HU' };
    const rows = [guest, other].map((g) => ({
      guest_id: g.id, stay_state: 'expected', arrived_at: null,
      departed_at: null, room_id: null, guests: g,
    }));
    const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn() };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockResolvedValue({ data: rows, error: null });
    mocks.from.mockReturnValue(query);
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const { result } = renderHook(() => useStayGuestRoster('res-1', 'hotel-1', true, 'arrive'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setSelectedIds([guest.id]));
    expect(result.current.incompleteSelected).toBe(1);
    act(() => result.current.updateSavedGuest({ ...guest, nationality: 'HU' }));
    expect(result.current.incompleteSelected).toBe(0);
    expect(result.current.selectedIds).toEqual([guest.id]);
    expect(result.current.guests).toHaveLength(2);
  });
});
