/* eslint-disable @typescript-eslint/no-explicit-any -- the NAV/reconciliation tables are not in the generated Supabase types yet */
/**
 * Client helpers for the purchase-invoice NAV reconciliation UI.
 * Every write goes through Edge Functions or RLS-guarded tables; nothing here
 * talks to NAV directly and no credential ever reaches the browser.
 */
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';

export const DOCUMENT_NAV_STATUSES = [
  'not_checked', 'exact_match', 'probable_match', 'document_only', 'data_mismatch', 'duplicate_document',
  'competing_nav_candidates', 'correction_chain', 'nav_sync_pending', 'not_expected', 'manual_resolution',
] as const;
export const NAV_RECORD_STATUSES = [
  'exact_match', 'probable_match', 'nav_only', 'data_mismatch', 'competing_nav_candidates', 'correction_chain',
  'not_expected', 'manual_resolution',
] as const;
export const BLOCKING_NAV_STATUSES = new Set(['data_mismatch', 'duplicate_document', 'competing_nav_candidates', 'correction_chain']);
export const MATCHED_NAV_STATUSES = new Set(['exact_match', 'probable_match', 'manual_resolution']);

export type Tone = 'ok' | 'warn' | 'error' | 'info' | 'muted';
export function navStatusTone(status: string | null | undefined): Tone {
  if (!status) return 'muted';
  if (status === 'exact_match' || status === 'manual_resolution') return 'ok';
  if (status === 'probable_match' || status === 'nav_sync_pending' || status === 'correction_chain') return 'warn';
  if (BLOCKING_NAV_STATUSES.has(status) || status === 'nav_only' || status === 'document_only') return 'error';
  if (status === 'not_expected') return 'info';
  return 'muted';
}
export const TONE_CLASSES: Record<Tone, string> = {
  ok: 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5',
  warn: 'border-amber-500/60 text-amber-700 dark:text-amber-400 bg-amber-500/5',
  error: 'border-destructive/50 text-destructive bg-destructive/5',
  info: 'border-sky-500/50 text-sky-700 dark:text-sky-400 bg-sky-500/5',
  muted: 'border-border text-muted-foreground',
};

/** Invokes an Edge Function and surfaces the server's own error message. */
export async function invokeFn<T = any>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = (error as any)?.message || 'Request failed';
    try {
      const res = (error as any)?.context;
      if (res && typeof res.json === 'function') {
        const payload = await res.json();
        if (payload?.error) message = String(payload.error);
      }
    } catch { /* body not JSON */ }
    throw new Error(message);
  }
  if (data && (data as any).ok === false) throw new Error(String((data as any).error ?? 'Request failed'));
  return data as T;
}

export const navAdmin = <T = any>(action: string, payload: Record<string, unknown> = {}) =>
  invokeFn<T>('nav-connection-admin', { action, ...payload });
export const syncNavNow = (connectionId?: string, backfill = false) =>
  invokeFn('nav-sync', { trigger: 'manual', ...(connectionId ? { connection_id: connectionId } : {}), ...(backfill ? { backfill: true } : {}) });
export const reconcileNow = () => invokeFn('reconcile-purchase-invoices', { action: 'run' });
export const reconDecision = (action: 'manual_match' | 'mark_not_expected' | 'mark_nav_not_expected' | 'clear_manual' | 'resolve_conflict', payload: Record<string, unknown>) =>
  invokeFn('reconcile-purchase-invoices', { action, ...payload });

/** Fire-and-forget re-evaluation after a user edit; failures never block the user. */
export function requestReconcile() {
  reconcileNow().catch(() => { /* the scheduled run catches up */ });
}

/** Pages through a table with RLS applied (Supabase caps a response at 1000 rows). */
export async function fetchAll<T = any>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>, max = 20000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message ?? 'Query failed');
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export interface CurrencyTotal { currency: string; count: number; total: number }
/** Totals per currency — amounts in different currencies are never added together. */
export function totalsByCurrency<T>(rows: T[], amount: (row: T) => number | null | undefined, currency: (row: T) => string | null | undefined): CurrencyTotal[] {
  const map = new Map<string, CurrencyTotal>();
  for (const row of rows) {
    const value = Number(amount(row));
    if (!Number.isFinite(value)) continue;
    const cur = (currency(row) || 'HUF').toUpperCase();
    const entry = map.get(cur) ?? { currency: cur, count: 0, total: 0 };
    entry.count += 1;
    entry.total = Math.round((entry.total + value) * 100) / 100;
    map.set(cur, entry);
  }
  return [...map.values()].sort((a, b) => (a.currency === 'HUF' ? -1 : b.currency === 'HUF' ? 1 : a.currency.localeCompare(b.currency)));
}

