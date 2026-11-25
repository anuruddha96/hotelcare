import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  dismiss: vi.fn(),
  markSeen: vi.fn(),
}));

vi.mock('@/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({
    banner: [{
      id: 'upgrade-announcement',
      title: 'Free room upgrades',
      body: 'A larger room can be offered as a free upgrade.',
      tone: 'info',
      compact: true,
      seen: false,
      dismissed: false,
    }],
    dismiss: mocks.dismiss,
    markSeen: mocks.markSeen,
  }),
}));

import { SystemAnnouncementBanner } from './SystemAnnouncementBanner';

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('compact system announcement acknowledgement', () => {
  it('acknowledges and dismisses the selected announcement on Got it', async () => {
    render(<SystemAnnouncementBanner />);

    // Opening the explanation is not an acknowledgement.
    fireEvent.click(screen.getByRole('button', { name: 'How it works' }));
    expect(screen.getByText('A larger room can be offered as a free upgrade.')).toBeInTheDocument();
    expect(mocks.dismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(mocks.dismiss).toHaveBeenCalledExactlyOnceWith('upgrade-announcement');
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument();
    });
  });

  it('does not dismiss when the explanation is merely closed', () => {
    render(<SystemAnnouncementBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'How it works' }));
    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(mocks.dismiss).not.toHaveBeenCalled();
  });

  it('preserves dismiss from the short banner close button', () => {
    render(<SystemAnnouncementBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Free room upgrades' }));
    expect(mocks.dismiss).toHaveBeenCalledExactlyOnceWith('upgrade-announcement');
  });
});
