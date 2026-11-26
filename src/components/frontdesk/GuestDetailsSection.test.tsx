import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GuestDetailsSection, type GuestVizaRow } from './GuestDetailsSection';
import { useStayGuestRoster } from './StayGuestRoster';

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), apply: vi.fn() }));
import type { MrzReadResult } from '@/lib/idScan/mrz';
import type { ScanApplyOutcome } from './IdScanDialog';
import type { OpticalGuestFields } from '@/lib/idScan/opticalGuestFields';
vi.mock('@/integrations/supabase/client', () => ({ supabase: mocks }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/frontdesk/IdScanDialog', () => ({ IdScanDialog: ({ onApply }: { onApply: (result: MrzReadResult, optical?: OpticalGuestFields, confirmNameChange?: boolean) => ScanApplyOutcome | void }) => { mocks.apply.mockImplementation(onApply); return null; } }));
vi.mock('@/components/guests/GuestSearchSelect', () => ({ GuestSearchSelect: () => null }));
vi.mock('@/lib/pmsLifecycle', () => ({ addStayGuest: vi.fn(), guestTransitionReservation: vi.fn() }));

const guest: GuestVizaRow = {
  id: 'guest-1', first_name: 'Test', last_name: 'Guest',
  nationality: null, birth_last_name: null, birth_first_name: null,
  mother_name: null, date_of_birth: '1990-01-01', birth_place: 'Budapest',
  gender: 'female', id_document_type: 'passport', id_document_number: 'TEST123',
  visa_number: null, entry_date: null, entry_place: null,
};

const queryNationality = () => document.querySelector<HTMLInputElement>('[data-viza-field="nationality"]');
const getNationality = () => {
  const input = queryNationality();
  if (!input) throw new Error('Nationality field not found');
  return input;
};
const findNationality = () => waitFor(getNationality);

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

    await findNationality();
    const toggle = screen.getByRole('button', { name: /pms.guest.detailsTitle/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(onCompletenessChange).toHaveBeenLastCalledWith(['nationality']);

    fireEvent.click(toggle);
    expect(queryNationality()).not.toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.change(getNationality(), { target: { value: 'HU' } });
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'pms.guest.save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...guest, nationality: 'HU' }));
    expect(onCompletenessChange).toHaveBeenLastCalledWith([]);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(getNationality()).toHaveValue('HU');
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
function mockGuest(row: GuestVizaRow & { document_scan?: unknown } = scannedGuest) {
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
  await waitFor(() => expect(toggle).toHaveTextContent(/pms.guest.complete|pms.guest.missing|pms.guest.requirement.counter/));
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  await findNationality();
}
async function saveEditor() {
  fireEvent.click(screen.getByRole('button', { name: 'pms.guest.save' }));
}
describe('document reader evidence and corrections', () => {
  it('fills and saves all four printed Hungarian birth and mother name fields without typing', async () => {
    const query = mockGuest({...guest, nationality:'HU', id_document_type:'id_card'});
    await openEditor('res-1');
    const base = readResult('TEST123');
    const result: MrzReadResult = {...base, format:'TD1', fields:{...base.fields, nationality:'HU', nationalityIso3:'HUN', issuingState:'HUN', documentType:'id_card'}};
    const printed = {birth_last_name:'Minta', birth_first_name:'Éva', mother_name:'Példa Anna', birth_place:'Pécs'};
    act(() => mocks.apply(result, printed));
    await waitFor(() => {
      expect(document.querySelector('[data-viza-field="birth_last_name"]')).toHaveValue('Minta');
      expect(document.querySelector('[data-viza-field="birth_first_name"]')).toHaveValue('Éva');
      expect(document.querySelector('[data-viza-field="mother_family_name"]')).toHaveValue('Példa');
      expect(document.querySelector('[data-viza-field="mother_given_name"]')).toHaveValue('Anna');
    });
    await saveEditor();
    await waitFor(() => expect(query.update).toHaveBeenCalled());
    expect(query.update.mock.calls[0][0]).toMatchObject({...printed, mother_family_name:'Példa', mother_given_name:'Anna'});
  });
  it('preserves scan and all review flags when nationality is corrected', async () => {
    const query = mockGuest();
    await openEditor('res-1');
    fireEvent.change(getNationality(), { target: { value: 'FR' } });
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
    fireEvent.change(getNationality(), { target: { value: 'FR' } });
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
  function autoQuery(row?: GuestVizaRow) {
    const query = mockGuest(row);
    const acknowledge = vi.fn().mockResolvedValue({ data: { id: guest.id }, error: null });
    query.update.mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ maybeSingle: acknowledge }) }) });
    return { query, acknowledge };
  }

  it.each([
    { name: 'visa-exempt', review: { visa_exempt: true }, visa_number: 'Na', entry_date: '2026-11-20', entry_place: 'Budapest', field: 'visa_number', cleared: { visa_number: null }, kept: { entry_date: '2026-11-20', entry_place: 'Budapest' } },
    { name: 'valid entry absence', review: { entry_details_absent: true, entry_details_reason: 'lives_in_hungary_with_permit' as const, visa_exempt: false }, visa_number: 'PERMIT123', entry_date: '2026-11-20', entry_place: 'NA', field: 'entry_place', cleared: { entry_date: null, entry_place: null }, kept: { visa_number: 'PERMIT123' } },
  ])('clears stale $name values and autosaves the normalized payload', async ({ review, visa_number, entry_date, entry_place, field, cleared, kept }) => {
    const row = { ...scannedGuest, nationality: 'US', visa_number, entry_date, entry_place, viza_review: { ...currentReview, ...review } };
    const { query } = autoQuery(row);
    const saved = vi.fn();
    const pending = vi.fn();
    const { container } = render(<GuestDetailsSection guestId={guest.id} vizaReservationId="res-1" occurredAt="2026-11-24T10:00:00Z" autoSave onSaved={saved} onSavePendingChange={pending} />);
    const toggle = await screen.findByRole('button', { name: /pms.guest.detailsTitle/ });
    await waitFor(() => expect(toggle).toHaveTextContent(/pms.guest.complete|pms.guest.requirement.counter/));
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
    const input = container.querySelector<HTMLInputElement>('[data-viza-field="' + field + '"]')!;
    expect(input).toBeDisabled();
    expect(input).toHaveValue('');
    if (field === 'entry_place') expect(container.querySelector('[data-viza-field="entry_date"]')).toHaveValue('');
    fireEvent.change(await findNationality(), { target: { value: 'CA' } });
    await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ ...cleared, ...kept, nationality: 'CA' })), { timeout: 3000 });
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ ...cleared, ...kept, nationality: 'CA' }));
    expect(pending).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText('pms.guest.autosaveFailed')).not.toBeInTheDocument();
  });

  it('still blocks a placeholder for a required permit number', async () => {
    const { query } = autoQuery({ ...scannedGuest, nationality: 'US', visa_number: 'Na', viza_review: { ...currentReview, visa_exempt: false } });
    render(<GuestDetailsSection guestId={guest.id} vizaReservationId="res-1" autoSave />);
    fireEvent.change(await findNationality(), { target: { value: 'CA' } });
    await screen.findByText('pms.guest.autosaveFailed', {}, { timeout: 3000 });
    expect(query.update).not.toHaveBeenCalled();
  });

  it('persists typed edits and acknowledged scan data without pressing Save', async () => {
    const { query } = autoQuery();
    const pending = vi.fn();
    const saved = vi.fn();
    render(<GuestDetailsSection guestId={guest.id} vizaReservationId="res-1" autoSave onSavePendingChange={pending} onSaved={saved} />);
    const toggle = await screen.findByRole('button', { name: /pms.guest.detailsTitle/ });
    await waitFor(() => expect(toggle).toHaveTextContent(/pms.guest.complete|pms.guest.missing|pms.guest.requirement.counter/));
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
    fireEvent.change(await findNationality(), { target: { value: 'FR' } });
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

  it('requires explicit same-guest confirmation for a name-only booking then autosaves the scan', async () => {
    const placeholder = { ...guest, first_name: 'Booking', last_name: 'Name', date_of_birth: null, id_document_type: null, id_document_number: null, birth_place: null, gender: null };
    const { query } = autoQuery(placeholder);
    const saved = vi.fn();
    render(<GuestDetailsSection guestId={guest.id} vizaReservationId="res-1" protectIdentity autoSave onSaved={saved} />);
    await findNationality();
    act(() => { expect(mocks.apply(readResult('TEST123'), {})).toBe('confirm-name-change'); });
    expect(query.update).not.toHaveBeenCalled();
    act(() => { expect(mocks.apply(readResult('TEST123'), {}, true)).toBe('applied'); });
    await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ first_name: 'Test', last_name: 'Guest', nationality: 'DE' })), { timeout: 3000 });
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ id_document_number: 'TEST123', viza_review: expect.objectContaining({ scan_reviewed: true }), document_scan: expect.any(Object) }));
    expect(screen.getByText(/pms.guest.autosaved/)).toBeInTheDocument();
  });

  it('never replaces an established identity even after name-change confirmation', async () => {
    const { query } = autoQuery();
    render(<GuestDetailsSection guestId={guest.id} vizaReservationId="res-1" protectIdentity autoSave />);
    const toggle = await screen.findByRole('button', { name: /pms.guest.detailsTitle/ });
    await waitFor(() => expect(toggle).toHaveTextContent(/pms.guest.complete|pms.guest.missing|pms.guest.requirement.counter/));
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
    // Verified fields may be hidden by compact review; wait for the scan action instead.
    await screen.findByRole('button', { name: 'pms.scan.retry' });
    const read = readResult('OTHER123');
    read.fields.firstName = 'Other';
    read.fields.lastName = 'Person';
    act(() => { expect(mocks.apply(read, {}, true)).toBe('identity-mismatch'); });
    expect(query.update).not.toHaveBeenCalled();
  });

  it('does not mark a rejected or zero-row update saved; permits retry', async () => {
    const { acknowledge } = autoQuery();
    acknowledge.mockResolvedValueOnce({ data: null, error: null });
    const pending = vi.fn();
    render(<GuestDetailsSection guestId={guest.id} autoSave onSavePendingChange={pending} />);
    const toggle = await screen.findByRole('button', { name: /pms.guest.detailsTitle/ });
    await waitFor(() => expect(toggle).toHaveTextContent(/pms.guest.complete|pms.guest.missing|pms.guest.requirement.counter/));
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
    fireEvent.change(await findNationality(), { target: { value: 'FR' } });
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
    await waitFor(() => expect(toggle).toHaveTextContent(/pms.guest.complete|pms.guest.missing|pms.guest.requirement.counter/));
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
    const input = await findNationality();
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

describe('VIZA case 2.2 frontend follow-up', () => {
  it('uses the check-in business day for entry date shortcuts', async () => {
    mockGuest({ ...scannedGuest, nationality: 'US', viza_review: { ...currentReview, visa_exempt: false } });
    await openEditor('res-1');
    const entry = document.querySelector('[data-viza-field="entry_date"]');
    fireEvent.click(screen.getByRole('button', { name: 'pms.guest.requirement.today' }));
    expect(entry).toHaveValue('2026-11-24');
    fireEvent.click(screen.getByRole('button', { name: 'pms.guest.requirement.yesterday' }));
    expect(entry).toHaveValue('2026-11-23');
  });

  it.each([
    ['EXPRESS_IDENTITY_CONFLICT', 'pms.express.identityConflict'],
    ['EXPRESS_OCCUPANCY_FULL', 'pms.express.occupancyFull'],
    ['EXPRESS_INVALID_DATA', 'pms.express.invalidData'],
    ['EXPRESS_INVALID_ENTRY_REASON', 'pms.express.invalidEntryReason'],
    ['EXPRESS_INVALID_SCAN', 'pms.express.invalidScan'],
    ['UNRECOGNIZED', 'pms.express.registerFailed'],
  ])('shows a safe registration message for %s', async (message, key) => {
    const onRegister = vi.fn().mockRejectedValue({ code: 'P0001', message });
    render(<GuestDetailsSection guestId={null} vizaReservationId="res-1" occurredAt="2026-11-24T10:00:00Z" draft={{ result: readResult('TEST123'), optical: manualBirth }} onRegister={onRegister} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'pms.express.verify' }));
    const confirm = screen.getByRole('button', { name: 'pms.express.confirmGuest' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(await screen.findByText(key)).toBeInTheDocument();
  });
});

describe('manual recovery save acknowledgement', () => {
  it('keeps the correction dirty if the server does not acknowledge the guest update', async () => {
    const query = mockGuest(guest);
    const acknowledge = vi.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: { id: guest.id }, error: null });
    query.update.mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ maybeSingle: acknowledge }) }) });
    const onDirtyChange = vi.fn();
    render(<GuestDetailsSection guestId={guest.id} onDirtyChange={onDirtyChange} />);
    const input = await findNationality();
    fireEvent.change(input, { target: { value: 'HU' } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'pms.guest.save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'pms.guest.save' })).toBeEnabled());
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'pms.guest.save' }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(acknowledge).toHaveBeenCalledTimes(2);
  });
});
