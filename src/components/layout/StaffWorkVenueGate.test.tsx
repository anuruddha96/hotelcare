import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffWorkVenueGate } from './StaffWorkVenueGate';

const mocks = vi.hoisted(() => ({
  role: 'housekeeping',
  read: vi.fn(),
  applyAssignedHotel: vi.fn(),
  unmounted: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'staff-1' },
    profile: { role: mocks.role, assigned_hotel: 'memories-budapest' },
    applyAssignedHotel: mocks.applyAssignedHotel,
  }),
}));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ hotels: [], loading: false }),
}));
vi.mock('@/lib/budapestTime', () => ({ todayBudapest: () => '2026-11-23' }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }) }),
  },
}));

const venue = {
  home_hotel: 'memories-budapest',
  last_worked_hotel: 'memories-budapest',
  last_switched_on: null,
  prompt_next_day: false,
};
type ReadResult = { data: typeof venue | null; error: { message: string } | null };

function OpenRoom() {
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState('');
  useEffect(() => () => mocks.unmounted(), []);
  return <div>
    <input aria-label="Room note" value={note} onChange={event => setNote(event.target.value)} />
    <input aria-label="Room photo" type="file" accept="image/*" capture="environment"
      onChange={event => setPhoto(event.target.files?.[0]?.name || '')} />
    <output aria-label="Selected photo">{photo}</output>
  </div>;
}

async function openRoom() {
  render(<StaffWorkVenueGate><OpenRoom /></StaffWorkVenueGate>);
  await screen.findByRole('textbox', { name: 'Room note' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Room note' }), { target: { value: 'Keep this draft' } });
}

function resume() {
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('staff work venue resume checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = 'housekeeping';
    mocks.read.mockReset().mockResolvedValue({ data: venue, error: null });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it.each(['housekeeping', 'maintenance', 'maintenance_manager'])('keeps %s drafts and camera input mounted during and after resume', async role => {
    mocks.role = role;
    await openRoom();
    const input = screen.getByLabelText('Room photo');
    let finish: ((result: ReadResult) => void) | undefined;
    mocks.read.mockReturnValueOnce(new Promise<ReadResult>(resolve => { finish = resolve; }));
    act(resume);
    expect(screen.getByRole('textbox', { name: 'Room note' })).toHaveValue('Keep this draft');
    expect(screen.getByLabelText('Room photo')).toBe(input);
    expect(mocks.unmounted).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { files: [new File(['photo'], 'room.jpg', { type: 'image/jpeg' })] } });
    await act(async () => { finish?.({ data: venue, error: null }); });
    expect(screen.getByLabelText('Selected photo')).toHaveTextContent('room.jpg');
    expect(screen.getByRole('textbox', { name: 'Room note' })).toHaveValue('Keep this draft');
    expect(mocks.unmounted).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it.each(['returned error', 'rejected request'])('preserves active work after a background %s', async failure => {
    await openRoom();
    if (failure === 'returned error') mocks.read.mockResolvedValueOnce({ data: null, error: { message: 'Offline' } });
    else mocks.read.mockRejectedValueOnce(new Error('Offline'));
    await act(async () => { resume(); });
    expect(screen.getByRole('textbox', { name: 'Room note' })).toHaveValue('Keep this draft');
    expect(mocks.unmounted).not.toHaveBeenCalled();
  });

  it('retains the initial verification and retry gate', async () => {
    mocks.read.mockResolvedValueOnce({ data: null, error: { message: 'Offline' } });
    render(<StaffWorkVenueGate><OpenRoom /></StaffWorkVenueGate>);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await screen.findByRole('textbox', { name: 'Room note' });
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('still requires next-day confirmation when the server says it is due', async () => {
    await openRoom();
    mocks.read.mockResolvedValueOnce({ data: { ...venue, last_switched_on: '2026-11-22', prompt_next_day: true }, error: null });
    await act(async () => { resume(); });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(mocks.unmounted).toHaveBeenCalledTimes(1);
  });

  it('still applies server-authorized hotel changes on switch events', async () => {
    await openRoom();
    mocks.read.mockResolvedValueOnce({ data: { ...venue, last_worked_hotel: 'ottofiori' }, error: null });
    await act(async () => { window.dispatchEvent(new Event('hotelcare:staff-work-venue-switched')); });
    expect(mocks.applyAssignedHotel).toHaveBeenLastCalledWith('ottofiori');
    expect(screen.getByRole('textbox', { name: 'Room note' })).toHaveValue('Keep this draft');
  });

  it('does not query when hidden or for management roles outside the gate', async () => {
    await openRoom();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(resume);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    cleanup();
    mocks.read.mockClear();
    mocks.role = 'manager';
    render(<StaffWorkVenueGate><OpenRoom /></StaffWorkVenueGate>);
    act(resume);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
    expect(mocks.read).not.toHaveBeenCalled();
  });
});