import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: 'en' }) }));
vi.mock('@/lib/budapestTime', () => ({ todayBudapest: () => '2026-10-25' }));

import { SlntSimpleAvailabilityCalendar } from './SlntSimpleAvailabilityCalendar';

const dates = Array.from({ length: 14 }, (_, i) => {
  const day = new Date('2026-10-25T12:00:00');
  day.setDate(day.getDate() + i);
  return day.toISOString().slice(0, 10);
});
const data = dates.flatMap(date => [
  { user_id: 'cleaner-1', staff_name: 'Carmen', work_date: date,
    is_working: date !== '2026-10-25', absence_kind: date === '2026-10-25' ? 'day_off' : null,
    activity_state: 'off' },
  { user_id: 'cleaner-2', staff_name: 'Imre', work_date: date,
    is_working: true, absence_kind: null, activity_state: date === '2026-10-25' ? 'not_online' : 'planned' },
]);

describe('SLNT Team B 14-day availability', () => {
  it('shows a space-saving 14-day grid with an editable Working / Off button per cell', async () => {
    rpc.mockResolvedValue({ data, error: null });
    const { container, unmount } = render(<SlntSimpleAvailabilityCalendar compact />);
    await screen.findByText('Carmen');
    await waitFor(() => expect(container.querySelectorAll('[data-training="slnt-availability-person"]')).toHaveLength(2));
    expect(container.querySelector('table')).toBeInTheDocument();
    expect(container.querySelectorAll('thead th')).toHaveLength(15);
    expect(screen.getByText('Today: 1/2')).toBeInTheDocument();
    expect(screen.getByText('Not yet online today')).toBeInTheDocument();
    const future = screen.getByRole('button', { name: 'Imre 2026-10-26: Working' });
    expect(future).toBeEnabled();
    fireEvent.click(future);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('slnt_team_b_set_availability_v4', {
      p_user_id: 'cleaner-2', p_work_date: '2026-10-26', p_absence_kind: 'day_off',
    }));
    expect(screen.getByRole('button', { name: 'Carmen 2026-10-25: Day off' })).toHaveAttribute('aria-pressed', 'false');
    unmount();
  });

  it('retains full scheduling options and table for non-compact view', async () => {
    rpc.mockResolvedValue({ data, error: null });
    const { container, unmount } = render(<SlntSimpleAvailabilityCalendar />);
    await waitFor(() => expect(container.querySelector('table')).toBeInTheDocument());
    expect(container.querySelectorAll('thead th')).toHaveLength(8);
    expect(container.querySelectorAll('[data-training="slnt-availability-person"]')).toHaveLength(0);
    expect(container.querySelector('[data-training="slnt-working-defaults"]')).toHaveClass('overflow-x-auto');
    unmount();
  });
});
