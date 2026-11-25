import {describe,it,expect} from 'vitest';
import {formatVizaArrivalError} from './vizaArrivalError';
describe('VIZA arrival error',()=>{
 it('names guest and translates missing fields without exposing ID values',()=>{
  expect(formatVizaArrivalError('VIZA_GUEST_DATA_INCOMPLETE: [{"guest":"Test Guest","fields":["date_of_birth","id_document_number"]}]',k=>({'pms.guest.vizaArrivalBlocked':'Complete data','pms.guest.birthDate':'Date of birth','pms.guest.docNumber':'Document number'}[k]??k))).toBe('Complete data — Test Guest: Date of birth, Document number');
 });
 it('does not display unknown internal field names',()=>{
  expect(formatVizaArrivalError('VIZA_GUEST_DATA_INCOMPLETE: [{"guest":"Test Guest","fields":["internal_field"]}]',k=>k)).toBe('pms.guest.vizaArrivalBlocked — Test Guest: pms.stayGuest.repairUnknown');
 });
 it('leaves unrelated errors unchanged',()=>expect(formatVizaArrivalError('ROOM_CONFLICT',k=>k)).toBeNull());
});
