import { QRCodeSVG } from "qrcode.react";
import { KeyRound, Users, DoorOpen, CalendarClock } from "lucide-react";
import { bookingWhen, facilityLabel, fillWord, wellnessWords, WELLNESS_LOCALES, type WellnessLang } from "@/lib/wellness";

export type WellnessTicketData = {
  id: string;
  kind: string;
  resource_name?: string;
  starts_at: string;
  ends_at: string;
  party_size: number;
  ticket_code: string;
  room_number?: string | null;
  status?: string;
  can_cancel?: boolean;
};

type Props = {
  ticket: WellnessTicketData;
  lang: string;
  accent: string;
  hotelName?: string;
  onCancel?: () => void;
  cancelling?: boolean;
  compact?: boolean;
};

/**
 * The guest's ticket: what they show at reception to get the key. The
 * perforated edge and the code are the memorable part; everything else is
 * quiet. The QR holds only the ticket code.
 */
export function WellnessTicket({ ticket, lang, accent, hotelName, onCancel, cancelling, compact }: Props) {
  const w = wellnessWords(lang);
  const locale = WELLNESS_LOCALES[(lang as WellnessLang)] ?? "en-GB";
  const facility = facilityLabel(ticket.kind, lang, ticket.resource_name);
  const when = bookingWhen(ticket.starts_at, ticket.ends_at, locale);
  return (
    <article
      className="wellness-ticket relative overflow-hidden rounded-[22px] bg-white text-[#1d2733] shadow-[0_18px_40px_-24px_rgba(29,39,51,0.55)] ring-1 ring-black/5"
      style={{ ["--ticket-accent" as string]: accent }}
      aria-label={`${w.ticket} ${ticket.ticket_code}`}
    >
      <div className="flex items-stretch">
        <div className="min-w-0 flex-1 p-5 sm:p-6">
          <p className="text-base font-semibold leading-tight">{facility}</p>
          {hotelName && <p className="text-sm text-slate-500">{hotelName}</p>}
          <p className="mt-3 whitespace-nowrap text-[clamp(1.55rem,7vw,2.5rem)] font-semibold leading-none tracking-[0.04em] tabular-nums"
             style={{ color: accent }}>
            {ticket.ticket_code}
          </p>
          <dl className={`mt-4 grid gap-2 text-sm ${compact ? "" : "sm:grid-cols-2"}`}>
            <div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <dt className="sr-only">{w.when}</dt><dd className="font-medium">{when}</dd></div>
            <div className="flex items-center gap-2"><Users className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <dt className="sr-only">{w.people}</dt><dd>{ticket.party_size === 1 ? w.partyOne : fillWord(w.partyMany, { n: ticket.party_size })}</dd></div>
            {ticket.room_number && <div className="flex items-center gap-2"><DoorOpen className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <dt className="sr-only">{w.room}</dt><dd>{w.room} {ticket.room_number}</dd></div>}
          </dl>
        </div>
        {/* Perforation between the stub and the QR */}
        <div aria-hidden className="relative w-0 border-l-2 border-dashed border-slate-200">
          <span className="absolute -left-[11px] -top-[11px] h-5 w-5 rounded-full bg-[var(--ticket-hole,#f1f5f9)]" />
          <span className="absolute -bottom-[11px] -left-[11px] h-5 w-5 rounded-full bg-[var(--ticket-hole,#f1f5f9)]" />
        </div>
        <div className="flex shrink-0 items-center p-3 sm:p-5">
          <QRCodeSVG value={ticket.ticket_code} size={104} level="M" fgColor="#1d2733" aria-label={ticket.ticket_code}
            className={compact ? "h-[76px] w-[76px] sm:h-[88px] sm:w-[88px]" : "h-[84px] w-[84px] sm:h-[104px] sm:w-[104px]"} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-3 sm:px-6">
        <p className="flex items-center gap-2 text-sm font-medium"><KeyRound className="h-4 w-4" style={{ color: accent }} aria-hidden />{w.showTicket}</p>
        {onCancel && ticket.can_cancel !== false && (
          <button type="button" onClick={onCancel} disabled={cancelling}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 disabled:opacity-50">
            {w.cancel}
          </button>
        )}
      </div>
    </article>
  );
}
