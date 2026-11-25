type Translate = (key: string) => string;
type Code = string | null | undefined;

// Normalize only for display lookup; never use these values for persistence.
const normalize = (code: Code) => (code ?? '').trim().toLowerCase().replace(/[\s_.-]+/g, '');
const label = (code: Code, t: Translate, keys: Record<string, string>) =>
  t(Object.prototype.hasOwnProperty.call(keys, normalize(code)) ? keys[normalize(code)] : 'labels.other');

const reservationKeys: Record<string, string> = {
  confirmed: 'pms.cal.status_confirmed', pending: 'pms.cal.status_pending',
  tentative: 'labels.reservation.tentative', checkedin: 'pms.cal.status_checked_in',
  checkedout: 'pms.cal.status_checked_out', cancelled: 'pms.reservations.cancelled',
  canceled: 'pms.reservations.cancelled', noshow: 'pms.reservations.noShow',
};
const sourceKeys: Record<string, string> = {
  direct: 'labels.source.direct', website: 'labels.source.website', phone: 'labels.source.phone',
  email: 'labels.source.email', walkin: 'labels.source.walkIn', bookingcom: 'labels.source.booking',
  booking: 'labels.source.booking', bookingcomxml: 'labels.source.booking',
  airbnb: 'labels.source.airbnb', expedia: 'labels.source.expedia', agoda: 'labels.source.agoda',
  agodaxml: 'labels.source.agoda', channex: 'labels.source.channex', previo: 'labels.source.previo',
  hotelcare: 'labels.source.hotelcare', ota: 'labels.source.ota',
  travelagency: 'labels.source.travelAgency', corporate: 'labels.source.corporate',
};
const documentKeys: Record<string, string> = {
  passport: 'pms.guest.docPassport', idcard: 'pms.guest.docIdCard',
  drivinglicence: 'pms.guest.docDriving', driverlicense: 'pms.guest.docDriving',
  drivinglicense: 'pms.guest.docDriving', driverslicense: 'pms.guest.docDriving',
  residencepermit: 'labels.document.residencePermit', other: 'pms.guest.docOther',
};
const roomKeys: Record<string, string> = {
  clean: 'pms.room.status_clean', dirty: 'pms.room.status_dirty', inspected: 'labels.room.inspected',
  outoforder: 'pms.room.status_out_of_order', outofservice: 'pms.room.status_out_of_service',
  maintenance: 'pms.room.status_maintenance', checkout: 'labels.room.departure',
  departure: 'labels.room.departure', stayover: 'labels.room.stayover', occupied: 'labels.room.occupied',
};
const paymentKeys: Record<string, string> = {
  unpaid: 'labels.payment.unpaid', partiallypaid: 'labels.payment.partial', partial: 'labels.payment.partial',
  paid: 'labels.payment.paid', refunded: 'labels.payment.refunded',
  pending: 'labels.payment.pending', failed: 'labels.payment.failed',
};
const eventKeys: Record<string, string> = {
  created: 'labels.event.created', updated: 'labels.event.updated',
  checkin: 'labels.event.checkIn', checkedin: 'labels.event.checkIn',
  checkout: 'labels.event.checkOut', checkedout: 'labels.event.checkOut',
  roomchanged: 'labels.event.roomChanged', roomchange: 'labels.event.roomChanged',
  cancelled: 'labels.event.cancelled', canceled: 'labels.event.cancelled',
  noshow: 'labels.event.noShow', confirmed: 'labels.event.confirmed',
  undocheckin: 'labels.event.undoCheckIn', undocheckout: 'labels.event.undoCheckOut',
  paymentrecorded: 'labels.event.paymentRecorded', chargeadded: 'labels.event.chargeAdded',
};
const reportingKeys: Record<string, string> = {
  sent: 'labels.state.sent', accepted: 'labels.state.accepted', rejected: 'labels.state.rejected',
  queued: 'labels.state.queued', pending: 'labels.state.pending', failed: 'labels.state.failed',
  error: 'labels.state.error', disabled: 'labels.state.disabled', off: 'labels.state.disabled',
  notsent: 'labels.state.notSent', unsent: 'labels.state.notSent',
  processing: 'labels.state.processing', success: 'labels.state.success',
};

export const reservationStatusLabel = (code: Code, t: Translate) => label(code, t, reservationKeys);
export const bookingSourceLabel = (code: Code, t: Translate) => label(code, t, sourceKeys);
export const documentTypeLabel = (code: Code, t: Translate) => label(code, t, documentKeys);
export const roomStatusLabel = (code: Code, t: Translate) => label(code, t, roomKeys);
export const paymentStatusLabel = (code: Code, t: Translate) => label(code, t, paymentKeys);
export const reservationEventLabel = (code: Code, t: Translate) => label(code, t, eventKeys);
export const reportingStateLabel = (code: Code, t: Translate) => label(code, t, reportingKeys);
