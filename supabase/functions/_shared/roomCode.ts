// Shared per-hotel Previo room-code parser.
// Daily Overview "Room" cells use hotel-specific internal codes; this normalizes
// them into { room_number, room_type_code, room_suffix } so staff/guests can
// look up rooms by the number they actually know (e.g. "306").

export interface ParsedRoomCode {
  room_number: string;
  room_type_code: string | null;
  room_suffix: string | null;
}

const FILLER = new Set(["departures", "arrivals", "ongoing", "total", "totals"]);

/**
 * Parse a Previo room code for a given hotel.
 * Returns null for filler rows (totals, headings, junk).
 */
export function parseRoomCode(raw: unknown, hotelId: string): ParsedRoomCode | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (FILLER.has(s.toLowerCase())) return null;
  // Pure short numeric/text with no '-' is filler (e.g. "15", "43", "82", "35")
  if (!s.includes("-")) return null;

  const stripSh = (val: string): { num: string; suffix: string | null } => {
    const m = val.match(/^(.*?)(SH)$/i);
    if (m && /\d/.test(m[1])) return { num: m[1], suffix: "SH" };
    return { num: val, suffix: null };
  };

  switch (hotelId) {
    case "memories-budapest": {
      // ^\d+<TYPE>-<ROOM>(SH)?$ — e.g. 70SNG-306, 19SYN.DOUBLE-107SH
      const m = s.match(/^(\d+)([A-Z.]+)-(.+)$/i);
      if (!m) return null;
      const { num, suffix } = stripSh(m[3].trim());
      if (!num) return null;
      return { room_number: num, room_type_code: m[2].toUpperCase(), room_suffix: suffix };
    }
    case "mika-downtown": {
      // ^<TYPE>\s*-\s*<ROOM>$ — e.g. "DB - 101", "SUITE - 1/2"
      const m = s.match(/^([A-Z0-9.,/+]+(?:\s*[A-Z0-9.,/+]+)*?)\s*-\s*(.+)$/i);
      if (!m) return null;
      const { num, suffix } = stripSh(m[2].trim());
      if (!num) return null;
      return { room_number: num, room_type_code: m[1].trim().toUpperCase(), room_suffix: suffix };
    }
    case "ottofiori": {
      // ^<TYPE>-<ROOM>$ — e.g. DB/TW-102, Q-101, TRP-104
      const idx = s.indexOf("-");
      if (idx < 0) return null;
      const type = s.slice(0, idx).trim();
      const { num, suffix } = stripSh(s.slice(idx + 1).trim());
      if (!num) return null;
      return { room_number: num, room_type_code: type.toUpperCase(), room_suffix: suffix };
    }
    case "gozsdu-court": {
      // ^<TYPE>-<ROOM>$ where ROOM may be alphanumeric or N/M/N apartment id
      const idx = s.indexOf("-");
      if (idx < 0) return null;
      const type = s.slice(0, idx).trim();
      const { num, suffix } = stripSh(s.slice(idx + 1).trim());
      if (!num) return null;
      return { room_number: num, room_type_code: type.toUpperCase(), room_suffix: suffix };
    }
    default: {
      // Generic fallback: room = portion after last '-'
      const idx = s.lastIndexOf("-");
      if (idx < 0) return null;
      const type = s.slice(0, idx).replace(/^\d+/, "").trim();
      const { num, suffix } = stripSh(s.slice(idx + 1).trim());
      if (!num) return null;
      return { room_number: num, room_type_code: type.toUpperCase() || null, room_suffix: suffix };
    }
  }
}

/** Normalize a room number string for matching (case-insensitive, strip leading zeros if numeric). */
export function normalizeRoomNumber(raw: string): string {
  const s = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  // Strip trailing SH for matching
  const noSh = s.replace(/SH$/i, "");
  if (/^\d+$/.test(noSh)) return String(parseInt(noSh, 10));
  return noSh;
}

const TYPE_LABELS: Record<string, string> = {
  SNG: "Single", DB: "Double", TW: "Twin", TWIN: "Twin",
  "DB/TW": "Double/Twin", Q: "Queen", QUEEN: "Queen",
  TRP: "Triple", QDR: "Quadruple", "EC.QRP": "Economy Quadruple",
  EC: "Economy", ECDBL: "Economy Double",
  "SYN.DOUBLE": "Synagogue View Double", "SYN.TWIN": "Synagogue View Twin",
  ST: "Studio", "1B": "1-Bedroom", "2B": "2-Bedroom", "3B": "3-Bedroom",
  "1BBALC": "1-Bedroom Balcony", "2BBALC": "2-Bedroom Balcony",
  SUITE: "Suite", CQ: "Corner Queen",
  "DB,BALC.": "Double Balcony", "DB BALC.": "Double Balcony",
  "2B,SUITE": "2-Bedroom Suite",
};

export function roomTypeLabel(code: string | null | undefined): string {
  if (!code) return "";
  return TYPE_LABELS[code.toUpperCase()] ?? code;
}
