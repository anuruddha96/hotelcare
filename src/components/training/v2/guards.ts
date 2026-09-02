// Training v2 — guard / precondition evaluators
import { supabase } from '@/integrations/supabase/client';
import { todayBudapest } from '@/lib/budapestTime';
import type { GuardKey, RoleKey } from './types';

export interface GuardContext {
  userId: string;
  role: RoleKey | string;
  assignedHotel?: string | null;
  switchingHotel?: boolean;
  dataReady?: Set<string>;
}

async function hasUnfinishedHousekeepingWork(userId: string): Promise<boolean> {
  const today = todayBudapest();

  const [roomsResult, publicTasksResult] = await Promise.all([
    supabase
      .from('room_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', userId)
      .eq('assignment_date', today)
      .in('status', ['assigned', 'in_progress', 'dnd_pending_retry']),
    supabase
      .from('general_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', userId)
      .eq('assigned_date', today)
      .in('status', ['assigned', 'in_progress']),
  ]);

  // Safety first: if Hotel Care cannot verify the work queue, do not teach the
  // employee to end the shift. The guard will be polled again automatically.
  if (roomsResult.error || publicTasksResult.error) {
    console.warn('[training] could not verify unfinished housekeeping work', {
      roomsError: roomsResult.error,
      publicTasksError: publicTasksResult.error,
    });
    return true;
  }

  return (roomsResult.count ?? 0) > 0 || (publicTasksResult.count ?? 0) > 0;
}

export async function evaluateGuard(key: GuardKey, ctx: GuardContext): Promise<boolean> {
  if (key.startsWith('data_loaded:')) {
    const dataKey = key.slice('data_loaded:'.length);
    return !!ctx.dataReady?.has(dataKey);
  }
  switch (key) {
    case 'always':
    case 'never_block':
      return true;
    case 'is_online':
      return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    case 'not_switching_hotel':
      return !ctx.switchingHotel;
    case 'hotel_selected':
      return !!ctx.assignedHotel;
    case 'is_manager':
      return [
        'manager',
        'housekeeping_manager',
        'maintenance_manager',
        'reception_manager',
        'admin',
        'top_management',
        'top_management_manager',
      ].includes(ctx.role as string);
    case 'is_signed_in': {
      const { data } = await supabase
        .from('staff_attendance')
        .select('id')
        .eq('user_id', ctx.userId)
        .is('check_out_time', null)
        .limit(1);
      return !!(data && data.length);
    }
    case 'has_any_assignment_today': {
      const today = todayBudapest();
      const { data } = await supabase
        .from('room_assignments')
        .select('id')
        .eq('assigned_to', ctx.userId)
        .eq('assignment_date', today)
        .limit(1);
      return !!(data && data.length);
    }
    case 'has_active_assignment': {
      const today = todayBudapest();
      const { data } = await supabase
        .from('room_assignments')
        .select('id, status')
        .eq('assigned_to', ctx.userId)
        .eq('assignment_date', today)
        .in('status', ['assigned', 'in_progress', 'dnd_pending_retry'])
        .limit(1);
      return !!(data && data.length);
    }
    case 'has_in_progress_cleaning': {
      const today = todayBudapest();
      const { data } = await supabase
        .from('room_assignments')
        .select('id')
        .eq('assigned_to', ctx.userId)
        .eq('assignment_date', today)
        .eq('status', 'in_progress')
        .limit(1);
      return !!(data && data.length);
    }
    case 'has_no_unfinished_housekeeping_work':
      return !(await hasUnfinishedHousekeepingWork(ctx.userId));
    default:
      return true;
  }
}