import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('./ntakApi', async (importOriginal) => ({ ...(await importOriginal<typeof import('./ntakApi')>()), callNtak: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import '@/lib/ntak-translations';
import { TranslationProvider } from '@/hooks/useTranslation';
import { callNtak } from './ntakApi';
import { NtakClosureDialog } from './NtakClosureDialog';
import { NtakStatusCard } from './NtakStatusCard';

const call = vi.mocked(callNtak);

const preview = (over: Record<string, unknown> = {}) => ({
  day: '2026-11-18', classification: 'UJ', xml: '<v9:napiZarasRequest/>',
  totals: { roomNights: 12, guests: 21, accommodationFee: 480000, ifa: 16271, charges: 510000, payments: 300000 },
  closure: { rooms: { total: 14, ooo: 1, oos: 0, rented: 12, available: 13 }, capacity: { total: 28, ooo: 2, oos: 0, rented: 24, available: 26 }, nights: [], checkoutSales: [] },
  checklist: [], ...over,
});

describe('NTAK closure dialog', () => {
  beforeEach(() => call.mockReset());

  it('blocks sending while the checklist has errors and shows them', async () => {
    call.mockResolvedValue(preview({ checklist: [{ level: 'error', code: 'guest', message: 'Room 101: no guest with complete personal data' }, { level: 'warning', code: 'postal', message: 'Postal code looks like a dummy value' }] }));
    render(<NtakClosureDialog hotelId="h1" day="2026-11-18" open onOpenChange={() => {}} />);
    expect(await screen.findByText(/no guest with complete personal data/)).toBeInTheDocument();
    expect(screen.getByText(/dummy value/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send/ })).toBeDisabled();
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ action: 'preview_closure', hotel_id: 'h1', day: '2026-11-18' }));
  });

  it('sends a clean closure', async () => {
    call.mockImplementation((async (body?: Record<string, unknown>) => (body?.action === 'close_day' ? { ok: true, message_id: 'm1' } : preview())) as never);
    const onQueued = vi.fn();
    render(<NtakClosureDialog hotelId="h1" day="2026-11-18" open onOpenChange={() => {}} onQueued={onQueued} />);
    expect(await screen.findByText('12')).toBeInTheDocument();
    const send = screen.getByRole('button', { name: /Send/ });
    await waitFor(() => expect(send).not.toBeDisabled());
    fireEvent.click(send);
    await waitFor(() => expect(onQueued).toHaveBeenCalled());
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ action: 'close_day', day: '2026-11-18', closed: false }));
  });

  it('requires a record id and reason for a correction (MODOSITO)', async () => {
    call.mockResolvedValue(preview({ classification: 'MODOSITO' }));
    render(<NtakClosureDialog hotelId="h1" day="2026-11-18" open onOpenChange={() => {}} />);
    const send = await screen.findByRole('button', { name: /Send/ });
    await screen.findByText('MODOSITO');
    expect(send).toBeDisabled();
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[inputs.length - 2], { target: { value: 'JK-1' } });
    fireEvent.change(inputs[inputs.length - 1], { target: { value: 'Fee corrected' } });
    await waitFor(() => expect(send).not.toBeDisabled());
  });
});

describe('NTAK status card', () => {
  beforeEach(() => call.mockReset());

  it('shows missing closures, NTAK errors and a stopped sender', async () => {
    call.mockResolvedValue({
      can_manage: true, today: '2026-11-19', missing_closures: ['2026-11-16', '2026-11-17'], closures: [{ closed_day: '2026-11-18', state: 'errors', needs_correction: false }],
      messages: [{ id: 'm1', kind: 'closure', state: 'rejected', errors: [{ key: 'KotelezoSzallasdij' }], warnings: [] }],
      settings: { enabled: true, environment: 'test', sending_blocked_reason: 'Certificate rejected by NTAK', last_error: null },
      configuration_problems: [], units: [], room_types: [], rooms: [], booking_problems: [], pending_events: [],
    } as never);
    render(<NtakStatusCard hotelId="h1" />);
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.getByText(/Certificate rejected by NTAK/)).toBeInTheDocument();
    expect(screen.getByText(/✕ 1/)).toBeInTheDocument();
  });

  it('renders nothing for staff when NTAK is not set up', async () => {
    call.mockResolvedValue({ can_manage: false, settings: null } as never);
    const { container } = render(<NtakStatusCard hotelId="h1" />);
    await waitFor(() => expect(call).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

it('lets reception retry an unavailable report and shows the processing reference', async () => {
  call.mockReset();
  call.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({
    can_manage: false, today: '2026-11-20', settings: { enabled: true, environment: 'test' },
    closures: [], missing_closures: [], messages: [{
      id: 'm', kind: 'booking', state: 'accepted', warnings: [], errors: [],
      created_at: '2026-11-20T09:00:00Z', processing_id: 'receipt-123',
    }],
  } as never);
  render(<TranslationProvider><NtakStatusCard hotelId="test-property" report /></TranslationProvider>);
  fireEvent.click((await screen.findByRole('alert')).querySelector('button')!);
  expect(await screen.findByText('receipt-123')).toBeInTheDocument();
  expect(screen.getByText(/Sent, awaiting result/)).toBeInTheDocument();
});

it('allows a test manager to explicitly override an extreme amount', async () => {
  call.mockReset();
  call.mockImplementation((async (body?: Record<string, unknown>) => body?.action === 'close_day' ? { ok: true } : preview({can_manage:true,environment:'test',checklist:[{level:'error',code:'extreme',message:'Breakfast 3000000'}]})) as never);
  render(<TranslationProvider><NtakClosureDialog hotelId="h1" day="2026-11-18" open onOpenChange={() => {}} /></TranslationProvider>);
  const button = await screen.findByRole('button', { name: 'Send anyway' });
  fireEvent.click(button);
  await waitFor(() => expect(call).toHaveBeenCalledWith(expect.objectContaining({action:'close_day',override:true})));
});
