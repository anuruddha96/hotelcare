export type AiObservation = { created_at: string; valid_until: string };

/** New booking/cancellation evidence invalidates the AI observation; timer ticks do not. */
export function observeAiPrice(policy: AiObservation | null | undefined, now: Date, lastPickupAt: string | null, lastCancellationAt: string | null = null): boolean {
  if (!policy || !Number.isFinite(Date.parse(policy.created_at)) || !Number.isFinite(Date.parse(policy.valid_until))) return false;
  return Date.parse(policy.created_at) <= now.getTime() && Date.parse(policy.valid_until) > now.getTime()
    && !(lastPickupAt && Date.parse(lastPickupAt) > Date.parse(policy.created_at))
    && !(lastCancellationAt && Date.parse(lastCancellationAt) > Date.parse(policy.created_at));
}

export interface AiDate {
  date: string; lead: number; occ: number | null; left: number | null;
  reference: number | null; min_price: number; max_price: number;
  pickup_1h: number; pickup_6h: number; pickup_24h: number; pickup_48h: number; pickup_7d: number;
  quiet_hours: number | null; cancellations_24h: number; down_today: number; up_today: number;
  markdowns_today: number; last_move_at: string | null; captured_at: string | null;
  cells: { obk_id: string; occupancy: number; price: number }[];
  market: { median: number | null; count: number; age_hours: number | null };
  engine_reason: string | null; high_event?: boolean;
  manager_hold_until?: string | null;
  peer_signal?: PeerSignal;
  last_ai_review_at?: string | null;
}

export interface PeerMove {
  hotel: string; at: string; age_h: number; direction: string; delta: number;
  pct: number; confirmed: boolean; [key: string]: unknown;
}
export interface PeerSignal {
  direction: 'increase' | 'decrease' | 'mixed' | 'none';
  hotels: number; latest_at: string | null; peers: PeerMove[];
}
const PEER_HOTELS = new Set(['gozsdu-court','mika-downtown','memories-budapest']);

/** Count hotels, never cells or confirmation retries, as independent evidence. */
export function peerPriceSignal(raw: PeerMove[] = [], now: Date): PeerSignal {
  const latest = new Map<string,PeerMove>();
  for (const p of raw) {
    const age = (now.getTime()-Date.parse(p.at))/3600_000;
    if (!PEER_HOTELS.has(p.hotel) || p.confirmed!==true || !Number.isFinite(age) || age<0 || age>168
      || !Number.isFinite(Number(p.pct)) || !Number.isFinite(Number(p.delta))) continue;
    if (!latest.has(p.hotel) || Date.parse(p.at)>Date.parse(latest.get(p.hotel)!.at)) latest.set(p.hotel,{...p,age_h:Math.round(age*10)/10});
  }
  const peers=[...latest.values()].sort((a,b)=>a.hotel.localeCompare(b.hotel));
  const fresh=peers.filter(p=>p.age_h<=48 && Math.abs(Number(p.pct))>=.5);
  const up=fresh.filter(p=>p.direction==='increase' && Number(p.delta)>0 && Number(p.pct)>0).length;
  const down=fresh.filter(p=>p.direction==='decrease' && Number(p.delta)<0 && Number(p.pct)<0).length;
  const direction: PeerSignal['direction']=!fresh.length?'none':up===fresh.length?'increase':down===fresh.length?'decrease':'mixed';
  return {direction,hotels:fresh.length,latest_at:fresh.map(p=>p.at).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null,peers};
}

