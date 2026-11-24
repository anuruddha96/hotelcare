import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GuestDetailsSection, type GuestVizaRow } from './GuestDetailsSection';
import { useStayGuestRoster } from './StayGuestRoster';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), apply: vi.fn() }));
import type { MrzReadResult } from '@/lib/idScan/mrz';
import type { OpticalGuestFields } from '@/lib/idScan/opticalGuestFields';
vi.mock('@/integrations/supabase/client', () => ({ supabase: mocks }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/frontdesk/IdScanDialog', () => ({ IdScanDialog: ({ onApply }: { onApply: (result: MrzReadResult, optical?: OpticalGuestFields) => void }) => { mocks.apply.mockImplementation(onApply); return null; } }));
vi.mock('@/components/guests/GuestSearchSelect', () => ({ GuestSearchSelect: () => null }));
vi.mock('@/lib/pmsLifecycle', () => ({ addStayGuest: vi.fn(), guestTransitionReservation: vi.fn() }));

const guest: GuestVizaRow = {
  id: 'guest-1', first_name: 'Test', last_name: 'Guest',
  nationality: null, birth_last_name: null, birth_first_name: null,
  mother_name: null, date_of_birth: '1990-01-01', birth_place: 'Budapest',
  gender: 'female', id_document_type: 'passport', id_document_number: 'TEST123',
  visa_number: null, entry_date: null, entry_place: null,
};

beforeEach(() => vi.clearAllMocks());

describe('in-dialog guest registration repair', () => {
  it('opens an incomplete guest form, saves the repair and keeps the editor accessible', async () => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), update: vi.fn() };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({ data: guest, error: null });
    query.update.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mocks.from.mockReturnValue(query);
    const onCompletenessChange = vi.fn();
    const onSaved = vi.fn();
    render(<GuestDetailsSection guestId={guest.id} onCompletenessChange={onCompletenessChange} onSaved={onSaved} />);

    await screen.findByPlaceholderText('HU / DE / USA…');
    const toggle = screen.getByRole('button', { name: /pms.guest.detailsTitle/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(onCompletenessChange).toHaveBeenLastCalledWith(['nationality']);

    fireEvent.click(toggle);
    expect(screen.queryByPlaceholderText('HU / DE / USA…')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.change(screen.getByPlaceholderText('HU / DE / USA…'), { target: { value: 'HU' } });
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'pms.guest.save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...guest, nationality: 'HU' }));
    expect(onCompletenessChange).toHaveBeenLastCalledWith([]);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByPlaceholderText('HU / DE / USA…')).toHaveValue('HU');
  });

  it('revalidates only the saved roster guest without resetting selected arrivals', async () => {
    const other = { ...guest, id: 'guest-2', nationality: 'HU' };
    const rows = [guest, other].map((g) => ({
      guest_id: g.id, stay_state: 'expected', arrived_at: null,
      departed_at: null, room_id: null, guests: g,
    }));
    const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn() };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockResolvedValue({ data: rows, error: null });
    mocks.from.mockReturnValue(query);
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const { result } = renderHook(() => useStayGuestRoster('res-1', 'hotel-1', true, 'arrive'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setSelectedIds([guest.id]));
    expect(result.current.incompleteSelected).toBe(1);
    act(() => result.current.updateSavedGuest({ ...guest, nationality: 'HU' }));
    expect(result.current.incompleteSelected).toBe(0);
    expect(result.current.selectedIds).toEqual([guest.id]);
    expect(result.current.guests).toHaveLength(2);
  });
});

const currentReview = { reservation_id: 'res-1', scan_reviewed: true, birth_name_absent: true, birth_place_absent: true, mother_name_absent: true, visa_exempt: true, parent_statement: true };
const storedScan = { source: 'mrz_camera', format: 'TD3', valid: true, read_at: '2026-11-24T10:00:00Z', fields: {
  csaladnev: 'GUEST', utonev: 'TEST', szuletesiDatum: '1990-01-01', allampolgarsagKod: 'DE',
  nem: 'NO', okmanyTipus: 'UTLEVEL', okmanyAzonositoSzam: 'TEST123',
} };
const manualBirth = { birth_first_name: 'Manual Given', birth_last_name: 'Manual Family', birth_place: 'Manual Place',
  mother_name: 'Family Given', mother_family_name: 'Family', mother_given_name: 'Given' };
const scannedGuest = { ...guest, ...manualBirth, nationality: 'DE', viza_review: currentReview, document_scan: storedScan };
const readResult = (documentNumber: string): MrzReadResult => ({
  format: 'TD3', valid: true, unknownCountry: false, lines: [], fields: {
    firstName: 'Test', lastName: 'Guest', mrzFirstName: 'TEST', mrzLastName: 'GUEST',
    nationality: 'DE', nationalityIso3: 'DEU', dateOfBirth: '1990-01-01', gender: 'female',
    documentType: 'passport', documentNumber, expiryDate: '2030-01-01', issuingState: 'DEU',
  },
});
function mockGuest(row = scannedGuest) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), update: vi.fn() };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: row, error: null });
  query.update.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  mocks.from.mockReturnValue(query);
  return query;
}
async function openEditor(reservationId: string) {
  render(<GuestDetailsSection guestId={guest.id} vizaReservationId={reservationId} occurredAt="2026-11-24T10:00:00Z" />);
  const toggle = await screen.findByRole('button', { name: /pms.guest.detailsTitle/ });
  await waitFor(() => expect(toggle).toHaveTextContent(/pms.guest.complete|pms.guest.missing/));
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  await screen.findByPlaceholderText('HU / DE / USA…');
}
async function saveEditor() {
  fireEvent.click(screen.getByRole('button', { name: 'pms.guest.save' }));
}
describe('document reader evidence and corrections', () => {
  it('preserves scan and all review flags when nationality is corrected', async () => {
    const query = mockGuest();
    await openEditor('res-1');
    fireEvent.change(screen.getByPlaceholderText('HU / DE / USA…'), { target: { value: 'FR' } });
    await saveEditor();
    await waitFor(() => expect(query.update).toHaveBeenCalled());
    const payload = query.update.mock.calls[0][0];
    expect(payload.nationality).toBe('FR');
    expect(payload.viza_review).toEqual(currentReview);
    expect(payload).not.toHaveProperty('document_scan');
  });
  it('does not wipe the scan when saving a historical recovery form', async () => {
    const query = mockGuest();
    await openEditor('older-reservation');
    fireEvent.change(screen.getByPlaceholderText('HU / DE / USA…'), { target: { value: 'FR' } });
    await saveEditor();
    await waitFor(() => expect(query.update).toHaveBeenCalled());
    expect(query.update.mock.calls[0][0]).not.toHaveProperty('document_scan');
  });
  it('keeps handwritten birth fields on a same-document scan with no optical proposals', async () => {
    const query = mockGuest();
    await openEditor('res-1');
    act(() => mocks.apply(readResult('TEST123'), {}));
    await saveEditor();
    await waitFor(() => expect(query.update).toHaveBeenCalled());
    expect(query.update.mock.calls[0][0]).toMatchObject(manualBirth);
    expect(query.update.mock.calls[0][0].document_scan.fields.okmanyAzonositoSzam).toBe('TEST123');
  });
  it('clears old birth fields for a different document except proposed values', async () => {
    const query = mockGuest();
    await openEditor('res-1');
    act(() => mocks.apply(readResult('TEST456'), { birth_place: 'New Place' }));
    await saveEditor();
    await waitFor(() => expect(query.update).toHaveBeenCalled());
    expect(query.update.mock.calls[0][0]).toMatchObject({
      birth_first_name: null, birth_last_name: null, birth_place: 'New Place',
      mother_name: null, mother_family_name: null, mother_given_name: null,
    });
  });
  it('clears stored scan only on explicit Remove scan', async () => {
    const query = mockGuest();
    await openEditor('res-1');
    fireEvent.click(screen.getByRole('button', { name: /pms.guest.scanRemove/ }));
    await saveEditor();
    await waitFor(() => expect(query.update).toHaveBeenCalled());
    expect(query.update.mock.calls[0][0].document_scan).toBeNull();
  });
});


