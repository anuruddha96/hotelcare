// Training v2 — guard / precondition evaluators
import { supabase } from '@/integrations/supabase/client';
import type { GuardKey, RoleKey } from './types';

export interface GuardContext {
  userId: string;
  role: RoleKey | string;
}

export async function evaluateGuard(key: GuardKey, ctx: GuardContext): Promise<boolean> {
  switch (key) {
    case 'always':
    case 'never_block':
      return true;
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
    case 'has_active_assignment': {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from('room_assignments')
        .select('id, status')
        .eq('assigned_to', ctx.userId)
        .eq('assignment_date', today)
        .in('status', ['assigned', 'in_progress'])
        .limit(1);
      return !!(data && data.length);
    }
    case 'has_in_progress_cleaning': {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from('room_assignments')
        .select('id')
        .eq('assigned_to', ctx.userId)
        .eq('assignment_date', today)
        .eq('status', 'in_progress')
        .limit(1);
      return !!(data && data.length);
    }
    default:
      return true;
  }
}
