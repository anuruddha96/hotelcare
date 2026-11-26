import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LogIn, Users, Waves } from 'lucide-react';
import { ReceptionSideSection, RECEPTION_TONES } from '../ReceptionSideSection';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));

const booking = (i: number) => ({
  id: String(i), pms_guest_name: `Guest ${i}`, check_in_date: '2026-11-26',
  check_out_date: '2026-11-28', source: 'direct', status: 'confirmed',
});

describe('ReceptionSideSection', () => {
  it('distinguishes operational colors and uses a separate urgency line', () => {
    const { container } = render(<ReceptionSideSection tone="pending" title="Unassigned reservations" subtitle="1 arriving soon" icon={Waves} items={[booking(1)]} onOpen={vi.fn()} />);
    const section = container.querySelector('details');
    expect(section?.open).toBe(true);
    expect(section?.dataset.receptionTone).toBe('pending');
    expect(section?.querySelector('summary')?.className).toContain(RECEPTION_TONES.pending.surface);
    expect(screen.getByText('1 arriving soon')).toBeTruthy();
    expect(RECEPTION_TONES.confirmed.accent).toBe('bg-emerald-600');
    expect(RECEPTION_TONES.checkedIn.accent).toBe('bg-sky-600');
  });

  it('keeps empty sections collapsed with a visible zero count', () => {
    const { container } = render(<ReceptionSideSection tone="checkedIn" title="In-house now" icon={Users} items={[]} onOpen={vi.fn()} />);
    expect(container.querySelector('details')?.open).toBe(false);
    expect(container.querySelector('summary')?.textContent).toContain('0');
  });

  it('renders every supplied booking and keeps open and check-in actions separate', () => {
    const open = vi.fn(), action = vi.fn();
    const rows = Array.from({ length: 15 }, (_, i) => booking(i + 1));
    render(<ReceptionSideSection tone="confirmed" title="Arrivals" icon={LogIn} items={rows} onOpen={open} actionLabel="Check in" onAction={action} />);
    fireEvent.click(screen.getByRole('button', { name: /Guest 15/ }));
    expect(open).toHaveBeenCalledWith(rows[14]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Check in' })[14]);
    expect(action).toHaveBeenCalledWith(rows[14]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('keeps snapshot reservations read-only', () => {
    render(<ReceptionSideSection tone="confirmed" title="Arrivals" icon={LogIn} items={[{ ...booking(1), snapshotOnly: true }]} onOpen={vi.fn()} actionLabel="Check in" onAction={vi.fn()} />);
    expect((screen.getByRole('button', { name: /Guest 1/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull();
  });
});
