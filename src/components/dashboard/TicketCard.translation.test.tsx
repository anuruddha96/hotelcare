import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TicketCard } from './TicketCard';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), onClick: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock('@/lib/storageUrls', () => ({ getSignedPhotoUrls: vi.fn(async (paths: string[]) => paths.map(path => `https://images.example/${path}`)) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ profile: { role: 'manager' } }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ language: 'en', t: (key: string) => key }),
}));
vi.mock('./MaintenanceManagerControls', () => ({
  canManageMaintenance: () => false,
  MaintenanceManagerControls: () => null,
}));

function ticket(index: number) {
  return {
    id: `queue-ticket-${index}`, ticket_number: `TEST-${index}`,
    title: `Source title ${index}`, description: `Original issue ${index}`,
    room_number: String(index), priority: 'medium' as const, status: 'open' as const,
    updated_at: '2026-10-14T08:00:00Z', on_hold: false,
    pending_supervisor_approval: false, hold_reason: null,
    sla_due_date: null, resolution_text: null,
    created_at: '2026-10-14T08:00:00Z', department: 'maintenance',
  };
}

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.onClick.mockReset();
});
afterEach(() => cleanup());

describe('maintenance queue cards', () => {
  it('never starts AI translation when a queue of many cards renders', () => {
    render(<>{Array.from({ length: 25 }, (_, index) =>
      <TicketCard key={index} ticket={ticket(index + 200)} onClick={mocks.onClick} />)}</>);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('translates only the selected issue, preserving access to its original', async () => {
    mocks.invoke.mockImplementation(async (_fn: string, { body }: { body: { texts: string[] } }) => ({
      data: { translatedTexts: body.texts.map(text => text ? `English: ${text}` : '') },
      error: null,
    }));
    render(<TicketCard ticket={ticket(300)} onClick={mocks.onClick} />);
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('English: Source title 300')).toBeTruthy();
    expect(mocks.onClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show original' }));
    expect(screen.getByText('Source title 300')).toBeTruthy();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('shows every original and repair photo preview without opening the ticket', async () => {
    render(<TicketCard ticket={{
      ...ticket(401),
      attachment_urls: ['401/issue-one.jpg', '401/issue-two.jpg'],
      completion_photos: ['401/repair.jpg'],
    }} onClick={mocks.onClick} />);
    expect(screen.getByText('Photos (3)')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Original issue photos/ })).toHaveLength(2));
    expect(screen.getAllByRole('button', { name: /After-repair photos/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Original issue photos 1' }));
    expect(mocks.onClick).not.toHaveBeenCalled();
    expect(screen.getAllByAltText('Original issue photos 1').length).toBeGreaterThan(1);
  });

});
