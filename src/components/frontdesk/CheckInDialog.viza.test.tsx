import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckInDialog } from './CheckInDialog';
import { getLocalDateString } from '@/lib/utils';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), checkIn: vi.fn(), add: vi.fn(), rooms: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ organizationSlug: 'fixture' }) }));
vi.mock('@/components/guests/GuestWelcomeCard', () => ({ GuestWelcomeCard: () => null }));
vi.mock('@/components/frontdesk/IdScanDialog', () => ({ IdScanDialog: ({open,onOpenChange,onApply}: {
  open:boolean; onOpenChange:(value:boolean)=>void; onApply:(result: import('@/lib/idScan/mrz').MrzReadResult)=>void;
}) => open ? <><button onClick={()=>{onApply({format:'TD3',valid:true,unknownCountry:false,lines:[],fields:{
  firstName:'Synthetic',lastName:'Foreign',mrzFirstName:'SYNTHETIC',mrzLastName:'FOREIGN',
  nationality:'DE',nationalityIso3:'DEU',dateOfBirth:'1990-01-01',gender:'female',
  documentType:'passport',documentNumber:'TEST-DE',expiryDate:'2030-01-01',issuingState:'DEU'
}});onOpenChange(false);}}>Use synthetic passport</button><button type="button" onClick={()=>onOpenChange(false)}>Close synthetic scanner</button></> : null }));
vi.mock('@/components/frontdesk/BusinessMomentField', () => ({
  BusinessMomentField: () => null,
  useBusinessMoment: () => ({ occurredAt: null, invalid: false, display: '10:00' }),
}));
vi.mock('@/components/guests/GuestSearchSelect', () => ({
  GuestSearchSelect: ({ onChange }: { onChange: (id: string) => void }) => <button onClick={() => onChange('foreign')}>Select foreign guest</button>,
}));
vi.mock('@/lib/pmsLifecycle', () => ({
  checkInReservation: mocks.checkIn, fetchAvailableRooms: mocks.rooms,
  addStayGuest: mocks.add, guestTransitionReservation: vi.fn(),
  LifecycleError: class extends Error {},
}));

