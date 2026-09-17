import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const auth = vi.hoisted(() => ({
  profile: {
    current: {
      organization_slug: 'rdhotels',
      assigned_hotel: 'gozsdu-court' as string | null,
    },
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ profile: auth.profile.current }),
}));

vi.mock('./HousekeepingRoomSettings', () => ({
  HousekeepingRoomSettings: () => <div>Room settings</div>,
}));

// Simulate hotel-specific data retained by the approvals/staff workspace.
vi.mock('./HousekeepingTabLegacy', () => ({
  HousekeepingTab: () => {
    const [visibleRows, setVisibleRows] = React.useState(0);
    return (
      <div>
        <span data-testid="visible-rows">{visibleRows}</span>
        <button onClick={() => setVisibleRows(count => count + 1)}>Add approval row</button>
      </div>
    );
  },
}));

import { HousekeepingTabEnhanced } from './HousekeepingTabEnhanced';

afterEach(() => {
  cleanup();
  auth.profile.current = { organization_slug: 'rdhotels', assigned_hotel: 'gozsdu-court' };
});

describe('housekeeping venue workspace isolation', () => {
  it('unmounts old approval/staff state when a top manager changes hotels', () => {
    const view = render(<HousekeepingTabEnhanced />);
    fireEvent.click(screen.getByRole('button', { name: 'Add approval row' }));
    expect(screen.getByTestId('visible-rows').textContent).toBe('1');

    auth.profile.current = { organization_slug: 'rdhotels', assigned_hotel: 'ottofiori' };
    view.rerender(<HousekeepingTabEnhanced />);
    expect(screen.getByTestId('visible-rows').textContent).toBe('0');
  });

  it('fails closed when there is no selected venue', () => {
    auth.profile.current = { organization_slug: 'rdhotels', assigned_hotel: null };
    render(<HousekeepingTabEnhanced />);
    expect(screen.getByRole('status').textContent).toContain('Select a hotel');
    expect(screen.queryByTestId('visible-rows')).toBeNull();
  });
});
