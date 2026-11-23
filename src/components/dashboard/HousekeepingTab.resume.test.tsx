import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HousekeepingTab } from './HousekeepingTab';

const mocks = vi.hoisted(() => ({ read: vi.fn(), unmounted: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({
  user: { id: 'cleaner-1' },
  profile: { role: 'housekeeping', assigned_hotel: 'gozsdu-court', organization_slug: 'rdhotels' },
}) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: 'en' }) }));
vi.mock('@/lib/budapestTime', () => ({ todayBudapest: () => '2026-11-23' }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => {
    const query = { select: () => query, eq: () => query, maybeSingle: mocks.read };
    return query;
  },
  channel: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    return channel;
  },
  removeChannel: vi.fn(),
} }));

function WorkForm() {
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState('');
  useEffect(() => () => mocks.unmounted(), []);
  return <div>
    <input aria-label="Unfinished room note" value={note} onChange={event => setNote(event.target.value)} />
    <input aria-label="Camera photo" type="file" capture="environment"
      onChange={event => setPhoto(event.target.files?.[0]?.name || '')} />
    <output aria-label="Selected camera photo">{photo}</output>
  </div>;
}
vi.mock('./HousekeepingTabEnhanced', () => ({ HousekeepingTabEnhanced: () => <WorkForm /> }));
vi.mock('./GozsduLaundrynerTasksV2', () => ({ GozsduLaundrynerTasksV2: () => <WorkForm /> }));
vi.mock('./GozsduLinenCollectionBreakdown', () => ({ GozsduLinenCollectionBreakdown: () => null }));
vi.mock('@/components/insuite/InSuiteAssignedRequests', () => ({ InSuiteAssignedRequests: () => null }));

describe('Gozsdu personal work survives duty refreshes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.read.mockReset().mockResolvedValue({ data: null, error: null });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it.each([false, true])('keeps the draft and camera input after an offline return (laundry duty: %s)', async activeDuty => {
    const duty = activeDuty ? { user_id: 'cleaner-1' } : null;
    mocks.read.mockResolvedValue({ data: duty, error: null });
    render(<HousekeepingTab />);
    const note = await screen.findByRole('textbox', { name: 'Unfinished room note' });
    fireEvent.change(note, { target: { value: 'Finish this room' } });
    const input = screen.getByLabelText('Camera photo');
    mocks.read.mockResolvedValueOnce({ data: null, error: { code: 'NETWORK', message: 'Offline' } });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.getByRole('textbox')).toBe(note);
    expect(note).toHaveValue('Finish this room');
    expect(screen.getByLabelText('Camera photo')).toBe(input);
    fireEvent.change(input, { target: { files: [new File(['photo'], 'room.jpg')] } });
    expect(screen.getByLabelText('Selected camera photo')).toHaveTextContent('room.jpg');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(note).toHaveValue('Finish this room');
    expect(mocks.unmounted).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledTimes(3);
  });

  it('keeps unfinished work on a failed background poll', async () => {
    vi.useFakeTimers();
    await act(async () => { render(<HousekeepingTab />); });
    const note = screen.getByRole('textbox');
    fireEvent.change(note, { target: { value: 'Draft during poll' } });
    mocks.read.mockResolvedValueOnce({ data: null, error: { message: 'Offline' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(note).toHaveValue('Draft during poll');
    expect(mocks.unmounted).not.toHaveBeenCalled();
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('still blocks initial access on a failed duty verification and allows retry', async () => {
    mocks.read.mockResolvedValueOnce({ data: null, error: { message: 'Offline' } });
    render(<HousekeepingTab />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    await screen.findByRole('textbox');
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
});