/** Preserve urgent dates, react to new peer edits, and rotate every arrival month. */
export function selectAiDates(dates: AiDate[], now: Date, limit = 56): AiDate[] {
  const eligible = dates.filter(d => d.lead >= 0 && d.lead <= 120 && d.left != null && d.left > 0
    && d.occ != null && d.reference != null && d.reference > 0 && d.cells.length === 13
    && d.captured_at != null && now.getTime() - Date.parse(d.captured_at) >= 0
    && now.getTime() - Date.parse(d.captured_at) < 30 * 60_000);
  const reviewAt=(d:AiDate)=>d.last_ai_review_at?Date.parse(d.last_ai_review_at):0;
  const ordered=[...eligible].sort((a,b)=>reviewAt(a)-reviewAt(b) || Number(a.occ)-Number(b.occ) || a.date.localeCompare(b.date));
  const selected=new Map<string,AiDate>();
  const add=(d:AiDate)=>{if(selected.size<limit)selected.set(d.date,d);};
  eligible.filter(d=>d.lead<=3).sort((a,b)=>a.lead-b.lead).forEach(add);
  // Reserve up to half the bounded review for fresh, not-yet-reviewed peer edits.
  ordered.filter(d=>d.lead>3 && d.peer_signal?.latest_at
    && Date.parse(d.peer_signal.latest_at)>reviewAt(d))
    .sort((a,b)=>Number(b.peer_signal!.hotels)-Number(a.peer_signal!.hotels)
      || Date.parse(b.peer_signal!.latest_at!)-Date.parse(a.peer_signal!.latest_at!) || a.date.localeCompare(b.date))
    .slice(0,Math.max(0,Math.floor(limit/2)-selected.size)).forEach(add);
  const months=[...new Set(ordered.map(d=>d.date.slice(0,7)))].sort();
  // Round-robin prevents quiet January from excluding December or later months.
  while(selected.size<Math.min(limit,eligible.length)) {
    const before=selected.size;
    const oldest=reviewAt(ordered.find(d=>!selected.has(d.date))!);
    for(const month of months){
      const next=ordered.find(d=>d.date.startsWith(month) && !selected.has(d.date) && reviewAt(d)===oldest);
      if(next)add(next);
    }
    if(selected.size===before)break;
  }
  return [...selected.values()];
}

/** Reject malformed/unrequested dates before the independent database gate. */
export function validateAiMoves(raw: unknown, dates: AiDate[]): { date: string; delta: number; reason: string; confidence: number }[] {
  if (!Array.isArray(raw)) throw new Error('AI response has no decisions array');
  if (raw.length !== dates.length) throw new Error('AI did not evaluate every supplied date');
  const allowed = new Map(dates.map(d=>[d.date,d]));
  const seen = new Set<string>();
  return raw.map(row => {
    const d = allowed.get(row?.date);
    if (!d || seen.has(row.date) || !Number.isInteger(row.delta)
      || Math.abs(row.delta) > (d.lead <= 3 ? 12 : 6)
      || typeof row.reason !== 'string' || row.reason.trim().length < 20
      || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) {
      throw new Error('AI returned an invalid, duplicate, or unrequested price decision');
    }
    seen.add(row.date);
    return { date: row.date, delta: row.delta, reason: row.reason.slice(0, 800), confidence: row.confidence };
  });
}

export function estimateSupervisorCost(model: string, input: number, output: number): number {
  const prices = model === 'gpt-6-astra' ? [10,50] : model === 'gpt-5.6-sol' ? [4,20]
    : model === 'gpt-5.5' ? [5,30] : model === 'gpt-5.4' ? [2.5,15]
    : model === 'gpt-5.2' ? [1.75,14] : model === 'gpt-4.1' ? [2,8] : [2,10];
  return (input * prices[0] + output * prices[1]) / 1_000_000;
}

export function availableSupervisorModel(ids: string[]): string {
  return ['gpt-6.1-sol','gpt-5.6-sol','gpt-5.5','gpt-5.4','gpt-5.2','gpt-4.1']
    .find(id=>ids.includes(id)) ?? 'gpt-4.1';
}

/** An event is context; persistently empty inventory can earn a small AI test. */
export function softEventTest(date: AiDate, delta: number): boolean {
  return delta < 0 && delta >= -2 && date.occ != null && date.occ < 70
    && Number(date.left) >= 5 && date.pickup_6h === 0
    && (Number(date.quiet_hours) >= 24 || date.occ === 0);
}
