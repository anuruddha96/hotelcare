import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from, eq, lte, rows } = vi.hoisted(() => ({
  from: vi.fn(), eq: vi.fn(), lte: vi.fn(),
  rows: { data: [{ work_date: '2026-10-27', absence_kind: 'day_off' }], error: null },
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'cleaner-1' } }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: 'en' }) }));
vi.mock('@/lib/budapestTime', () => ({ todayBudapest: () => '2026-10-26' }));

import { SlntTeamBMySchedule } from './SlntTeamBMySchedule';

describe('Team B employee availability', () => {
  beforeEach(() => {
    const query = { select: vi.fn(), eq, gte: vi.fn(), lte };
    query.select.mockReturnValue(query);
    eq.mockReturnValue(query);
    query.gte.mockReturnValue(query);
    lte.mockResolvedValue(rows);
    from.mockReturnValue(query);
  });

  it('shows Working with no leave even though there is no published shift', async () => {
    const { container, unmount } = render(<SlntTeamBMySchedule />);
    await waitFor(() => expect(container.querySelectorAll('[data-training="slnt-my-scheduled-day"]')).toHaveLength(3));
    expect(from).toHaveBeenCalledWith('slnt_team_b_days_off');
    expect(eq).toHaveBeenCalledWith('user_id', 'cleaner-1');
    expect(screen.getAllByText('Working')).toHaveLength(2);
    expect(screen.getByText('Day off')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 14 days' }));
    expect(container.querySelectorAll('[data-training="slnt-my-scheduled-day"]')).toHaveLength(14);
    unmount();
  });
});