describe('VIZA-only whole-reservation check-in screen', () => {
  it.each(['existing','scan'])('registers two occupants with NTAK off via %s', async (method) => {
    const resId = 'two-adults';
    const review = { reservation_id: resId, scan_reviewed: true };
    const hu = { id: 'hungarian', first_name: 'Synthetic', last_name: 'Hungarian',
      nationality: 'HU', gender: 'female', date_of_birth: '1990-01-01',
      birth_first_name: 'Synthetic', birth_last_name: 'Hungarian', birth_place: 'Budapest',
      mother_family_name: 'Synthetic', mother_given_name: 'Mother', mother_name: 'Synthetic Mother',
      id_document_type: 'id_card', id_document_number: 'TEST-HU',
      visa_number: null, entry_date: null, entry_place: null, viza_review: review };
    const foreign = { ...hu, id: 'foreign', last_name: 'Foreign', nationality: 'DE',
      id_document_type: 'passport', id_document_number: 'TEST-DE',
      birth_first_name: null, birth_last_name: null, birth_place: null, mother_name: null,
      mother_family_name: null, mother_given_name: null,
      viza_review: { ...review, birth_name_absent: true, birth_place_absent: true, mother_name_absent: false } };
    const row = (guest: typeof hu | typeof foreign) => ({ guest_id: guest.id, stay_state: 'expected', arrived_at: null, departed_at: null, room_id: 'room-1', guests: guest });
    let rows = [row(hu)];
    mocks.rpc.mockImplementation(async (name: string, args?: {_data?:Record<string,unknown>}) => {
      if(name==='pms_express_channel_guest_hints') return {data:[{first_name:'Synthetic',last_name:'Hungarian'},{first_name:'Synthetic',last_name:'Companion'}],error:null};
      if(name==='pms_register_scanned_stay_guest'){
        expect(args?._data).toMatchObject({first_name:'Synthetic',last_name:'Foreign',id_document_number:'TEST-DE',
          document_scan:{fields:{okmanyAzonositoSzam:'TEST-DE'}},
          viza_review:{birth_name_absent:true,birth_place_absent:true,mother_name_absent:true,scan_reviewed:true}});
        rows=[row(hu),row({...foreign,viza_review:{...review,birth_name_absent:true,birth_place_absent:true,mother_name_absent:true}})];
        return {data:{status:'registered',guest_id:'foreign'},error:null};
      }
      return {data:name==='pms_viza_registration_required',error:null};
    });
    mocks.rooms.mockResolvedValue([{ room_id: 'room-1', room_number: '101', room_status: 'clean', capacity: 2 }]);
    mocks.add.mockImplementation(async () => { rows = [row(hu), row(foreign)]; });
    mocks.checkIn.mockResolvedValue({ ok: true, room_number: '101' });
    const rosterQuery = { select: vi.fn(), eq: vi.fn(), order: vi.fn() };
    rosterQuery.select.mockReturnValue(rosterQuery);
    rosterQuery.eq.mockReturnValue(rosterQuery);
    rosterQuery.order.mockImplementation(async () => ({ data: rows, error: null }));
    const guestQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), update: vi.fn() };
    guestQuery.select.mockReturnValue(guestQuery);
    guestQuery.eq.mockReturnValue(guestQuery);
    guestQuery.maybeSingle.mockResolvedValue({ data: foreign, error: null });
    guestQuery.update.mockImplementation((payload: Record<string, unknown>) => ({
      eq: vi.fn().mockImplementation((column: string, id: string) => {
        expect(column).toBe('id');
        expect(id).toBe(foreign.id);
        return {
          select: vi.fn().mockImplementation((columns: string) => {
            expect(columns).toBe('id');
            return { maybeSingle: vi.fn().mockImplementation(async () => {
              rows = rows.map(item => item.guest_id === id
                ? row({ ...foreign, ...payload } as typeof foreign)
                : item);
              return { data: { id }, error: null };
            }) };
          }),
        };
      }),
    }));
    mocks.from.mockImplementation((table: string) => table === 'reservation_guests' ? rosterQuery : guestQuery);
    const today = getLocalDateString();
    const onSuccess = vi.fn();
    render(<CheckInDialog open onOpenChange={vi.fn()} onSuccess={onSuccess} reservation={{
      id: resId, hotel_id: 'channex-test-property', organization_slug: 'fixture', guest_id: hu.id,
      guests: { ...hu, email: 'synthetic@example.invalid' }, room_id: 'room-1',
      adults: 2, children: 0, check_in_date: today, check_out_date: '2099-12-31', total_nights: 1,
      reservation_number: 'VIZA-TEST', status: 'confirmed', currency: 'EUR', total_price: 0,
    }} />);
    await screen.findByText('pms.guest.wholeReservation');
    const confirm = () => screen.getByRole('button', { name: 'pms.checkIn · 10:00' });
    await waitFor(() => expect(confirm()).toBeDisabled());
    expect(screen.getByText('pms.guest.occupantCount')).toBeInTheDocument();
    expect(screen.getByText('pms.guest.wholeReservation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'pms.express.scanDocument' })).toBeInTheDocument();
    expect(await screen.findByText(/Synthetic Companion/)).toBeInTheDocument();
    expect(screen.getByText(/pms\.express\.channelName/)).toBeInTheDocument();
    if(method==='existing'){
      fireEvent.click(screen.getByRole('button', { name: 'pms.express.otherOptions' }));
      fireEvent.click(screen.getByRole('button', { name: 'Select foreign guest' }));
      fireEvent.click(screen.getByRole('button', { name: 'pms.stayGuest.addGuest' }));
      await screen.findByText('Synthetic Foreign');
      expect(mocks.add).toHaveBeenCalledWith(resId, foreign.id);
      expect(confirm()).toBeDisabled();
      expect(screen.getByText('pms.stayGuest.registrationMissing')).toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: /pms.stayGuest.arrivingNow/ })).not.toBeInTheDocument();
      await screen.findByPlaceholderText('HU / DE / USA…');
      // Adding an existing guest automatically opens the document scanner.
      // Close it before editing the underlying guest registration form, as in the real UI.
      fireEvent.click(await screen.findByRole('button', { name: 'Close synthetic scanner' }));
      const absent = screen.getAllByRole('checkbox', { name: 'pms.guest.notOnDocument' });
      expect(absent).toHaveLength(3);
      fireEvent.click(absent.find(el => !(el as HTMLInputElement).checked)!);
      expect(confirm()).toBeDisabled();
      expect(screen.getByText('pms.guest.autosaving')).toBeInTheDocument();
      // The check-in must become ready from an acknowledged autosave,
      // without clicking Save now or manually refreshing the roster.
      await screen.findByText(/pms\.guest\.autosaved/, {}, { timeout: 3000 });
      expect(guestQuery.update).toHaveBeenCalledWith(expect.objectContaining({
        viza_review: expect.objectContaining({ mother_name_absent: true }),
      }));
  
    }else{
      fireEvent.click(screen.getByRole('button',{name:'pms.express.scanDocument'}));
      fireEvent.click(await screen.findByRole('button',{name:'Use synthetic passport'}));
      await screen.findByPlaceholderText('HU / DE / USA…');
      expect(screen.getByDisplayValue('Synthetic')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Foreign')).toBeInTheDocument();
      expect(screen.getByRole('button',{name:'pms.express.confirmGuest'})).toBeDisabled();
      screen.getAllByRole('checkbox',{name:'pms.guest.notOnDocument'}).forEach(el=>fireEvent.click(el));
      fireEvent.click(screen.getByRole('checkbox',{name:'pms.express.verify'}));
      expect(screen.getByRole('button',{name:'pms.express.confirmGuest'})).toBeEnabled();
      fireEvent.click(screen.getByRole('button',{name:'pms.express.confirmGuest'}));
      await screen.findByText('Synthetic Foreign');
    }
    await waitFor(() => expect(confirm()).toBeEnabled());
    expect(screen.getAllByText('pms.stayGuest.registrationComplete')).toHaveLength(2);
    fireEvent.click(confirm());
    await waitFor(() => expect(mocks.checkIn).toHaveBeenCalledWith(resId, 'room-1', false, null, null));
    expect(onSuccess).toHaveBeenCalled();
  });
});
