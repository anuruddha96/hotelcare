import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Printer, QrCode, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { inSuiteStaff } from "@/lib/insuiteApi";

type Room = { id: string; room_number: string };
type IssuedQr = { room_id: string; room_number: string; token: string };

/**
 * Per-room guest QR codes. Each QR opens /suite?qr=<token> and pairs the
 * guest's phone with that exact room. Modern tokens are reconstructible by
 * authorized managers via the server's HMAC key; raw tokens are not in the DB.
 * Legacy tokens require a one-time reissue to become viewable again.
 */
export function InSuiteRoomQrCodes({ hotelId, hotelName, rooms, qrRooms, accent, onChanged }: {
  hotelId: string; hotelName: string; rooms: Room[];
  /** room_ids that already have an active QR device */
  qrRooms: Set<string>; accent?: string; onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [issued, setIssued] = useState<IssuedQr[]>([]);
  const [legacyRooms, setLegacyRooms] = useState<string[]>([]);
  const origin = window.location.origin;
  const sortedRooms = useMemo(() =>
    [...rooms].sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true })), [rooms]);

  const generate = async (roomIds: string[], confirmText: string) => {
    const replacing = roomIds.filter((id) => qrRooms.has(id)).length;
    const message = confirmText + (replacing
      ? ` ${replacing} room${replacing === 1 ? " already has" : "s already have"} a QR code — printing new codes makes the old printouts stop working.`
      : "");
    if (!window.confirm(message)) return;
    setBusy(true);
    try {
      // 200-room server limit per call; generate in order so every room is covered.
      const codes: IssuedQr[] = [];
      for (let i = 0; i < roomIds.length; i += 200) {
        const { codes: part } = await inSuiteStaff("staff-create-qr", hotelId, { room_ids: roomIds.slice(i, i + 200) });
        codes.push(...(part || []));
      }
      setIssued(codes.sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true })));
      setLegacyRooms([]);
      toast.success(`${codes.length} room QR code${codes.length === 1 ? "" : "s"} generated. You can view and print these again later.`);
      await onChanged();
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  };

  const viewExisting = async (roomIds: string[]) => {
    if (!roomIds.length) return;
    setBusy(true);
    try {
      const all: IssuedQr[] = [];
      const legacy: string[] = [];
      for (let i = 0; i < roomIds.length; i += 200) {
        const result = await inSuiteStaff("staff-view-qr", hotelId, { room_ids: roomIds.slice(i, i + 200) });
        all.push(...(result.codes || []));
        legacy.push(...(result.legacy_room_ids || []));
      }
      setIssued(all.sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true })));
      setLegacyRooms(legacy);
      if (!all.length && !legacy.length) toast.info("There are no active codes for the selected room(s).");
      else if (all.length) toast.success(`Loaded ${all.length} existing QR code${all.length === 1 ? "" : "s"} for viewing and printing.`);
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  };

  return <section className="rounded-2xl border bg-white p-4 sm:p-6 shadow-sm space-y-4">
    <h2 className="text-xl font-semibold flex items-center gap-2"><QrCode className="h-5 w-5" /> Room QR codes for guest phones</h2>
    <p className="text-sm text-slate-600">
      Each room gets its own QR. A guest who scans it sees this hotel's In-Suite services on their phone —
      no app, no typed code. Requests still unlock only after reception verifies the checked-in stay.
      Codes remain valid across stays. Managers can view and reprint current codes without replacing them.
      Regenerate only when a code is exposed or needs to be revoked.
    </p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="block space-y-1.5 text-sm font-semibold">
        <span>Single room</span>
        <select className="w-48 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
          value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Select room</option>
          {sortedRooms.map((r) => <option key={r.id} value={r.id}>
            Room {r.room_number}{qrRooms.has(r.id) ? " · has QR" : ""}</option>)}
        </select>
      </label>
      <button disabled={!selected || busy} className="rounded-xl bg-slate-900 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
        onClick={() => void generate([selected], "Generate a QR code for this room?")}>
        Generate for room
      </button>
      <button disabled={!selected || !qrRooms.has(selected) || busy}
        className="rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
        onClick={() => void viewExisting([selected])}>View selected QR</button>
      <button disabled={!qrRooms.size || busy}
        className="rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
        onClick={() => void viewExisting(sortedRooms.filter((r) => qrRooms.has(r.id)).map((r) => r.id))}>
        <QrCode className="h-4 w-4 inline mr-1" /> View all existing ({qrRooms.size})
      </button>
      <button disabled={!rooms.length || busy} className="rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
        onClick={() => void generate(sortedRooms.filter((r) => !qrRooms.has(r.id)).map((r) => r.id),
          `Generate codes for the ${rooms.length - qrRooms.size} rooms without one?`)}
        hidden={qrRooms.size === rooms.length}>
        Generate missing
      </button>
      <button disabled={!rooms.length || busy} className="rounded-xl border border-amber-200 text-amber-900 px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
        onClick={() => void generate(sortedRooms.map((r) => r.id), `Replace QR codes for all ${rooms.length} rooms of ${hotelName}?`)}>
        <RefreshCw className="h-4 w-4 inline mr-1" /> Generate for all {rooms.length} rooms
      </button>
    </div>
    <p className="text-xs text-slate-500">
      {qrRooms.size} of {rooms.length} rooms currently have an active QR code.
      Tokens are stored as hashes. New codes can be securely reconstructed for authorized managers.
      Older codes must be reissued once to enable this feature.
    </p>
    {legacyRooms.length > 0 && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      {legacyRooms.length} older QR code(s) cannot be recovered from their original one-way hashes.
      Their printed codes still work. Select those rooms and generate replacements only when ready to reprint.
    </div>}
    {issued.length > 0 && <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-amber-800">
          {issued.length} room QR code(s) ready to view or print. Only show this page to authorized staff.
        </p>
        <button className="rounded-xl bg-slate-900 text-white px-4 py-2.5 text-sm font-semibold"
          onClick={() => window.print()}>
          <Printer className="h-4 w-4 inline mr-1" /> Print QR sheet
        </button>
      </div>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #insuite-qr-print-area, #insuite-qr-print-area * { visibility: visible !important; }
        #insuite-qr-print-area { position: absolute; left: 0; top: 0; width: 100%; }
        .insuite-qr-card { break-inside: avoid; }
      }`}</style>
      <div id="insuite-qr-print-area" className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {issued.map((entry) => <div key={entry.room_id}
          className="insuite-qr-card rounded-2xl border p-5 text-center space-y-3 bg-white">
          <p className="font-semibold" style={{ color: accent || "#153B57" }}>{hotelName}</p>
          <QRCodeSVG value={`${origin}/suite?qr=${entry.token}`} size={180} level="M" includeMargin className="mx-auto" />
          <p className="text-2xl font-bold">Room {entry.room_number}</p>
          <p className="text-sm text-slate-600">Scan for room services, dining & reception chat</p>
        </div>)}
      </div>
    </>}
  </section>;
}
