import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileText, Printer, RefreshCw, Shirt } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { resolveHotelKeys } from '@/lib/hotelKeys';
import { getLocalDateString } from '@/lib/utils';
import {
  groupMemoriesLegacyRows, isMemoriesHotel, loadMemoriesLegacyIdMap,
  loadMemoriesLinenCatalogue, memoriesLinenLabel, type MemoriesLinenItem,
} from '@/lib/memoriesLinen';

const editableRoles = ['admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager'];
type Room = { id: string; room_number: string };
type Count = { id: string; room_id: string; housekeeper_id: string; assignment_id: string | null; linen_item_id: string; count: number; work_date: string };
type PublicCount = { linen_item_id: string; count: number };
type MappedCount = Count & { source_linen_item_id: string };
type Person = { id: string; nickname: string | null; full_name: string };
type Session = { key: string; roomId: string; roomNumber: string; personId: string; personName: string; assignmentId: string | null; records: MappedCount[] };
type VendorRow = { key: string; label: string; values: number[]; total: number };

function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0); }

/** Memories-only report. Existing historic item IDs are never overwritten by mapping. */
export function MemoriesLinenManagement() {
  const { profile } = useAuth();
  const [workDate, setWorkDate] = useState(() => getLocalDateString(new Date()));
  const [items, setItems] = useState<MemoriesLinenItem[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [rawCounts, setRawCounts] = useState<Count[]>([]);
  const [rawPublicCounts, setRawPublicCounts] = useState<PublicCount[]>([]);
  const [legacyIds, setLegacyIds] = useState<Record<string, string>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Session | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const canCorrect = !!profile?.role && editableRoles.includes(profile.role);
  const hotel = profile?.assigned_hotel;
  const organization = profile?.organization_slug;

  const load = useCallback(async () => {
    if (!isMemoriesHotel(hotel) || !organization) return;
    setLoading(true);
    setError(null);
    try {
      const keys = await resolveHotelKeys(hotel);
      const [catalogue, roomResult] = await Promise.all([
        loadMemoriesLinenCatalogue(),
        supabase.from('rooms').select('id,room_number')
          .in('hotel', keys).eq('organization_slug', organization),
      ]);
      if (roomResult.error) throw roomResult.error;
      const [aliases, hotelRooms] = await Promise.all([
        loadMemoriesLegacyIdMap(catalogue),
        Promise.resolve(((roomResult.data || []) as Room[])
          .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }))),
      ]);
      const roomIds = hotelRooms.map(room => room.id);
      let roomCounts: Count[] = [];
      if (roomIds.length) {
        const result = await supabase.from('dirty_linen_counts')
          .select('id,room_id,housekeeper_id,assignment_id,linen_item_id,count,work_date')
          .in('room_id', roomIds).eq('work_date', workDate).gt('count', 0);
        if (result.error) throw result.error;
        roomCounts = (result.data || []) as Count[];
      }
      const publicResult = await (supabase as any).from('dirty_linen_public_area_counts')
        .select('linen_item_id,count').in('hotel', keys).eq('work_date', workDate).gt('count', 0);
      if (publicResult.error) throw publicResult.error;
      const personIds = [...new Set(roomCounts.map(row => row.housekeeper_id).filter(Boolean))];
      let profiles: Person[] = [];
      if (personIds.length) {
        const result = await supabase.from('profiles').select('id,nickname,full_name').in('id', personIds);
        if (result.error) throw result.error;
        profiles = (result.data || []) as Person[];
      }
      setItems(catalogue);
      setRooms(hotelRooms);
      setLegacyIds(aliases);
      setRawCounts(roomCounts);
      setRawPublicCounts((publicResult.data || []) as PublicCount[]);
      setPeople(profiles);
    } catch (caught: any) {
      console.error('[MemoriesLinen] report failed', caught);
      setItems([]); setRooms([]); setRawCounts([]); setRawPublicCounts([]); setLegacyIds({}); setPeople([]);
      setError(caught?.message || 'Could not load Hotel Memories dirty linen.');
      toast.error('Could not load Hotel Memories dirty linen.');
    } finally { setLoading(false); }
  }, [hotel, organization, workDate]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!isMemoriesHotel(hotel) || !profile?.id) return;
    const channel = supabase.channel(`memories-linen-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dirty_linen_counts' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dirty_linen_public_area_counts' }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [hotel, profile?.id, load]);

  // Transform only the report's read model. The database always retains the source item IDs.
  const counts = useMemo(() => groupMemoriesLegacyRows(rawCounts, legacyIds), [rawCounts, legacyIds]);
  const publicCounts = useMemo(() => groupMemoriesLegacyRows(rawPublicCounts, legacyIds), [rawPublicCounts, legacyIds]);
  const allowedIds = useMemo(() => new Set(items.map(item => item.id)), [items]);
  const unclassifiedTotal = useMemo(() => counts.filter(row => !allowedIds.has(row.linen_item_id))
    .reduce((total, row) => total + row.count, 0)
    + publicCounts.filter(row => !allowedIds.has(row.linen_item_id))
      .reduce((total, row) => total + row.count, 0), [counts, publicCounts, allowedIds]);

  const sessions = useMemo<Session[]>(() => {
    const names = new Map(people.map(person => [person.id, person.nickname || person.full_name]));
    const numbers = new Map(rooms.map(room => [room.id, room.room_number]));
    const map = new Map<string, Session>();
    counts.filter(row => allowedIds.has(row.linen_item_id)).forEach(row => {
      const key = `${row.room_id}:${row.housekeeper_id}`;
      if (!map.has(key)) map.set(key, {
        key, roomId: row.room_id, roomNumber: numbers.get(row.room_id) || 'Unknown room',
        personId: row.housekeeper_id, personName: names.get(row.housekeeper_id) || 'Unknown staff',
        assignmentId: row.assignment_id, records: [],
      });
      map.get(key)!.records.push(row);
    });
    return [...map.values()].sort((a, b) => a.personName.localeCompare(b.personName)
      || a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
  }, [counts, people, rooms, allowedIds]);

  const vendorRows = useMemo<VendorRow[]>(() => {
    const staff = new Map<string, VendorRow>();
    sessions.forEach(session => {
      if (!staff.has(session.personId)) staff.set(session.personId, {
        key: session.personId, label: session.personName, values: items.map(() => 0), total: 0,
      });
      const entry = staff.get(session.personId)!;
      items.forEach((item, index) => {
        entry.values[index] += session.records.filter(record => record.linen_item_id === item.id)
          .reduce((total, record) => total + record.count, 0);
      });
      entry.total = sum(entry.values);
    });
    return [...staff.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [sessions, items]);

  const publicRow = useMemo<VendorRow>(() => {
    const values = items.map(item => publicCounts.filter(row => row.linen_item_id === item.id)
      .reduce((total, row) => total + row.count, 0));
    return { key: 'public', label: 'Public / Közös terület', values, total: sum(values) };
  }, [items, publicCounts]);
  const totals = useMemo(() => items.map((_, index) => vendorRows.reduce((n, row) => n + row.values[index], publicRow.values[index] || 0)), [items, vendorRows, publicRow]);
  const grandTotal = sum(totals);
  const vendorItemTotalsByName = useMemo(
    () => new Map(items.map((item, index) => [item.name, totals[index] || 0])),
    [items, totals],
  );
  const vendorTemplateRows = useMemo(() => [
    { label: 'Hotel - paplanhuzat mosása', sent: vendorItemTotalsByName.get('duvet_covers') || 0 },
    { label: 'Hotel - párnahuzat nagy mosása', sent: vendorItemTotalsByName.get('big_pillow') || 0 },
    { label: 'Hotel - párnahuzat kicsi mosása', sent: vendorItemTotalsByName.get('small_pillow') || 0 },
    { label: 'Hotel - lepedő mosása (180x290)', sent: vendorItemTotalsByName.get('bed_sheets_twin_size') || 0 },
    { label: 'Hotel - lepedő francia mosása', sent: 0 },
    { label: 'Hotel - fürdőlepedő mosása', sent: vendorItemTotalsByName.get('big_towel') || 0 },
    { label: 'Hotel - kéztörlő mosása', sent: vendorItemTotalsByName.get('small_towel') || 0 },
    { label: 'Hotel - kádelő mosása', sent: vendorItemTotalsByName.get('bath_mat') || 0 },
    { label: 'Hotel - ágysál mosása', sent: 0 },
    { label: 'Hotel - ágytakaró mosása', sent: 0 },
    { label: 'Hotel - díszpárnahuzat mosása', sent: 0 },
  ], [vendorItemTotalsByName]);
  const vendorDate = workDate ? `${workDate.replaceAll('-', '.') }.` : '';
  const blankCount = Math.max(0, 7 - vendorRows.length);
  const sheetRows = useMemo(() => [
    ...vendorRows,
    ...Array.from({ length: blankCount }, (_, index) => ({ key: `empty-${index}`, label: '', values: items.map(() => 0), total: 0 })),
    publicRow,
    { key: 'total', label: 'TOTAL / ÖSSZESEN', values: totals, total: grandTotal },
  ], [vendorRows, blankCount, items, publicRow, totals, grandTotal]);

  const fixedLegacyCount = (session: Session, itemId: string): number => session.records
    .filter(row => row.linen_item_id === itemId && row.source_linen_item_id !== itemId)
    .reduce((total, row) => total + row.count, 0);
  const openEditor = (session: Session) => {
    setEditor(session);
    setDraft(Object.fromEntries(items.map(item => [item.id, session.records
      .filter(record => record.linen_item_id === item.id).reduce((n, record) => n + record.count, 0)])));
  };

  const saveEditor = async () => {
    if (!editor || !canCorrect || !organization || saving) return;
    // Never delete, merge or silently reclassify historic records. Managers may only
    // correct the currently active canonical record above the preserved legacy baseline.
    const belowLegacy = items.find(item => (draft[item.id] || 0) < fixedLegacyCount(editor, item.id));
    if (belowLegacy) {
      toast.error(`Cannot set ${memoriesLinenLabel(belowLegacy)} below its preserved historical count. Review original records separately.`);
      return;
    }
    setSaving(true);
    try {
      for (const item of items) {
        const records = editor.records.filter(record => record.linen_item_id === item.id && record.source_linen_item_id === item.id);
        const original = records.reduce((n, row) => n + row.count, 0);
        const next = (draft[item.id] || 0) - fixedLegacyCount(editor, item.id);
        if (original === next) continue;
        if (next === 0 && records.length) {
          const result = await supabase.from('dirty_linen_counts').delete().in('id', records.map(row => row.id));
          if (result.error) throw result.error;
        } else if (records.length) {
          const result = await supabase.from('dirty_linen_counts').update({ count: next }).eq('id', records[0].id);
          if (result.error) throw result.error;
          if (records.length > 1) {
            const extras = await supabase.from('dirty_linen_counts').delete().in('id', records.slice(1).map(row => row.id));
            if (extras.error) throw extras.error;
          }
        } else if (next > 0) {
          const result = await supabase.from('dirty_linen_counts').insert({
            room_id: editor.roomId, housekeeper_id: editor.personId, assignment_id: editor.assignmentId,
            linen_item_id: item.id, work_date: workDate, count: next, organization_slug: organization,
          });
          if (result.error) throw result.error;
        }
      }
      setEditor(null);
      await load();
      toast.success('Room linen counts updated. Historical records preserved.');
    } catch (caught: any) {
      console.error('[MemoriesLinen] correction failed', caught);
      toast.error(caught?.message || 'Could not save linen correction.');
    } finally { setSaving(false); }
  };

  const exportExcel = async () => {
    if (loading || error || !items.length || saving) return;
    try {
      const XLSX = await import('xlsx');
      const matrix: (string | number)[][] = [
        ['Hotel Memories Budapest — Dirty linen / Szennyes textília'],
        [`Date / Dátum: ${workDate}`],
        ['Housekeepers / Takarítók', ...items.map(item => memoriesLinenLabel(item, true)), 'Total / Összesen'],
        ...sheetRows.map(row => [row.label, ...row.values, row.total]),
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(matrix);
      worksheet['!cols'] = [{ wch: 26 }, ...items.map(() => ({ wch: 24 })), { wch: 18 }];
      worksheet['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: items.length + 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: items.length + 1 } },
      ];
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, worksheet, 'Dirty Linen');
      XLSX.writeFile(book, `Hotel-Memories-dirty-linen-${workDate}.xlsx`);
    } catch (caught) { console.error('[MemoriesLinen] Excel export failed', caught); toast.error('Excel export failed.'); }
  };

  const printSheet = () => {
    if (loading || error || !items.length || saving) return;
    const previousTitle = document.title;
    document.title = `Memories-Mosoda-${workDate}`;
    window.print();
    window.setTimeout(() => { document.title = previousTitle; }, 0);
  };

  if (!isMemoriesHotel(hotel)) return null;
  return <div className="space-y-5" data-testid="memories-linen-management">
    <style>{`
      #memories-vendor-print { display: none; }
      @media print {
        @page { size: A4 portrait; margin: 8mm; }
        html, body { width: 210mm; min-height: 297mm; background: white !important; }
        body * { visibility: hidden !important; }
        #memories-vendor-print, #memories-vendor-print * { visibility: visible !important; }
        #memories-vendor-print {
          display: block !important;
          position: absolute !important;
          left: 0;
          top: 0;
          width: 194mm;
          background: white !important;
          color: black !important;
          font-family: "Times New Roman", Times, serif;
        }
        #memories-vendor-print .vendor-sheet {
          width: 100%;
          border: 1.4px solid #000;
          box-sizing: border-box;
        }
        #memories-vendor-print table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          color: #000 !important;
        }
        #memories-vendor-print th,
        #memories-vendor-print td {
          border: 1px solid #000 !important;
          color: #000 !important;
          vertical-align: middle;
        }
        #memories-vendor-print .vendor-title {
          display: grid;
          grid-template-columns: 40% 60%;
          align-items: center;
          min-height: 31mm;
          border-bottom: 1px solid #000;
        }
        #memories-vendor-print .vendor-logo {
          padding-left: 4mm;
          font-family: Arial, Helvetica, sans-serif;
          font-weight: 800;
          font-size: 9mm;
          line-height: .72;
          letter-spacing: -0.7mm;
        }
        #memories-vendor-print .vendor-logo small {
          display: block;
          font-size: 3.1mm;
          line-height: 1.1;
          letter-spacing: .1mm;
          margin-left: .5mm;
          margin-top: 1.5mm;
          font-weight: 700;
        }
        #memories-vendor-print .vendor-work-title {
          text-align: center;
          font-size: 8.5mm;
          font-weight: 500;
        }
        #memories-vendor-print .vendor-meta td,
        #memories-vendor-print .vendor-meta th {
          height: 8mm;
          padding: 0 1.5mm;
          font-size: 3.5mm;
          text-align: left;
        }
        #memories-vendor-print .vendor-meta .vendor-customer th {
          font-size: 5.6mm;
          font-weight: 700;
          height: 10mm;
        }
        #memories-vendor-print .vendor-meta .vendor-customer th:last-child {
          text-align: center;
        }
        #memories-vendor-print .vendor-main th {
          text-align: center;
          font-size: 3.7mm;
          font-weight: 500;
          line-height: 1.15;
          height: 10mm;
          padding: 1mm;
        }
        #memories-vendor-print .vendor-main thead tr:first-child th {
          height: 11mm;
        }
        #memories-vendor-print .vendor-main td {
          height: 7.3mm;
          padding: 0 1.3mm;
          font-size: 3.2mm;
        }
        #memories-vendor-print .vendor-main td.vendor-number {
          text-align: center;
          font-size: 3.7mm;
          font-weight: 700;
        }
        #memories-vendor-print .vendor-footer td {
          height: 8.5mm;
          padding: 0 1.3mm;
          font-size: 3.1mm;
          font-weight: 700;
        }
        #memories-vendor-print tr { break-inside: avoid; }
      }
    `}</style>
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div><h2 className="text-2xl font-bold flex items-center gap-2"><Shirt className="h-5 w-5" />Dirty Linen Management</h2>
        <p className="text-sm text-muted-foreground">Hotel Memories Budapest · exact seven-column laundry provider order</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => { void load(); }} disabled={loading || saving}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
        <Button variant="outline" onClick={printSheet} disabled={loading || saving || !!error || !items.length}><Printer className="h-4 w-4 mr-1" />Print / Save PDF</Button>
        <Button variant="outline" onClick={() => { void exportExcel(); }} disabled={loading || saving || !!error || !items.length}><Download className="h-4 w-4 mr-1" />Excel (.xlsx)</Button>
      </div>
    </div>
    <label className="flex items-center gap-2 flex-wrap text-sm font-medium">Collection date / Gyűjtés dátuma
      <Input aria-label="Collection date" type="date" value={workDate} onChange={event => setWorkDate(event.target.value)} className="w-48" />
    </label>
    {error && <Card role="alert" className="p-3 text-destructive">{error}</Card>}
    {!!unclassifiedTotal && <Card role="alert" className="p-3 text-amber-700 text-sm">
      {unclassifiedTotal} items were recorded under other historical categories and are not included in the seven-column provider sheet.
      Queen-size sheets and small/big pillow covers ARE included in their approved columns; remaining unclassified items are preserved. Review before sending.
    </Card>}
    <Card id="memories-linen-print" className="p-4 overflow-x-auto">
      <h3 className="font-bold text-lg mb-1">Hotel Memories Budapest — Dirty linen / Szennyes textília</h3>
      <p className="text-sm mb-4">Date / Dátum: {workDate}</p>
      <table className="w-full min-w-[850px] border-collapse text-xs" aria-label="Hotel Memories laundry provider collection sheet">
        <thead><tr>
          <th className="border p-2 text-left w-40">Housekeepers / Takarítók</th>
          {items.map(item => <th key={item.id} className="border p-2 text-center break-words">{memoriesLinenLabel(item, true)}</th>)}
          <th className="border p-2 text-center">TOTAL / ÖSSZESEN</th>
        </tr></thead>
        <tbody>{sheetRows.map((row, index) => <tr key={row.key} className={row.key === 'total' ? 'font-bold bg-muted/40' : ''}>
          <td className="border p-2">{row.key === 'public' || row.key === 'total' ? row.label : `${index + 1}. ${row.label}`}</td>
          {row.values.map((value, itemIndex) => <td key={items[itemIndex]?.id || itemIndex} className="border p-2 text-center tabular-nums">{value}</td>)}
          <td className="border p-2 text-center font-semibold tabular-nums">{row.total}</td>
        </tr>)}</tbody>
      </table>
      <p className="mt-3 text-sm font-semibold">Total pieces / Összes darab: {grandTotal}</p>
      {!!unclassifiedTotal && <p className="text-xs mt-1">Attention: {unclassifiedTotal} unclassified historical items excluded. Review before dispatch.</p>}
    </Card>
    <div id="memories-vendor-print" aria-hidden="true">
      <div className="vendor-sheet">
        <div className="vendor-title">
          <div className="vendor-logo">Deluxe<br />mosoda<small>laundry service</small></div>
          <div className="vendor-work-title">Munkalap</div>
        </div>
        <table className="vendor-meta" aria-label="Deluxe Mosoda work sheet header">
          <tbody>
            <tr className="vendor-customer"><th>MEGRENDELŐ:</th><th>MEMORIES</th></tr>
            <tr><td>Szállítólevél száma :</td><td>Beérkezés dátuma: <strong>{vendorDate}</strong></td></tr>
            <tr><td>Feldolgozás dátuma:</td><td>Kiszállítás dátuma:</td></tr>
          </tbody>
        </table>
        <table className="vendor-main" aria-label="Deluxe Mosoda laundry quantities">
          <colgroup>
            <col style={{ width: '39%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2}>Megnevezés</th>
              <th rowSpan={2}>Mosodába<br />beküldött</th>
              <th colSpan={2}>Visszaküldött</th>
              <th rowSpan={2}>Mosodában<br />marad</th>
            </tr>
            <tr><th>Tiszta</th><th>Foltos</th></tr>
          </thead>
          <tbody>
            {vendorTemplateRows.map(row => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="vendor-number">{row.sent > 0 ? row.sent : ''}</td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            ))}
            {Array.from({ length: 7 }, (_, index) => (
              <tr key={`vendor-empty-${index}`}><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>
            ))}
          </tbody>
        </table>
        <table className="vendor-footer" aria-label="Deluxe Mosoda work sheet footer">
          <tbody>
            <tr><td>Elkészítette:</td><td>Bejövő kocsiszám:</td><td>Súly norm:</td></tr>
            <tr><td>Ellenőrizte:</td><td>Kimenő kocsiszám:</td><td>Súly foltos:</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <Card className="p-4 space-y-3">
      <h3 className="font-bold flex items-center gap-2"><FileText className="h-4 w-4" />Room-level collection and manager corrections</h3>
      <p className="text-sm text-muted-foreground">Choose a room to correct active-category quantities. Approved historical sheets and pillow covers are included in totals but retained separately in the database.</p>
      {!sessions.length ? <p className="text-sm text-muted-foreground">{loading ? 'Loading…' : 'No recorded room linen for this date.'}</p> :
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{sessions.map(session => <Button
          key={session.key} variant="outline" className="h-auto py-3 justify-between text-left"
          disabled={!canCorrect || loading || saving} onClick={() => openEditor(session)}>
          <span className="truncate">{session.personName} · Room {session.roomNumber}</span>
          <span className="ml-2 font-bold tabular-nums">{sum(session.records.map(row => row.count))}</span>
        </Button>)}</div>}
    </Card>
    <Dialog open={!!editor} onOpenChange={open => { if (!open && !saving) setEditor(null); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Correct linen: {editor?.personName} · Room {editor?.roomNumber}</DialogTitle></DialogHeader>
        <div className="space-y-3">{items.map(item => <label key={item.id} className="flex items-center justify-between gap-2 text-sm">
          <span>{memoriesLinenLabel(item, true)}{editor && fixedLegacyCount(editor, item.id) > 0 &&
            <small className="block text-muted-foreground">Includes {fixedLegacyCount(editor, item.id)} preserved historical pieces (minimum editable total).</small>}</span>
          <Input type="number" min={editor ? fixedLegacyCount(editor, item.id) : 0} step={1} inputMode="numeric" aria-label={memoriesLinenLabel(item, true)}
            className="w-20 text-center" disabled={!canCorrect || saving} value={draft[item.id] || 0}
            onChange={event => setDraft(old => ({ ...old, [item.id]: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))} />
        </label>)}
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={() => setEditor(null)}>Cancel</Button>
            <Button disabled={!canCorrect || saving} onClick={() => { void saveEditor(); }}>{saving ? 'Saving…' : 'Save corrections'}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}