export function formatMoney(amount: number | null | undefined, currency: string | null | undefined, locale = 'hu-HU'): string {
  if (amount == null || !Number.isFinite(Number(amount))) return '—';
  const cur = (currency || 'HUF').toUpperCase();
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: cur, maximumFractionDigits: cur === 'HUF' ? 0 : 2 }).format(Number(amount));
  } catch {
    return `${Number(amount).toLocaleString(locale)} ${cur}`;
  }
}

export function daysSince(date: string | null | undefined, now = new Date()): number | null {
  if (!date) return null;
  const t = Date.parse(date.length === 10 ? `${date}T00:00:00` : date);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / 86_400_000)) : null;
}

/** Real .xlsx export (one sheet per entry). */
export function exportWorkbook(sheets: Array<{ name: string; rows: Record<string, unknown>[] }>, filename: string) {
  const book = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows.length ? sheet.rows : [{}]);
    XLSX.utils.book_append_sheet(book, ws, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(book, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

export function exportCsvRows(rows: Record<string, unknown>[], filename: string) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/** Parses an uploaded CSV/XLSX register into plain row objects (first sheet). */
export async function readSpreadsheet(file: File): Promise<Record<string, unknown>[]> {
  const buffer = await file.arrayBuffer();
  const book = XLSX.read(buffer, { type: 'array', cellDates: false, raw: false });
  const sheet = book.Sheets[book.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
}

const COLUMN_ALIASES: Record<string, string[]> = {
  supplier_tax_number: ['supplier_tax_number', 'szallito_adoszam', 'szállító adószám', 'szállító adószáma', 'eladó adószám', 'adószám', 'supplier tax', 'vendor tax id', 'tax id'],
  supplier_name: ['supplier_name', 'szállító', 'szállító neve', 'partner', 'eladó', 'supplier', 'vendor'],
  invoice_number: ['invoice_number', 'számlaszám', 'szamlaszam', 'bizonylatszám', 'invoice no', 'invoice number', 'document number'],
  issue_date: ['issue_date', 'kelt', 'kiállítás dátuma', 'számla kelte', 'invoice date', 'date'],
  performance_date: ['performance_date', 'teljesítés', 'teljesítés dátuma', 'delivery date'],
  due_date: ['due_date', 'fizetési határidő', 'esedékesség', 'due date'],
  currency: ['currency', 'pénznem', 'deviza'],
  net_amount: ['net_amount', 'nettó', 'nettó összeg', 'net'],
  vat_amount: ['vat_amount', 'áfa', 'áfa összeg', 'vat'],
  gross_amount: ['gross_amount', 'bruttó', 'bruttó összeg', 'gross', 'total', 'végösszeg'],
  buyer_tax_number: ['buyer_tax_number', 'vevő adószám', 'vevő adószáma', 'buyer tax', 'customer tax id'],
  document_kind: ['document_kind', 'bizonylat típus', 'típus', 'document type'],
  hotel_id: ['hotel_id', 'property', 'szálloda'],
  payment_method: ['payment_method', 'fizetési mód', 'payment method'],
};
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Maps free-form register headers (HU/EN) to the import fields. */
export function mapImportColumns(rows: Record<string, unknown>[]): { mapping: Record<string, string>; mapped: Record<string, unknown>[] } {
  const headers = Object.keys(rows[0] ?? {});
  const mapping: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const wanted = aliases.map(norm);
    const hit = headers.find((h) => wanted.includes(norm(h)));
    if (hit) mapping[field] = hit;
  }
  const mapped = rows.map((r) => Object.fromEntries(Object.entries(mapping).map(([field, header]) => [field, r[header]])));
  return { mapping, mapped };
}
