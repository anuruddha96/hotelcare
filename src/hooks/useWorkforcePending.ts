import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/hooks/useWorkforce';
import { summarizePending, type PendingWork } from '@/lib/workforce/pending';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type DraftRow = { staff_id: string; work_date: string; updated_by: string | null; published_version: unknown };

export interface UnpublishedWork extends PendingWork {
  /** Names of the other planners, by profile id. */
  names: Map<string, string>;
  /** "staffId|YYYY-MM" for the employees who already received that month (months with work waiting only). */
  received: Set<string>;
}

const EMPTY: UnpublishedWork = { mine: [], others: [], names: new Map(), received: new Set() };

/**
 * What still waits for Publish from today on: the signed-in planner's own
 * work and, separately, other planners' work. Row-level security limits it to
 * what this person may see. A failed refresh keeps the last good answer, so
 * the reminder does not disappear on a network hiccup.
 */
export function useUnpublishedWork(me: string | null, today: string, refreshKey: number): UnpublishedWork {
  const [work, setWork] = useState<UnpublishedWork>(EMPTY);
  const names = useRef(new Map<string, string>());

  useEffect(() => {
    if (!me) return;
    let alive = true;
    void (async () => {
      try {
        const rows = await fetchAllRows<DraftRow>((a, b) => db.from('workforce_entries')
          .select('staff_id,work_date,updated_by,published_version')
          .eq('status', 'draft').gte('work_date', today).order('work_date').order('staff_id').range(a, b));
        const months = [...new Set(rows.map((r) => r.work_date.slice(0, 7)))];
        // Who already received a month (pressed Publish before). A day that
        // was published before tells the same, so that is the fallback.
        const received = new Set(rows.filter((r) => r.published_version != null).map((r) => `${r.staff_id}|${r.work_date.slice(0, 7)}`));
        if (months.length) {
          try {
            const marked = await fetchAllRows<{ staff_id: string; month: string }>((a, b) => db.from('workforce_published_months')
              .select('staff_id,month').in('month', months.map((m) => `${m}-01`)).order('month').order('staff_id').range(a, b));
            for (const r of marked) received.add(`${r.staff_id}|${String(r.month).slice(0, 7)}`);
          } catch { /* older database: the fallback above is enough */ }
        }
        const summary = summarizePending(rows, me, today, (staffId, month) => received.has(`${staffId}|${month}`));

        const unknown = [...new Set(summary.others.map((o) => o.plannerId).filter((id): id is string => !!id && !names.current.has(id)))];
        if (unknown.length) {
          const { data } = await db.from('profiles').select('id,full_name,nickname').in('id', unknown);
          for (const p of (data ?? []) as Array<{ id: string; full_name: string | null; nickname: string | null }>) {
            names.current.set(p.id, p.nickname || p.full_name || '');
          }
        }
        if (alive) setWork({ ...summary, names: new Map(names.current), received });
      } catch { /* keep the last good answer */ }
    })();
    return () => { alive = false; };
  }, [me, today, refreshKey]);

  return work;
}
