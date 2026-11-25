export interface ParkingMailPayload {
  event: 'issued' | 'updated' | 'voided';
  reference: string;
  valid_from: string;
  valid_to: string;
  hotel_name: string;
  from_email: string;
  reply_to: string | null;
  provider_name: string;
  instructions: string;
}

export function escapeParkingHtml(value: string): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!);
}

export function parkingMailContent(p: ParkingMailPayload, audience: 'guest' | 'vendor') {
  const action = { issued: 'issued', updated: 'amended', voided: 'voided' }[p.event];
  const title = audience === 'guest' && p.event === 'issued' ? 'Your parking voucher' : `Parking ticket ${action}`;
  const disclaimer = p.event === 'voided'
    ? 'This ticket has been voided. Do not use it for parking.'
    : 'Keep the physical parking ticket unless the parking operator has explicitly confirmed digital acceptance. This email does not open a parking barrier.';
  const lines = [p.hotel_name, title, `Ticket: ${p.reference}`, `Valid from: ${p.valid_from}`,
    `Valid to: ${p.valid_to}`, `Parking operator: ${p.provider_name}`,
    ...(audience === 'guest' ? [p.instructions, disclaimer] : ['Please update your records. Expiry is not a cancellation.']),
    'Powered by HotelCare'];
  const e = escapeParkingHtml;
  return {
    subject: `${p.hotel_name} — ${title}: ${p.reference}`.replace(/[\r\n]/g, ' '),
    text: lines.filter(Boolean).join('\n'),
    html: `<div style="background:#f3f5f7;padding:24px;font-family:Arial,sans-serif;color:#1e293b"><div style="max-width:580px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden"><div style="background:#172b46;color:#fff;padding:24px"><div style="font-size:22px;font-weight:bold">${e(p.hotel_name)}</div><div style="margin-top:8px">${e(title)}</div></div><div style="padding:24px"><p style="font-size:28px;font-family:monospace;font-weight:bold">${e(p.reference)}</p><p><strong>Valid from:</strong> ${e(p.valid_from)}<br><strong>Valid to:</strong> ${e(p.valid_to)}</p><p><strong>Parking operator:</strong> ${e(p.provider_name)}</p>${audience === 'guest' ? `<p style="white-space:pre-line">${e(p.instructions)}</p><p style="padding:12px;background:#f8fafc;font-size:12px">${e(disclaimer)}</p>` : '<p>Please update your records. Expiry is not a cancellation.</p>'}<p style="font-size:11px;color:#64748b">Powered by HotelCare</p></div></div></div>`,
  };
}

export function parkingSenderDomain(email: string): string | null {
  if (!/^[a-z0-9._%+-]+@([a-z0-9-]+\.)*hotelcare\.app$/i.test(email)) return null;
  return email.split('@')[1].toLowerCase();
}
