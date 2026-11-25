import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReservationNotesPanel } from '../ReservationNotesPanel';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const STORED = `Recepce - VCC</br></br>Systém - <span classcontainer-1>Partner <span classvalue-1>Booking.com XML</span></span><br><span classcontainer-2>Total price <span classvalue-2>300.19 EUR</span></span><br><span classcontainer-8>Note <span classvalue-8>Special requestssmoking preference Non-Smoking</span></span><br><span classcontainer-9>Comment <span classvalue-9>You may charge it as of 2026-11-09.</span></span><br><span classcontainer-20>Arrival time <span classvalue-20>after 22:00</span></span>`;

describe('ReservationNotesPanel', () => {
  it('shows a Previo note as structured sections without raw markup', () => {
    const { container } = render(<ReservationNotesPanel specialRequests={STORED} internalNotes={null} />);
    expect(screen.getByText('Booking.com')).toBeTruthy();
    expect(screen.getByText('pms.notes.nonSmoking')).toBeTruthy();
    expect(screen.getByText('300.19 EUR')).toBeTruthy();
    expect(screen.getByText('Arrival time')).toBeTruthy();
    expect(screen.getByText('after 22:00')).toBeTruthy();
    expect(container.textContent).not.toMatch(/classvalue|classcontainer|<span/);
  });

  it('shows a plain note as before', () => {
    render(<ReservationNotesPanel specialRequests="Late arrival around 23:00" internalNotes="VIP" />);
    expect(screen.getByText('Late arrival around 23:00')).toBeTruthy();
    expect(screen.getByText('VIP')).toBeTruthy();
  });

  it('renders nothing when there are no notes', () => {
    const { container } = render(<ReservationNotesPanel specialRequests="  " internalNotes={null} />);
    expect(container.innerHTML).toBe('');
  });
});
