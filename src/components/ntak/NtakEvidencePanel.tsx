import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { callNtak } from './ntakApi';
import { evidenceZip, safeEvidenceName, type EvidenceFile } from './evidenceZip';

interface Attempt {
  id: string; message_id: string; kind: 'booking' | 'event' | 'closure' | 'start_date';
  ref: string; uzenet_id: string; sent_at: string; evidence_day: string;
  processing_id: string | null; status: string; environment: string; http_status: number | null;
}
interface Exchange extends Attempt { request_xml: string | null; response_xml: string | null; query_id: string | null }
interface Detail { attempt: Exchange; verifications: Exchange[] }
const prefix = { booking: 'ELO', event: 'ES', closure: 'NZ', start_date: 'AD_01' };
const baseName = (a: Attempt) => prefix[a.kind] + '_' + safeEvidenceName(a.ref);
const stamp = (value: string) => new Intl.DateTimeFormat('hu-HU', { timeZone: 'Europe/Budapest', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
const eventTime = (a: Exchange) => {
  if (a.kind === 'closure') return a.ref;
  const dates = [...new Set([...(a.request_xml ?? '').matchAll(/<(?:v9:)?(?:idopont|foglalasIdopont)>([^<]+)<\/(?:v9:)?(?:idopont|foglalasIdopont)>/g)].map(m => m[1]))];
  return dates.join('; ') || (a.kind === 'start_date' ? stamp(a.sent_at) : 'Not recorded');
};
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function xmlFile(text: string, name: string) { save(new Blob([text], { type: 'application/xml;charset=utf-8' }), name); }
function filesFor(detail: Detail, base: string): EvidenceFile[] {
  const files: EvidenceFile[] = [];
  function add(value: string | null, suffix: string) {
    if (value !== null && value !== '') files.push({ name: base + '_' + suffix + '.xml', text: value });
  }
  add(detail.attempt.request_xml, 'request'); add(detail.attempt.response_xml, 'response');
  detail.verifications.forEach((v, i) => {
    const part = i === detail.verifications.length - 1 ? 'verify' : 'verify_' + (i + 1);
    add(v.request_xml, part + '_request'); add(v.response_xml, part + '_response');
  });
  return files;
}
function logLine(d: Detail): string {
  const a = d.attempt;
  return [prefix[a.kind], a.ref, a.uzenet_id, eventTime(a), stamp(a.sent_at), a.processing_id ?? '—', a.status,
    a.request_xml ? 'Request stored' : 'Request unavailable', a.response_xml ? 'Response stored' : 'Response unavailable',
    ...d.verifications.map(v => 'Verification ' + (v.query_id ?? '—') + ' / ' + stamp(v.sent_at) + ' / ' + v.status)].join(' | ');
}
function XmlRow({ name, xml, onError }: { name: string; xml: string | null; onError: (s: string) => void }) {
  return <div className="flex flex-wrap items-center gap-2 border-t py-2">
    <span className="break-all flex-1">{name}</span>
    {xml ? <>
      <Button type="button" variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(xml).catch(() => onError('Clipboard unavailable; use Download.')); }}>Copy</Button>
      <Button type="button" variant="outline" size="sm" onClick={() => xmlFile(xml, name)}>Download</Button>
      <details className="w-full"><summary className="cursor-pointer">View raw XML / response</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all bg-muted p-2">{xml}</pre></details>
    </> : <span className="text-muted-foreground">Not available / not received</span>}
  </div>;
}

