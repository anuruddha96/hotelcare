/* eslint-disable @typescript-eslint/no-explicit-any -- test double for the untyped supabase-js builder */
/**
 * Minimal in-memory stand-in for the supabase-js query builder, covering the
 * calls the purchase-invoice runners make. Synthetic data only.
 */
type Row = Record<string, any>;
type Rpc = (args: Record<string, any>, db: FakeSupabase) => any;

let idSeq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++idSeq).padStart(12, '0')}`;

class Query implements PromiseLike<{ data: any; error: any; count?: number | null }> {
  private filters: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: any = null;
  private upsertConflict: string[] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private mode: 'many' | 'single' | 'maybe' = 'many';
  private returning = false;
  private headOnly = false;

  constructor(private readonly db: FakeSupabase, private readonly table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op !== 'select') this.returning = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(p: Row | Row[]) { this.op = 'insert'; this.payload = p; return this; }
  update(p: Row) { this.op = 'update'; this.payload = p; return this; }
  upsert(p: Row | Row[], o?: { onConflict?: string }) {
    this.op = 'upsert'; this.payload = p; this.upsertConflict = (o?.onConflict ?? 'id').split(','); return this;
  }
  delete() { this.op = 'delete'; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this; }
  in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  lt(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] < v); return this; }
  lte(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] <= v); return this; }
  gt(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] > v); return this; }
  is(c: string, v: any) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  not(c: string, op: string, v: any) {
    if (op === 'is') this.filters.push((r) => (r[c] ?? null) !== v);
    else if (op === 'in') {
      const list = String(v).replace(/[()]/g, '').split(',');
      this.filters.push((r) => !list.includes(String(r[c])));
    }
    return this;
  }
  order(c: string, o?: { ascending?: boolean }) { this.orderBy = { col: c, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.limitN = n; return this; }
  range(a: number, b: number) { this.rangeFrom = a; this.rangeTo = b; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  then<T1 = any, T2 = never>(ok?: ((v: any) => T1 | PromiseLike<T1>) | null, bad?: ((e: any) => T2 | PromiseLike<T2>) | null) {
    return Promise.resolve().then(() => this.exec()).then(ok, bad);
  }

  private rows(): Row[] { return this.db.table(this.table); }

  private exec(): { data: any; error: any; count?: number | null } {
    const store = this.rows();
    let affected: Row[] = [];
    if (this.op === 'insert') {
      const items = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const item of items) {
        const row = { id: newId(), created_at: new Date().toISOString(), ...this.db.defaultsFor(this.table), ...structuredClone(item) };
        const err = this.db.check(this.table, row, store);
        if (err) return { data: null, error: { message: err } };
        store.push(row);
        affected.push(row);
      }
    } else if (this.op === 'upsert') {
      const items = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const item of items) {
        const existing = store.find((r) => this.upsertConflict.every((k) => r[k] === item[k]));
        if (existing) { Object.assign(existing, structuredClone(item)); affected.push(existing); }
        else { const row = { id: newId(), ...this.db.defaultsFor(this.table), ...structuredClone(item) }; store.push(row); affected.push(row); }
      }
    } else {
      affected = store.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === 'update') for (const r of affected) Object.assign(r, structuredClone(this.payload));
      if (this.op === 'delete') this.db.tables.set(this.table, store.filter((r) => !affected.includes(r)));
    }
    let out = affected;
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out = [...out].sort((a, b) => (a[col] ?? '') < (b[col] ?? '') ? (asc ? -1 : 1) : (a[col] ?? '') > (b[col] ?? '') ? (asc ? 1 : -1) : 0);
    }
    if (this.rangeFrom != null) out = out.slice(this.rangeFrom, (this.rangeTo ?? out.length) + 1);
    if (this.limitN != null) out = out.slice(0, this.limitN);
    if (this.op !== 'select' && !this.returning) return { data: null, error: null, count: affected.length };
    if (this.headOnly) return { data: null, error: null, count: out.length };
    const data = structuredClone(out);
    if (this.mode === 'single') return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: `expected one row, got ${data.length}` } };
    if (this.mode === 'maybe') return { data: data[0] ?? null, error: null };
    return { data, error: null, count: data.length };
  }
}

export class FakeSupabase {
  tables = new Map<string, Row[]>();
  rpcs = new Map<string, Rpc>();
  rpcCalls: Array<{ name: string; args: Record<string, any> }> = [];
  uniques = new Map<string, string[][]>();
  columnDefaults = new Map<string, Row>();
  /** Column defaults applied on insert, like Postgres DEFAULT clauses. */
  defaults(name: string, values: Row) { this.columnDefaults.set(name, values); return this; }
  defaultsFor(name: string): Row { return structuredClone(this.columnDefaults.get(name) ?? {}); }

  table(name: string): Row[] {
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name)!;
  }
  seed(name: string, rows: Row[]) { this.table(name).push(...rows.map((r) => ({ id: r.id ?? newId(), ...r }))); return this; }
  unique(name: string, ...keys: string[][]) { this.uniques.set(name, keys); return this; }
  check(name: string, row: Row, store: Row[]): string | null {
    for (const keys of this.uniques.get(name) ?? []) {
      if (store.some((r) => keys.every((k) => r[k] === row[k]))) return `duplicate key value violates unique constraint (${keys.join(',')})`;
    }
    return null;
  }
  from(name: string) { return new Query(this, name); }
  async rpc(name: string, args: Record<string, any> = {}) {
    this.rpcCalls.push({ name, args });
    const fn = this.rpcs.get(name);
    if (!fn) return { data: null, error: { message: `rpc ${name} not mocked` } };
    try { return { data: await fn(args, this), error: null }; } catch (e: any) { return { data: null, error: { message: e?.message ?? String(e) } }; }
  }
}
