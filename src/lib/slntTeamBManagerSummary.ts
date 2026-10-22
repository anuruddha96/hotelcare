import { isSlntRtcReady } from './slntTeamBQueue';
export type SlntManagerRoom = {
  room_id: string;
  assignment_id: string | null;
  assignment_status: string | null;
  supervisor_approved: boolean;
  is_checkout_room: boolean;
  is_optional: boolean;
  assigned_to: string | null;
  pms_metadata: Record<string, unknown> | null;
};
export type SlntManagerFilter = 'pending' | 'working' | 'done' | 'awaiting' | 'approved' | 'ready' | 'waiting' | 'due' | 'optional';
export function groupSlntManagerRooms<T extends SlntManagerRoom>(rooms: T[], today: string): Record<SlntManagerFilter, T[]> {
  const result: Record<SlntManagerFilter, T[]> = {
    pending: [], working: [], done: [], awaiting: [], approved: [], ready: [], waiting: [], due: [], optional: [],
  };
  for (const room of rooms) {
    const status = room.assignment_status;
    // The shared room pool has at most one live assignment per room.
    if (!room.assignment_id || !status || status === 'assigned') result.pending.push(room);
    if (status === 'in_progress') result.working.push(room);
    if (status === 'completed') {
      result.done.push(room);
      (room.supervisor_approved ? result.approved : result.awaiting).push(room);
    }
    if (room.is_checkout_room) {
      (isSlntRtcReady(room, today) ? result.ready : result.waiting).push(room);
    } else if (room.is_optional) result.optional.push(room);
    else result.due.push(room);
  }
  return result;
}
