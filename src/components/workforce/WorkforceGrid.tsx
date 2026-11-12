import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  cellLabel, cellStyle, formatHours, hotelShort, summarizeStaffMonth, WEEKDAY_SHORT, weekdayOf,
  type WorkforceDepartment, type WorkforceEntry, type WorkforceJobRole, type WorkforceStaff,
} from '@/lib/workforce/model';
import {
  entryFromText, inRange, normalizeRange, parseTsv, pasteTargets, textOfEntry, toTsv, type CellRange,
} from '@/lib/workforce/grid';
import type { CustomShiftCode } from '@/lib/workforce/cellParser';
import { entryKey } from '@/hooks/useWorkforce';

export interface CellChange { staff: WorkforceStaff; date: string; next: WorkforceEntry | null }

export interface WorkforceGridProps {
  staff: WorkforceStaff[];
  days: string[];
  today: string;
  departments: WorkforceDepartment[];
  jobRoles: WorkforceJobRole[];
  entries: Map<string, WorkforceEntry>;
  notes: Map<string, string>;
  leaveUsed: Map<string, number>;
  codes: CustomShiftCode[];
  layout: 'days' | 'staff';
  canEdit: (date: string, staff: WorkforceStaff) => boolean;
  onApply: (changes: CellChange[]) => Promise<boolean>;
  onOpenDetails: (staff: WorkforceStaff, date: string) => void;
  onEditNote: (staff: WorkforceStaff) => void;
  onSelectionChange?: (cells: Array<{ staff: WorkforceStaff; date: string }>) => void;
  /** Lets the toolbar apply a code to the current selection. */
  applyRef?: React.MutableRefObject<((text: string) => void) | null>;
}

type Pos = { r: number; c: number };

const SUMMARY_ROWS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'days', label: 'Napok', hint: 'Day shifts (incl. home office, training, extra days)' },
  { key: 'nights', label: 'Éjszakák', hint: 'Night shifts' },
  { key: 'leave', label: 'Szabadság', hint: 'Leave days this month' },
  { key: 'sick', label: 'Betegség', hint: 'Sick days this month' },
  { key: 'off', label: 'Szabadnap', hint: 'Days off (incl. empty days)' },
  { key: 'hours', label: 'Órák', hint: 'Gross hours (breaks not deducted)' },
  { key: 'leaveLeft', label: 'Szabi maradt', hint: 'Annual leave entitlement minus leave taken this year up to this month' },
];