export function NtakEvidencePanel({ hotelId, today }: { hotelId: string; today: string }) {
  const [from, setFrom] = useState(today), [to, setTo] = useState(today);
  const [kind, setKind] = useState('all'), [environment, setEnvironment] = useState('test');
  const [rows, setRows] = useState<Attempt[]>([]), [loaded, setLoaded] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const request = (id: string) => callNtak<Detail>({ action: 'evidence_detail', hotel_id: hotelId, id });
  const reset = () => { setRows([]); setLoaded(false); setDetail(null); setError(''); };
  const run = async (job: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await job(); } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  };
  const load = () => void run(async () => {
    reset();
    const result = await callNtak<{ attempts: Attempt[] }>({ action: 'evidence_list', hotel_id: hotelId, from, to, kind, environment });
    if (mounted.current) { setRows(result.attempts); setLoaded(true); }
  });
  const allDetails = async () => {
    const details: Detail[] = [];
    let size = 0;
    for (const row of rows) {
      if (!mounted.current) throw new Error('Export cancelled');
      const d = await request(row.id);
      size += [d.attempt, ...d.verifications].reduce((sum, v) => sum + (v.request_xml?.length ?? 0) + (v.response_xml?.length ?? 0), 0);
      if (size > 64 * 1024 * 1024) throw new Error('Evidence exceeds 64 MB; narrow your dates.');
      details.push(d);
    }
    return details;
  };
  const exportZip = () => void run(async () => {
    const details = await allDetails();
    if (!mounted.current) return;
    const counts = new Map<string, number>();
    for (const d of details) counts.set(baseName(d.attempt), (counts.get(baseName(d.attempt)) ?? 0) + 1);
    const files = details.flatMap(d => {
      const base = baseName(d.attempt);
      return filesFor(d, counts.get(base)! > 1 ? base + '_' + d.attempt.uzenet_id : base);
    });
    files.push({ name: 'validation_log.txt', text: details.map(logLine).join('\n') });
    save(evidenceZip(files), 'NTAK_' + environment + '_' + from + '_' + to + '.zip');
  });
  const printLog = () => {
    // Open from direct user interaction to avoid browser popup blocking.
    const win = window.open('', '_blank');
    if (!win) { setError('Allow popups to print the validation log.'); return; }
    win.opener = null;
    void run(async () => {
      try {
        const details = await allDetails();
        if (!mounted.current || win.closed) { win.close(); return; }
        win.document.title = 'NTAK Validation log';
        const heading = win.document.createElement('h1'); heading.textContent = 'NTAK Validation log — ' + environment;
        const summary = win.document.createElement('p'); summary.textContent = hotelId + ' | ' + from + ' – ' + to + ' | Europe/Budapest';
        const table = win.document.createElement('table');
        table.style.cssText = 'border-collapse:collapse;width:100%;font:12px sans-serif;overflow-wrap:anywhere';
        const addRow = (values: string[], header = false) => {
          const row = table.insertRow();
          for (const value of values) {
            const cell = win.document.createElement(header ? 'th' : 'td');
            cell.style.cssText = 'border:1px solid #888;padding:5px;text-align:left'; cell.textContent = value; row.appendChild(cell);
          }
        };
        addRow(['Kind / ref', 'Message ID', 'Event time', 'Sent (Budapest)', 'Processing ID', 'Status', 'Verification / evidence'], true);
        for (const d of details) {
          const a = d.attempt;
          addRow([prefix[a.kind] + ' ' + a.ref, a.uzenet_id, eventTime(a), stamp(a.sent_at), a.processing_id ?? '—', a.status,
            (a.request_xml ? 'Signed request stored' : 'Signed request unavailable') + '; ' + (a.response_xml ? 'Response stored' : 'Response unavailable') + '; ' +
            d.verifications.map(v => (v.query_id ?? '—') + ' · ' + stamp(v.sent_at) + ' · ' + v.status).join('; ')]);
        }
        win.document.body.append(heading, summary, table); win.focus(); win.print();
      } catch (e) { win.close(); throw e; }
    });
  };
  return <section className="space-y-3 rounded-md border p-3 text-sm">
    <h3 className="font-semibold">Certification evidence / Validációs napló</h3>
    <p className="text-xs text-muted-foreground">Signed SOAP evidence is captured for new attempts only. Historical XML cannot be recreated. Dates are submission days in Budapest. XML may contain personal data; share only with authorized recipients.</p>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <label>From<Input type="date" value={from} disabled={busy} onChange={e => { setFrom(e.target.value); reset(); }} /></label>
      <label>To<Input type="date" value={to} disabled={busy} onChange={e => { setTo(e.target.value); reset(); }} /></label>
      <label>Kind<select className="block w-full h-10 rounded border bg-background" value={kind} disabled={busy} onChange={e => { setKind(e.target.value); reset(); }}><option value="all">All</option><option value="booking">ELO — Booking</option><option value="event">ES — Stay event</option><option value="closure">NZ — Closure</option><option value="start_date">AD_01 — Start date</option></select></label>
      <label>Environment<select className="block w-full h-10 rounded border bg-background" value={environment} disabled={busy} onChange={e => { setEnvironment(e.target.value); reset(); }}><option value="test">Test</option><option value="production">Production</option></select></label>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" disabled={busy || !from || !to || from > to} onClick={load}>Load evidence</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy || !rows.length} onClick={exportZip}>Download all as ZIP</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy || !rows.length} onClick={printLog}>Print validation log</Button>
    </div>
    {busy && <p role="status">Loading evidence…</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loaded && !rows.length && <p>No recorded attempts in this date range.</p>}
    {rows.map(a => <div key={a.id} className="border rounded p-2 space-y-1">
      <button type="button" className="text-left w-full" disabled={busy} onClick={() => detail?.attempt.id === a.id ? setDetail(null) : void run(async () => { setDetail(null); const d = await request(a.id); if (mounted.current) setDetail(d); })}>
        <strong>{prefix[a.kind]} · {a.ref}</strong> · {stamp(a.sent_at)} · {a.status}
        <span className="block break-all text-xs text-muted-foreground">Message: {a.uzenet_id} | Processing: {a.processing_id ?? '—'}</span>
      </button>
      {detail?.attempt.id === a.id && <div className="text-xs">
        <p>Event time: {eventTime(detail.attempt)}</p>
        <XmlRow name={baseName(a) + '_request.xml'} xml={detail.attempt.request_xml} onError={setError} />
        <XmlRow name={baseName(a) + '_response.xml'} xml={detail.attempt.response_xml} onError={setError} />
        {detail.verifications.length === 0 && <p>No result-query evidence yet.</p>}
        {detail.verifications.map((v, i) => <div key={v.id} className="mt-2">
          <p className="break-all font-medium">Result query {i + 1}: {v.query_id} · {stamp(v.sent_at)} · {v.status}</p>
          <XmlRow name={baseName(a) + '_verify_' + (i + 1) + '_request.xml'} xml={v.request_xml} onError={setError} />
          <XmlRow name={baseName(a) + '_verify_' + (i + 1) + '_response.xml'} xml={v.response_xml} onError={setError} />
        </div>)}
      </div>}
    </div>)}
  </section>;
}
