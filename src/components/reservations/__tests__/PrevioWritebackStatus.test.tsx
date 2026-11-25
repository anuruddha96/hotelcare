import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const rows: any[] = [];
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: rows, error: null }) }) }) }) },
}));

import { PrevioWritebackStatus } from '../PrevioWritebackStatus';

describe('PrevioWritebackStatus', () => {
  it('renders nothing when write-back is off (no jobs)', async () => {
    rows.length = 0;
    const { container } = render(<PrevioWritebackStatus reservationId="r1" />);
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });

  it('shows sent, test-mode and failed states with the reason', async () => {
    rows.length = 0;
    rows.push(
      { id: '1', action: 'check_in', status: 'failed', attempts: 1, last_error: 'Guest profile is incomplete', sent_at: null, updated_at: '' },
      { id: '2', action: 'check_out', status: 'dry_run', attempts: 0, last_error: null, sent_at: null, updated_at: '' },
    );
    render(<PrevioWritebackStatus reservationId="r1" />);
    expect(await screen.findByText(/Guest profile is incomplete/)).toBeTruthy();
    expect(screen.getByText(/pms.wb.doInPrevio/)).toBeTruthy();
    expect(screen.getByText(/pms.wb.dryRun/)).toBeTruthy();
  });
});
