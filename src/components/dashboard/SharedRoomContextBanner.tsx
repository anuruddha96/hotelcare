import React, { useEffect, useMemo, useState } from 'react';
import { Users, PlayCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface SharedAssignmentContext {
  assigned_to?: string | null;
  shared_with?: string | null;
  started_by?: string | null;
  completed_by?: string | null;
  status?: string | null;
}

interface Props {
  assignment: SharedAssignmentContext;
  currentUserId?: string | null;
}

export function SharedRoomContextBanner({ assignment, currentUserId }: Props) {
  const [names, setNames] = useState<Record<string, string>>({});

  const ids = useMemo(() => Array.from(new Set([
    assignment.assigned_to,
    assignment.shared_with,
    assignment.started_by,
    assignment.completed_by,
  ].filter(Boolean) as string[])), [
    assignment.assigned_to,
    assignment.shared_with,
    assignment.started_by,
    assignment.completed_by,
  ]);

  useEffect(() => {
    if (ids.length === 0) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await (supabase as any).rpc('get_housekeeping_actor_labels', {
        p_user_ids: ids,
      });
      if (cancelled || error || !data) return;
      const next: Record<string, string> = {};
      for (const row of data as Array<{ user_id: string; display_name: string }>) {
        next[row.user_id] = row.display_name;
      }
      setNames(next);
    })();

    return () => { cancelled = true; };
  }, [ids.join('|')]);

  if (!assignment.shared_with) return null;

  const partnerId = currentUserId === assignment.assigned_to
    ? assignment.shared_with
    : assignment.assigned_to;
  const partnerName = partnerId ? (names[partnerId] || 'your teammate') : 'your teammate';
  const starterName = assignment.started_by ? (names[assignment.started_by] || 'a teammate') : null;
  const completedName = assignment.completed_by ? (names[assignment.completed_by] || 'a teammate') : null;
  const completedByPartner = assignment.status === 'completed'
    && !!assignment.completed_by
    && assignment.completed_by !== currentUserId;

  return (
    <div className="mb-2 rounded-lg border border-sky-200 bg-sky-50/90 px-3 py-2 text-xs text-sky-950 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-100">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <Users className="h-3.5 w-3.5" />
          Shared cleaning · with {partnerName}
        </span>
        {assignment.status === 'in_progress' && starterName && (
          <span className="inline-flex items-center gap-1 text-sky-800 dark:text-sky-200">
            <PlayCircle className="h-3.5 w-3.5" />
            Started by {starterName}
          </span>
        )}
        {assignment.status === 'completed' && completedName && (
          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Final steps confirmed by {completedName}
          </span>
        )}
      </div>
      {completedByPartner && (
        <div className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {completedName} already confirmed the final room steps. Shared linen and minibar data should not be submitted again unless a manager reopens the room.
        </div>
      )}
    </div>
  );
}
