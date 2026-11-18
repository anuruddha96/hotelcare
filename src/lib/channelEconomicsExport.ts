// Excel export of the Channels & net revenue view: one workbook a manager can
// forward, with the same numbers as the screen.
import {
  channelLabel, commissionShare, grossAdr, netAdr, type BookingEconomics, type ChannelEconomics,
  type DayEconomics, type EconomicsTotals, type MonthEconomics,
} from "./channelEconomics";

export type Cell = string | number | null;
export interface Sheet { name: string; rows: Cell[][] }

const r2 = (n: number | null | undefined): number | null => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const p1 = (n: number | null | undefined): number | null => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 1000) / 10);

export interface EconomicsExportInput {
  hotelName: string;
  month: string;
  currency: string;
  hu: boolean;
  totals: EconomicsTotals;
  channels: ChannelEconomics[];
  days: DayEconomics[];
  bookings: BookingEconomics[];
  months: MonthEconomics[];
  sourceLabel: (source: BookingEconomics["source"]) => string;
}

export function buildEconomicsSheets(x: EconomicsExportInput): Sheet[] {
  const L = x.hu
    ? {
        summary: "Összesítő", channels: "Csatornák", days: "Napi bontás", bookings: "Foglalások", months: "Havi trend",
        hotel: "Szálloda", month: "Hónap", currency: "Pénznem", item: "Tétel", value: "Érték",
        pms: "Foglalási érték a PMS-ben", tax: "Idegenforgalmi adó (IFA)", exTax: "Bevétel IFA nélkül",
        withheld: "Nettó áras OTA-k által levont jutalék", gross: "Bruttó bevétel", commission: "OTA-jutalék",
        net: "Nettó bevétel", commPct: "Jutalék a bruttó %-ában", nights: "Szobaéjszaka", bookingsN: "Foglalások",
        grossAdr: "Bruttó ADR", netAdr: "Nettó ADR", exact: "Pontos jutalék", estimated: "Becsült jutalék",
        unknownGross: "Bruttó bevétel ismeretlen jutalékkal", channel: "Csatorna", basis: "Összeg a PMS-ben",
        shareNet: "Nettó részesedés %", date: "Dátum", ref: "PMS foglalás", code: "OTA kód", bookedOn: "Foglalva",
        first: "Első éjszaka", last: "Utolsó éjszaka", amount: "PMS érték", source: "Jutalék forrása", rate: "Jutalékkulcs %",
        plan: "Díjcsomag", meal: "Ellátás", payout: "Kifizetés", basisGross: "bruttó", basisNet: "nettó", basisMixed: "vegyes",
      }
    : {
        summary: "Summary", channels: "Channels", days: "By day", bookings: "Bookings", months: "Monthly trend",
        hotel: "Hotel", month: "Month", currency: "Currency", item: "Item", value: "Value",
        pms: "Booked value in the PMS", tax: "City tax (IFA)", exTax: "Revenue excl. city tax",
        withheld: "Commission kept by net-rate OTAs", gross: "Gross revenue", commission: "OTA commission",
        net: "Net revenue", commPct: "Commission % of gross", nights: "Room nights", bookingsN: "Bookings",
        grossAdr: "Gross ADR", netAdr: "Net ADR", exact: "Exact commission", estimated: "Estimated commission",
        unknownGross: "Gross revenue with unknown commission", channel: "Channel", basis: "Amount in the PMS",
        shareNet: "Share of net %", date: "Date", ref: "PMS booking", code: "OTA code", bookedOn: "Booked on",
        first: "First night", last: "Last night", amount: "PMS value", source: "Commission source", rate: "Commission rate %",
        plan: "Rate plan", meal: "Meals", payout: "Payout", basisGross: "gross", basisNet: "net", basisMixed: "mixed",
      };
  const t = x.totals;
  const basis = (b: string) => (b === "net" ? L.basisNet : b === "mixed" ? L.basisMixed : L.basisGross);

  const summary: Cell[][] = [
    [L.hotel, x.hotelName], [L.month, x.month], [L.currency, x.currency], [],
    [L.item, L.value],
    [L.pms, r2(t.amount)],
    [L.tax, r2(-t.cityTax)],
    [L.exTax, r2(t.revenueExTax)],
    [L.withheld, r2(t.commissionWithheld)],
    [L.gross, r2(t.grossRevenue)],
    [L.commission, r2(-t.commission)],
    [L.net, r2(t.netRevenue)],
    [],
    [L.commPct, p1(commissionShare(t))],
    [L.nights, t.roomNights],
    [L.bookingsN, t.bookings],
    [L.grossAdr, r2(grossAdr(t))],
    [L.netAdr, r2(netAdr(t))],
    [L.exact, r2(t.commissionExact)],
    [L.estimated, r2(t.commissionEstimated)],
    [L.unknownGross, r2(t.unknownGross)],
  ];

  const channels: Cell[][] = [
    [L.channel, L.nights, L.bookingsN, L.pms, L.tax, L.gross, L.commission, L.commPct, L.net, L.grossAdr, L.netAdr, L.shareNet, L.basis],
    ...x.channels.map((c) => [
      channelLabel(c.key, x.hu), c.roomNights, c.bookings, r2(c.amount), r2(c.cityTax), r2(c.grossRevenue),
      c.unknownGross > 0 && c.commission === 0 ? null : r2(c.commission), p1(commissionShare(c)), r2(c.netRevenue),
      r2(grossAdr(c)), r2(netAdr(c)), p1(t.netRevenue > 0 ? c.netRevenue / t.netRevenue : null), basis(c.basis),
    ]),
  ];

  const days: Cell[][] = [
    [L.date, L.nights, L.gross, L.commission, L.net],
    ...x.days.map((d) => [d.date, d.roomNights, r2(d.grossRevenue), r2(d.commission), r2(d.netRevenue)]),
  ];

  const bookings: Cell[][] = [
    [L.ref, L.code, L.channel, L.bookedOn, L.first, L.last, L.nights, L.amount, L.tax, L.gross, L.commission, L.net, L.basis, L.source, L.rate, L.plan, L.meal, L.payout],
    ...x.bookings.map((b) => [
      b.bookingRef, b.otaCode, channelLabel(b.channelKey, x.hu), b.bookedOn, b.firstNight, b.lastNight, b.roomNights,
      r2(b.amount), r2(b.cityTax), r2(b.grossRevenue), r2(b.commission), r2(b.netRevenue), basis(b.basis),
      x.sourceLabel(b.source), p1(b.rate), b.rateLabel, b.mealPlan, b.payoutType,
    ]),
  ];

  const months: Cell[][] = [
    [L.month, L.nights, L.gross, L.commission, L.commPct, L.net, L.exact, L.unknownGross],
    ...x.months.map((m) => [
      m.month, m.roomNights, r2(m.grossRevenue), r2(m.commission), p1(m.grossRevenue > 0 ? m.commission / m.grossRevenue : null),
      r2(m.netRevenue), r2(m.commissionExact), r2(m.unknownGross),
    ]),
  ];

  return [
    { name: L.summary, rows: summary },
    { name: L.channels, rows: channels },
    { name: L.days, rows: days },
    { name: L.bookings, rows: bookings },
    { name: L.months, rows: months },
  ];
}

export async function downloadSheets(sheets: Sheet[], fileName: string): Promise<void> {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    const widths = sheet.rows.reduce<number[]>((w, row) => {
      row.forEach((cell, i) => { w[i] = Math.min(42, Math.max(w[i] ?? 8, String(cell ?? "").length + 2)); });
      return w;
    }, []);
    ws["!cols"] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(book, ws, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(book, fileName);
}