describe('check-in autosave', () => {
  function autoQuery() {
    const query = mockGuest();
    const acknowledge = vi.fn().mockResolvedValue({ data: { id: guest.id }, error: null });
    query.update.mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ maybeSingle: acknowledge }) }) });
    return { query, acknowledge };
  }

  it('persists typed edits and acknowledged scan data without pressing Save', async () => {
    const { query } = autoQuery();
    const pending = vi.fn();
    const saved = vi.fn();
    render(<GuestDetailsSection guestId={guest.id} vizaReservationId="res-1" autoSave onSavePendingChange={pending} onSaved={saved} />);
    const toggle = await screen.findByRole('button', { name: /pms.guest.detailsTitle/ });
    await waitFor(() => expect(toggle).toHaveTextContent(/pms.guest.complete|pms.guest.missing/));
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
    fireEvent.change(await screen.findByPlaceholderText('HU / DE / USA…'), { target: { value: 'FR' } });
    expect(pending).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(screen.getByText(/pms.guest.autosaved/)).toBeInTheDocument(), { timeout: 3000 });
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ nationality: 'FR' }));
    expect(pending).toHaveBeenLastCalledWith(false);
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ nationality: 'FR' }));
    act(() => mocks.apply(readResult('TEST123'), {}));
    await waitFor(() => expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
      document_scan: expect.objectContaining({ fields: expect.objectContaining({ okmanyAzonositoSzam: 'TEST123' }) }),
    })), { timeout: 3000 });
  });

  it('does not mark a rejected or zero-row update saved; permits retry', async () => {
    const { acknowledge } = autoQuery();
    acknowledge.mockResolvedValueOnce({ data: null, error: null });
    const pending = vi.fn();
    render(<GuestDetailsSection guestId={guest.id} autoSave onSavePendingChange={pending} />);
    const toggle = await screen.findByRole('button', { name: /pms.guest.detailsTitle/ });
    await waitFor(() => expect(toggle).toHaveTextContent(/pms.guest.complete|pms.guest.missing/));
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
    fireEvent.change(await screen.findByPlaceholderText('HU / DE / USA…'), { target: { value: 'FR' } });
    await screen.findByText('pms.guest.autosaveFailed', {}, { timeout: 3000 });
    expect(pending).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText(/pms.guest.autosaved/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'pms.guest.autosaveRetry' }));
    await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false));
  });

  it('serializes saves and never overwrites newer edits with an older response', async () => {
    const { query, acknowledge } = autoQuery();
    let finish!: (value: { data: { id: string }; error: null }) => void;
    acknowledge.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const saved = vi.fn();
    render(<GuestDetailsSection guestId={guest.id} autoSave onSaved={saved} />);
    const toggle = await screen.findByRole('button', { name: /pms.guest.detailsTitle/ });
    await waitFor(() => expect(toggle).toHaveTextContent(/pms.guest.complete|pms.guest.missing/));
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
    const input = await screen.findByPlaceholderText('HU / DE / USA…');
    fireEvent.change(input, { target: { value: 'FR' } });
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1), { timeout: 3000 });
    fireEvent.change(input, { target: { value: 'DE' } });
    await act(async () => { finish({ data: { id: guest.id }, error: null }); });
    expect(input).toHaveValue('DE');
    expect(saved).not.toHaveBeenCalled();
    await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ nationality: 'DE' })), { timeout: 3000 });
    expect(query.update).toHaveBeenCalledTimes(2);
  });
});
