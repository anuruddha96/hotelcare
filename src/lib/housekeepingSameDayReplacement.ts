import { isGozsduCourtHotel } from './gozsdu-housekeeping';

const EDITOR_ROLES = new Set([
  'manager', 'housekeeping_manager', 'supervisor', 'reception_manager',
  'admin', 'top_management', 'top_management_manager',
]);

/** This controls visibility only. The database RPC independently checks permission. */
export function canOpenGozsduSameDayReplacement(args: {
  status: string | null | undefined;
  planDate: string | null | undefined;
  today: string;
  assignedHotel: string | null | undefined;
  role: string | null | undefined;
}) {
  return args.status === 'released'
    && args.planDate === args.today
    && isGozsduCourtHotel(args.assignedHotel)
    && EDITOR_ROLES.has(args.role || '');
}

export function hasUnstartedReplacementWork(
  rooms: ReadonlyArray<{ liveStatus?: string | null }>,
  areas: ReadonlyArray<{ liveStatus?: string | null }>,
) {
  return rooms.some(room => room.liveStatus === 'assigned')
    || areas.some(area => area.liveStatus === 'assigned');
}
