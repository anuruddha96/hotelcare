import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: 'en' }) }));
vi.mock('@/lib/budapestTime', () => ({ todayBudapest: () => '2026-10-25' }));

import { SlntSimpleAvailabilityCalendar } from './SlntSimpleAvailabilityCalendar';

const data = [
  { user_id: 'cleaner-1', staff_name: 'Carmen', work_date: '2026-10-25',
    is_working: false, absence_kind: 'day_off', activity_state: 'off' },
  { user_id: 'cleaner-2', staff_name: 'Imre', work_date: '2026-10-25',
    is_working: true, absence_kind: null, activity_state: 'not_online' },
];

describe('SLNT Team B availability on narrow screens', () => {
  it('renders compact staff cards without a forced-width table and keeps editable day status', async () => {
    rpc.mockResolvedValue({ data, error: null });
    const { container, unmount } = render(<SlntSimpleAvailabilityCalendar compact />);
    await screen.findByText('Carmen');
    await waitFor(() => expect(container.querySelectorAll('[data-training="slnt-availability-person"]')).toHaveLength(2));

    expect(container.querySelector('table')).not.toBeInTheDocument();
    expect(screen.getByText('Not yet online today')).toBeInTheDocument();
    expect(screen.getByText('Scheduled: 1/2')).toBeInTheDocument();
    const imreSelect = screen.getByRole('combobox', { name: 'Imre 2026-10-25' });
    expect(imreSelect).toBeEnabled();
    expect(imreSelect).toHaveClass('min-w-0');
    expect(screen.getByRole('combobox', { name: 'Carmen 2026-10-25' })).toBeEnabled();
    unmount();
  });

  it('retains the week table for the full scheduling view', async () => {
    rpc.mockResolvedValue({ data, error: null });
    const { container, unmount } = render(<SlntSimpleAvailabilityCalendar />);
    await waitFor(() => expect(container.querySelector('table')).toBeInTheDocument());
    expect(container.querySelectorAll('[data-training="slnt-availability-person"]')).toHaveLength(0);
    expect(container.querySelector('[data-training="slnt-working-defaults"]')).toHaveClass('overflow-x-auto');
    unmount();
  });
});
