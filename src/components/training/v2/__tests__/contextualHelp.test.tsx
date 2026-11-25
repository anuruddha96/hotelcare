import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { ALL_CURRICULA } from '../curricula';
import type { ScreenMatch } from '../screenContext';

// Radix dropdown + framer-motion need a few browser APIs jsdom lacks.
beforeEach(() => {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { value: () => {}, configurable: true });
  window.ResizeObserver = window.ResizeObserver || (class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver);
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture || (() => false);
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture || (() => {});
});

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ organizationSlug: 'rdhotels' }),
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
    const { initial: _i, animate: _a, exit: _e, transition: _t, ...dom } = rest as Record<string, unknown>;
    return <div {...(dom as Record<string, string>)}>{children}</div>;
  } }),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const first = ALL_CURRICULA.find((c) => c.slug === 'v2_housekeeper_first_day')!;
const door = ALL_CURRICULA.find((c) => c.slug === 'v2_housekeeper_at_the_door')!;
const tx = (t: Record<string, string | undefined>, lang: string) => t[lang] || t.en!;

const ctx = {
  availableCurricula: [first, door],
  completion: { [first.slug]: 'in_progress' } as Record<string, 'done' | 'in_progress' | 'available'>,
  statuses: { [first.slug]: { slug: first.slug, status: 'in_progress', currentStep: 4, totalSteps: first.steps.length } },
  onThisScreen: [] as ScreenMatch[],
  start: vi.fn(),
  startForScreen: vi.fn(),
  registerLauncher: vi.fn(),
  lang: 'en',
  nudge: null as ScreenMatch | null,
  acceptNudge: vi.fn(),
  declineNudge: vi.fn(),
  reducedMotion: true,
};

vi.mock('../TrainingV2Provider', () => ({
  useTrainingV2Optional: () => ctx,
  useTrainingV2: () => ctx,
  txt: tx,
}));

// jsdom has no PointerEvent, so open the Radix trigger from the keyboard.
const openMenu = (button: HTMLElement) => fireEvent.keyDown(button, { key: 'Enter' });

const { TrainingHelpButtonV2 } = await import('../TrainingHelpButtonV2');
const { TrainingContextNudge } = await import('../TrainingContextNudge');

describe('Help & Training menu is screen-aware', () => {
  it('lists the guides for the current screen first, in their own section, and starts them at the screen step', () => {
    ctx.onThisScreen = [{ curriculum: door, stepKey: 'door_intro', stepIndex: 0 }];
    render(<TrainingHelpButtonV2 />);
    const button = screen.getByRole('button', { name: /help and training/i });
    expect(button).toHaveAttribute('data-training-has-guide', 'true');
    openMenu(button);

    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('On this screen')).toBeInTheDocument();
    const items = within(menu).getAllByRole('menuitem');
    // Contextual guide → Training Center link → remaining guides.
    expect(items[0]).toHaveAttribute('data-training-guide', door.slug);
    expect(items[0]).toHaveTextContent('Show me');
    expect(items[1]).toHaveTextContent('Open Training Center');
    expect(items[2]).toHaveAttribute('data-training-guide', first.slug);
    expect(items[2]).toHaveTextContent('Resume');
    expect(within(menu).getByText('All guides')).toBeInTheDocument();

    fireEvent.click(items[0]);
    expect(ctx.startForScreen).toHaveBeenCalledWith(door.slug);
    // Selecting an item closes the menu; reopen it for the second guide.
    openMenu(button);
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitem')[2]);
    expect(ctx.start).toHaveBeenCalledWith(first.slug, { manual: true });
  });

  it('shows no contextual section or dot when nothing applies to the screen', () => {
    ctx.onThisScreen = [];
    render(<TrainingHelpButtonV2 />);
    const button = screen.getByRole('button', { name: /help and training/i });
    expect(button).not.toHaveAttribute('data-training-has-guide');
    openMenu(button);
    const menu = screen.getByRole('menu');
    expect(within(menu).queryByText('On this screen')).toBeNull();
    expect(within(menu).queryByText('All guides')).toBeNull();
    expect(within(menu).getAllByRole('menuitem')[0]).toHaveTextContent('Open Training Center');
  });

  it('speaks the user language', () => {
    ctx.onThisScreen = [{ curriculum: door, stepKey: 'door_intro', stepIndex: 0 }];
    ctx.lang = 'hu';
    try {
    render(<TrainingHelpButtonV2 />);
    const button = screen.getByRole('button', { name: /Súgó és képzés/ });
    openMenu(button);
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Ezen a képernyőn')).toBeInTheDocument();
    expect(within(menu).getByText('Képzési központ megnyitása')).toBeInTheDocument();
    expect(within(menu).getByText(/Mutasd/)).toBeInTheDocument();
    } finally {
      ctx.lang = 'en';
    }
  });
});

describe('Contextual nudge', () => {
  it('offers the guide with one tap to start and one to snooze', () => {
    ctx.nudge = { curriculum: door, stepKey: 'door_intro', stepIndex: 0 };
    render(<TrainingContextNudge />);
    expect(screen.getByRole('status')).toHaveTextContent(door.name.en);
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(ctx.acceptNudge).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(ctx.declineNudge).toHaveBeenCalledTimes(1);
  });

  it('says "continue" for a guide already in progress', () => {
    ctx.nudge = { curriculum: first, stepKey: 'open_my_tasks', stepIndex: 3 };
    render(<TrainingContextNudge />);
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });
});
