import { describe, expect, it, vi } from 'vitest';
import { createReservation, updateReservation, fetchNtakBookingFields } from '@/lib/pmsLifecycle';
const state=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:state.rpc}}));
describe('Phase 6 disabled property',()=>{
 it('does not send NTAK fields on create or edit when property status is null',async()=>{
  state.rpc.mockImplementation(async (name:string)=>{
   if(name==='pms_ntak_booking_fields') return {data:null,error:null};
   if(name==='pms_create_reservation') return {data:{ok:true,id:'res',reservation_number:'R-1'},error:null};
   if(name==='pms_update_reservation') return {data:{ok:true,pms_managed:true},error:null};
   throw new Error('Unexpected RPC '+name);
  });
  const createStatus=await fetchNtakBookingFields('normal-hotel','rdhotels');
  expect(createStatus).toBeNull();
  await createReservation({hotelId:'normal-hotel',guestId:'guest',checkIn:'2026-11-24',checkOut:'2026-11-25',adults:1,children:0,ntakFields:createStatus??undefined});
  const editStatus=await fetchNtakBookingFields('normal-hotel','rdhotels','res');
  expect(editStatus).toBeNull();
  await updateReservation({reservationId:'res',adults:2,ntakFields:editStatus??undefined});
  const calls=state.rpc.mock.calls.map(c=>c[0]);
  expect(calls).toEqual(['pms_ntak_booking_fields','pms_create_reservation','pms_ntak_booking_fields','pms_update_reservation']);
  expect(state.rpc).not.toHaveBeenCalledWith('pms_save_ntak_booking_fields',expect.anything());
 });
});
