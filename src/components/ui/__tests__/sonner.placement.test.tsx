// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toaster } from '../sonner';

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

vi.mock('sonner', () => ({
  Toaster: ({ position, offset, mobileOffset, closeButton, visibleToasts, style }: {
    position?: string;
    offset?: string;
    mobileOffset?: string;
    closeButton?: boolean;
    visibleToasts?: number;
    style?: { zIndex?: number };
  }) => (
    <div
      data-testid="notification-toaster"
      data-position={position}
      data-offset={offset}
      data-mobile-offset={mobileOffset}
      data-close-button={String(closeButton)}
      data-visible-toasts={String(visibleToasts)}
      data-z-index={String(style?.zIndex)}
    />
  ),
  toast: vi.fn(),
}));

describe('global notification placement', () => {
  it('keeps toasts visible below the header and away from the Mira bottom-right launcher', () => {
    render(<Toaster />);

    const toaster = screen.getByTestId('notification-toaster');
    expect(toaster.getAttribute('data-position')).toBe('bottom-left');
    expect(toaster.getAttribute('data-offset')).toBe('20px');
    expect(toaster.getAttribute('data-mobile-offset')).toBe('16px');
    expect(toaster.getAttribute('data-close-button')).toBe('true');
    expect(toaster.getAttribute('data-visible-toasts')).toBe('1');
    // Dialogs remain above non-critical background notifications.
    expect(toaster.getAttribute('data-z-index')).toBe('40');
  });
});