export function WorkforceGrid(props: WorkforceGridProps) {
  const { staff, days, today, departments, jobRoles, entries, notes, leaveUsed, codes, layout, canEdit, onApply, onOpenDetails, onEditNote, onSelectionChange, applyRef } = props;
  const gridRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [focus, setFocus] = useState<Pos | null>(null);
  const [editing, setEditing] = useState<{ pos: Pos; value: string } | null>(null);
  const dragging = useRef(false);
  const undoStack = useRef<CellChange[][]>([]);
  const redoStack = useRef<CellChange[][]>([]);

  const rowCount = layout === 'days' ? days.length : staff.length;
  const colCount = layout === 'days' ? staff.length : days.length;
  const at = useCallback((p: Pos) => (layout === 'days'
    ? { staff: staff[p.c], date: days[p.r] }
    : { staff: staff[p.r], date: days[p.c] }), [layout, staff, days]);

  const range: CellRange | null = anchor && focus ? normalizeRange(anchor, focus) : null;

  // Keep the selection valid when filters change the visible staff.
  useEffect(() => {
    if (focus && (focus.r >= rowCount || focus.c >= colCount)) { setAnchor(null); setFocus(null); setEditing(null); }
  }, [rowCount, colCount, focus]);

  useEffect(() => {
    if (!onSelectionChange) return;
    if (!range) { onSelectionChange([]); return; }
    const cells: Array<{ staff: WorkforceStaff; date: string }> = [];
    for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) cells.push(at({ r, c }));
    onSelectionChange(cells);
  }, [range?.r1, range?.r2, range?.c1, range?.c2, at]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const deptName = new Map(departments.map((d) => [d.id, d]));
    const out: Array<{ id: string; name: string; color: string; span: number }> = [];
    for (const s of staff) {
      const d = s.department_id ? deptName.get(s.department_id) : undefined;
      const id = d?.id ?? 'none';
      const last = out[out.length - 1];
      if (last && last.id === id) last.span++;
      else out.push({ id, name: d?.name ?? 'No department', color: d?.color ?? '#94a3b8', span: 1 });
    }
    return out;
  }, [staff, departments]);
  const roleName = useMemo(() => new Map(jobRoles.map((r) => [r.id, r.name])), [jobRoles]);

  const summaries = useMemo(() => {
    const map = new Map<string, ReturnType<typeof summarizeStaffMonth>>();
    for (const s of staff) {
      const list: WorkforceEntry[] = [];
      for (const d of days) { const e = entries.get(entryKey(s.id, d)); if (e) list.push(e); }
      map.set(s.id, summarizeStaffMonth(list, days.length, s.daily_hours));
    }
    return map;
  }, [staff, days, entries]);

  const summaryValue = (s: WorkforceStaff, key: string): string => {
    const m = summaries.get(s.id);
    if (!m) return '';
    switch (key) {
      case 'days': return String(m.dayShifts);
      case 'nights': return m.nights ? String(m.nights) : '';
      case 'leave': return m.leaveDays ? String(m.leaveDays) : '';
      case 'sick': return m.sickDays ? String(m.sickDays) : '';
      case 'off': return String(m.daysOff);
      case 'hours': return formatHours(m.workedMinutes);
      case 'leaveLeft': return s.annual_leave_days == null ? '' : String(s.annual_leave_days - (leaveUsed.get(s.id) ?? 0));
      default: return '';
    }
  };

  // --- changes -------------------------------------------------------------

  const apply = useCallback(async (changes: CellChange[], record = true) => {
    if (!changes.length) return;
    const before: CellChange[] = changes.map((ch) => ({ staff: ch.staff, date: ch.date, next: entries.get(entryKey(ch.staff.id, ch.date)) ?? null }));
    const ok = await onApply(changes);
    if (ok && record) {
      undoStack.current.push(before);
      if (undoStack.current.length > 50) undoStack.current.shift();
      redoStack.current = [];
    }
    return ok;
  }, [entries, onApply]);

  const changesFromTexts = useCallback((targets: Array<{ pos: Pos; value: string }>) => {
    let locked = 0;
    const changes: CellChange[] = [];
    for (const t of targets) {
      const { staff: s, date } = at(t.pos);
      if (!s || !date) continue;
      if (!canEdit(date, s)) { locked++; continue; }
      const next = entryFromText(t.value, s, date, codes);
      const current = entries.get(entryKey(s.id, date));
      if (!next && !current) continue;
      if (next && current && textOfEntry(current, s.hotel_id) === textOfEntry(next, s.hotel_id) && current.note === next.note) continue;
      changes.push({ staff: s, date, next });
    }
    if (locked) toast.info(`${locked} past ${locked === 1 ? 'day is' : 'days are'} read-only and ${locked === 1 ? 'was' : 'were'} skipped`);
    return changes;
  }, [at, canEdit, codes, entries]);

  const fillSelection = useCallback((text: string) => {
    if (!range) { toast.info('Select one or more cells first'); return; }
    const targets: Array<{ pos: Pos; value: string }> = [];
    for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) targets.push({ pos: { r, c }, value: text });
    void apply(changesFromTexts(targets));
  }, [range, apply, changesFromTexts]);

  useEffect(() => { if (applyRef) applyRef.current = fillSelection; }, [applyRef, fillSelection]);

  const commitEdit = useCallback(async (move?: Pos) => {
    if (!editing) return;
    const { pos, value } = editing;
    setEditing(null);
    await apply(changesFromTexts([{ pos, value }]));
    if (move) {
      const next = { r: Math.min(rowCount - 1, Math.max(0, pos.r + move.r)), c: Math.min(colCount - 1, Math.max(0, pos.c + move.c)) };
      setAnchor(next); setFocus(next);
    }
    gridRef.current?.focus();
  }, [editing, apply, changesFromTexts, rowCount, colCount]);

  const selectionTsv = useCallback(() => {
    if (!range) return '';
    const rows: string[][] = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const row: string[] = [];
      for (let c = range.c1; c <= range.c2; c++) { const { staff: s, date } = at({ r, c }); row.push(textOfEntry(entries.get(entryKey(s.id, date)), s.hotel_id)); }
      rows.push(row);
    }
    return toTsv(rows);
  }, [range, at, entries]);

  const clearSelection = useCallback(() => {
    if (!range) return;
    const targets: Array<{ pos: Pos; value: string }> = [];
    for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) targets.push({ pos: { r, c }, value: '' });
    void apply(changesFromTexts(targets));
  }, [range, apply, changesFromTexts]);

  // Clipboard: listen on the document so Ctrl+C / Ctrl+V work while the grid has focus.
  useEffect(() => {
    const active = () => !!gridRef.current && gridRef.current.contains(document.activeElement) && !editing;
    const onCopy = (e: ClipboardEvent) => {
      if (!active() || !range) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', selectionTsv());
    };
    const onCut = (e: ClipboardEvent) => { if (!active() || !range) return; onCopy(e); clearSelection(); };
    const onPaste = (e: ClipboardEvent) => {
      if (!active() || !range) return;
      const text = e.clipboardData?.getData('text/plain');
      if (text == null) return;
      e.preventDefault();
      const block = parseTsv(text.replace(/\n$/, ''));
      if (!block.length) return;
      const targets = pasteTargets(block, range, rowCount - 1, colCount - 1).map((t) => ({ pos: { r: t.r, c: t.c }, value: t.value }));
      void apply(changesFromTexts(targets));
      const last = targets[targets.length - 1]?.pos;
      if (last) { setAnchor({ r: range.r1, c: range.c1 }); setFocus(last); }
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => { document.removeEventListener('copy', onCopy); document.removeEventListener('cut', onCut); document.removeEventListener('paste', onPaste); };
  }, [range, editing, selectionTsv, clearSelection, apply, changesFromTexts, rowCount, colCount]);

  const undo = useCallback(async (redo = false) => {
    const from = redo ? redoStack.current : undoStack.current;
    const batch = from.pop();
    if (!batch) return;
    const inverse: CellChange[] = batch.map((ch) => ({ staff: ch.staff, date: ch.date, next: entries.get(entryKey(ch.staff.id, ch.date)) ?? null }));
    const editable = batch.filter((ch) => canEdit(ch.date, ch.staff));
    if (await apply(editable.map((ch) => ({ ...ch, next: ch.next ? { ...ch.next, id: undefined, worked_minutes: undefined } : null })), false)) {
      (redo ? undoStack.current : redoStack.current).push(inverse);
    }
  }, [entries, apply, canEdit]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;
    if (!focus) {
      if (rowCount && colCount && /^Arrow/.test(e.key)) { setAnchor({ r: 0, c: 0 }); setFocus({ r: 0, c: 0 }); e.preventDefault(); }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const move = (dr: number, dc: number, extend: boolean) => {
      const next = { r: Math.min(rowCount - 1, Math.max(0, focus.r + dr)), c: Math.min(colCount - 1, Math.max(0, focus.c + dc)) };
      setFocus(next);
      if (!extend) setAnchor(next);
      e.preventDefault();
      requestAnimationFrame(() => gridRef.current?.querySelector(`[data-cell="${next.r}:${next.c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    };
    const jump = mod ? 1000 : 1;
    switch (e.key) {
      case 'ArrowUp': return move(-jump, 0, e.shiftKey);
      case 'ArrowDown': return move(jump, 0, e.shiftKey);
      case 'ArrowLeft': return move(0, -jump, e.shiftKey);
      case 'ArrowRight': return move(0, jump, e.shiftKey);
      case 'Tab': return move(0, e.shiftKey ? -1 : 1, false);
      case 'Enter': case 'F2': {
        e.preventDefault();
        const { staff: s, date } = at(focus);
        if (!canEdit(date, s)) { toast.info('Past days are read-only'); return; }
        setEditing({ pos: focus, value: textOfEntry(entries.get(entryKey(s.id, date)), s.hotel_id) });
        return;
      }
      case 'Delete': case 'Backspace': e.preventDefault(); clearSelection(); return;
      case 'Escape': setAnchor(focus); return;
    }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); void undo(e.shiftKey); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); void undo(true); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setAnchor({ r: 0, c: 0 }); setFocus({ r: rowCount - 1, c: colCount - 1 }); return; }
    if (mod && e.key.toLowerCase() === 'd' && range) {
      // Fill down (Excel): copy the top row of the selection into the rows below.
      e.preventDefault();
      const targets: Array<{ pos: Pos; value: string }> = [];
      for (let c = range.c1; c <= range.c2; c++) {
        const { staff: s, date } = at({ r: range.r1, c });
        const text = textOfEntry(entries.get(entryKey(s.id, date)), s.hotel_id);
        for (let r = range.r1 + 1; r <= range.r2; r++) targets.push({ pos: { r, c }, value: text });
      }
      void apply(changesFromTexts(targets));
      return;
    }
    if (!mod && !e.altKey && e.key.length === 1) {
      const { staff: s, date } = at(focus);
      if (!canEdit(date, s)) { toast.info('Past days are read-only'); return; }
      e.preventDefault();
      setEditing({ pos: focus, value: e.key });
    }
  };

  const startDrag = (pos: Pos, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    gridRef.current?.focus({ preventScroll: true });
    if (editing && (editing.pos.r !== pos.r || editing.pos.c !== pos.c)) void commitEdit();
    if (e.shiftKey && anchor) setFocus(pos);
    else { setAnchor(pos); setFocus(pos); }
    dragging.current = true;
  };
  useEffect(() => {
    const stop = () => { dragging.current = false; };
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, []);

  const onDouble = (pos: Pos) => {
    const { staff: s, date } = at(pos);
    if (!canEdit(date, s)) { onOpenDetails(s, date); return; }
    setEditing({ pos, value: textOfEntry(entries.get(entryKey(s.id, date)), s.hotel_id) });
  };
  // Stable handlers keep the memoised cells from re-rendering on every selection change.
  const handlers = useRef({ startDrag, onDouble });
  handlers.current = { startDrag, onDouble };
  const cellMouseDown = useCallback((p: Pos, e: React.MouseEvent) => handlers.current.startDrag(p, e), []);
  const cellMouseEnter = useCallback((p: Pos) => { if (dragging.current) setFocus(p); }, []);
  const cellDoubleClick = useCallback((p: Pos) => handlers.current.onDouble(p), []);

  const renderCell = (pos: Pos) => {
    const { staff: s, date } = at(pos);
    const entry = entries.get(entryKey(s.id, date));
    const locked = !canEdit(date, s);
    const isEditing = editing && editing.pos.r === pos.r && editing.pos.c === pos.c;
    return (
      <ScheduleCell
        key={`${pos.r}:${pos.c}`}
        r={pos.r}
        c={pos.c}
        entry={entry}
        baseHotel={s.hotel_id}
        selected={inRange(range, pos.r, pos.c)}
        focused={!!focus && focus.r === pos.r && focus.c === pos.c}
        locked={locked}
        weekend={[0, 6].includes(weekdayOf(date))}
        isToday={date === today}
        onMouseDown={cellMouseDown}
        onMouseEnter={cellMouseEnter}
        onDoubleClick={cellDoubleClick}
        editor={isEditing ? (
          <input
            autoFocus
            list="workforce-codes"
            className="absolute inset-0 z-20 w-full min-w-[120px] border-2 border-primary bg-background px-1 text-xs outline-none"
            value={editing.value}
            onChange={(ev) => setEditing({ pos, value: ev.target.value })}
            onBlur={() => void commitEdit()}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') { ev.preventDefault(); void commitEdit(layout === 'days' ? { r: 1, c: 0 } : { r: 0, c: 1 }); }
              else if (ev.key === 'Tab') { ev.preventDefault(); void commitEdit(layout === 'days' ? { r: 0, c: ev.shiftKey ? -1 : 1 } : { r: ev.shiftKey ? -1 : 1, c: 0 }); }
              else if (ev.key === 'Escape') { ev.preventDefault(); setEditing(null); gridRef.current?.focus(); }
            }}
          />
        ) : null}
      />
    );
  };

  const staffHeader = (s: WorkforceStaff) => (
    <div className="flex flex-col gap-0.5 leading-tight">
      <span className="truncate font-semibold" title={s.full_name}>{s.nickname || s.full_name}</span>
      <span className="truncate text-[10px] font-normal text-muted-foreground" title={`${s.full_name} · ${s.job_role_id ? roleName.get(s.job_role_id) : ''}`}>
        {s.job_role_id ? roleName.get(s.job_role_id) : 'No role'} · {hotelShort(s.hotel_id)}
      </span>
    </div>
  );

  const dayHeader = (date: string) => {
    const wd = weekdayOf(date);
    return (
      <span className={cn('flex items-baseline gap-1 tabular-nums', date === today && 'font-bold text-primary')}>
        {Number(date.slice(8))}<span className="text-[10px] text-muted-foreground">{WEEKDAY_SHORT[wd]}</span>
      </span>
    );
  };

  return (
    <div
      ref={gridRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative max-h-[calc(100vh-260px)] min-h-[320px] select-none overflow-auto rounded-md border bg-background text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      aria-label="Work schedule grid. Arrow keys move, type to edit, Ctrl+C and Ctrl+V copy and paste."
      role="grid"
    >
      <datalist id="workforce-codes">
        {codes.map((c) => <option key={c.code} value={c.code} />)}
        {['SZB', 'fél SZB', 'B', 'X', 'FIX', 'FNSZ', 'éjsz 20:00-08:00', '08-17', '08-20', 'HO', 'PN'].map((v) => <option key={v} value={v} />)}
      </datalist>
      {layout === 'days' ? (
        <table className="border-separate border-spacing-0">
          <thead className="sticky top-0 z-10 bg-background">
            <tr>
              <th className="sticky left-0 z-20 border-b border-r bg-background" />
              {groups.map((g, i) => (
                <th key={`${g.id}-${i}`} colSpan={g.span} className="border-b border-r px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide"
                  style={{ boxShadow: `inset 0 3px 0 ${g.color}` }}>
                  <span className="sticky left-14">{g.name}</span>
                </th>
              ))}
            </tr>
            <tr>
              <th className="sticky left-0 z-20 w-14 min-w-14 border-b border-r bg-background px-2 text-left font-medium text-muted-foreground">Day</th>
              {staff.map((s) => (
                <th key={s.id} className={cn('w-[92px] min-w-[92px] max-w-[92px] border-b border-r px-1.5 py-1 text-left font-normal', !s.is_active && 'opacity-60')}>{staffHeader(s)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((date, r) => (
              <tr key={date}>
                <th className={cn('sticky left-0 z-[5] border-b border-r px-2 text-left font-normal', [0, 6].includes(weekdayOf(date)) ? 'bg-muted' : 'bg-background', date === today && 'bg-primary/10')}>{dayHeader(date)}</th>
                {staff.map((_, c) => renderCell({ r, c }))}
              </tr>
            ))}
            <tr>
              <th className="sticky left-0 z-[5] border-b border-r bg-background px-2 text-left font-medium text-muted-foreground" title="Monthly remarks (Megjegyzés)">Note</th>
              {staff.map((s) => (
                <td key={s.id} className="h-7 max-w-[92px] cursor-pointer truncate border-b border-r px-1 text-[10px] text-muted-foreground hover:bg-muted" title={notes.get(s.id) ?? 'Add a remark for this month'} onClick={() => onEditNote(s)}>
                  {notes.get(s.id) ?? ''}
                </td>
              ))}
            </tr>
            {SUMMARY_ROWS.map((row) => (
              <tr key={row.key} className="bg-muted/40">
                <th className="sticky left-0 z-[5] whitespace-nowrap border-b border-r bg-muted px-2 text-left font-medium" title={row.hint}>{row.label}</th>
                {staff.map((s) => <td key={s.id} className="h-6 border-b border-r px-1.5 text-right tabular-nums">{summaryValue(s, row.key)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="border-separate border-spacing-0">
          <thead className="sticky top-0 z-10 bg-background">
            <tr>
              <th className="sticky left-0 z-20 min-w-[170px] border-b border-r bg-background px-2 text-left font-medium text-muted-foreground">Employee</th>
              {days.map((d) => <th key={d} className={cn('w-[64px] min-w-[64px] border-b border-r px-1 py-1 text-left font-normal', [0, 6].includes(weekdayOf(d)) && 'bg-muted')}>{dayHeader(d)}</th>)}
              {SUMMARY_ROWS.map((row) => <th key={row.key} title={row.hint} className="min-w-[56px] border-b border-r bg-muted px-1 text-right font-medium">{row.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {staff.map((s, r) => {
              const first = r === 0 || staff[r - 1].department_id !== s.department_id;
              const g = first ? departments.find((d) => d.id === s.department_id) : undefined;
              return [
                first ? (
                  <tr key={`g-${s.id}`}>
                    <th colSpan={days.length + SUMMARY_ROWS.length + 1} className="border-b bg-muted/60 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ boxShadow: `inset 3px 0 0 ${g?.color ?? '#94a3b8'}` }}>
                      <span className="sticky left-2">{g?.name ?? 'No department'}</span>
                    </th>
                  </tr>
                ) : null,
                <tr key={s.id}>
                  <th className={cn('sticky left-0 z-[5] border-b border-r bg-background px-2 py-1 text-left font-normal', !s.is_active && 'opacity-60')}>{staffHeader(s)}</th>
                  {days.map((_, c) => renderCell({ r, c }))}
                  {SUMMARY_ROWS.map((row) => <td key={row.key} className="border-b border-r bg-muted/40 px-1.5 text-right tabular-nums">{summaryValue(s, row.key)}</td>)}
                </tr>,
              ];
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface CellProps {
  r: number;
  c: number;
  entry: WorkforceEntry | undefined;
  baseHotel: string | null;
  selected: boolean;
  focused: boolean;
  locked: boolean;
  weekend: boolean;
  isToday: boolean;
  editor: React.ReactNode;
  onMouseDown: (pos: Pos, e: React.MouseEvent) => void;
  onMouseEnter: (pos: Pos) => void;
  onDoubleClick: (pos: Pos) => void;
}

const ScheduleCell = memo(function ScheduleCell({ r, c, entry, baseHotel, selected, focused, locked, weekend, isToday, editor, onMouseDown, onMouseEnter, onDoubleClick }: CellProps) {
  const pos = { r, c };
  const style = entry ? cellStyle(entry, baseHotel) : null;
  const label = entry ? cellLabel(entry) : '';
  const title = entry
    ? [label || 'Fixed day off', entry.worked_minutes ? `${formatHours(entry.worked_minutes)} h` : '', entry.note && entry.note !== label ? entry.note : '',
      entry.status === 'draft' ? 'Draft – not visible to the employee yet' : '', locked ? 'Read-only (history)' : ''].filter(Boolean).join('\n')
    : locked ? 'Read-only (history)' : '';
  return (
    <td
      data-cell={`${r}:${c}`}
      role="gridcell"
      aria-selected={selected}
      title={title}
      onMouseDown={(e) => onMouseDown(pos, e)}
      onMouseEnter={() => onMouseEnter(pos)}
      onDoubleClick={() => onDoubleClick(pos)}
      className={cn(
        'relative h-7 max-w-[92px] cursor-cell truncate border-b border-r px-1 leading-7',
        !style && weekend && 'bg-muted/50',
        !style && isToday && 'bg-primary/5',
        locked && !style && 'bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,hsl(var(--muted))_4px,hsl(var(--muted))_5px)]',
        selected && 'after:pointer-events-none after:absolute after:inset-0 after:bg-primary/20',
        focused && 'outline outline-2 -outline-offset-2 outline-primary',
      )}
      style={style ? { backgroundColor: style.bg, color: style.fg } : undefined}
    >
      {label}
      {entry?.status === 'draft' && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500 ring-1 ring-background" aria-label="draft" />}
      {locked && focused && <Lock className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 opacity-60" />}
      {editor}
    </td>
  );
});
