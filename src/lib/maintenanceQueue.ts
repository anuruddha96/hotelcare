export type MaintenanceQueueRow = {
  status: 'open' | 'in_progress' | 'completed';
  on_hold?: boolean | null;
  pending_supervisor_approval?: boolean | null;
};

export type MaintenanceQueueBucket = 'active' | 'progress' | 'hold' | 'approval' | 'done';

/** One exclusive classification for the two views; approval outranks hold and
 * completion outranks everything. An open issue is not also "In progress". */
export function maintenanceQueueBucket(ticket: MaintenanceQueueRow): MaintenanceQueueBucket {
  if (ticket.status === 'completed') return 'done';
  if (ticket.pending_supervisor_approval) return 'approval';
  if (ticket.on_hold) return 'hold';
  return ticket.status === 'in_progress' ? 'progress' : 'active';
}

export function maintenanceQueueCounts(tickets: readonly MaintenanceQueueRow[]) {
  const counts = { total: tickets.length, active: 0, progress: 0, hold: 0, approval: 0, done: 0 };
  for (const ticket of tickets) counts[maintenanceQueueBucket(ticket)]++;
  return counts;
}

/** Preserve the location of historical common-area tickets without displaying
 * "Room N/A". Never use the location as an invented room identifier. */
export function maintenanceLocation(roomNumber: string | null | undefined, description: string, language = 'en') {
  if (roomNumber && roomNumber.trim().toUpperCase() !== 'N/A') {
    return `${language === 'hu' ? 'Szoba' : 'Room'} ${roomNumber}`;
  }
  const location = description.match(/^Location:\s*([^\r\n]+)/i)?.[1]?.trim();
  return location ? `${language === 'hu' ? 'Helyszín' : 'Location'}: ${location}` : (language === 'hu' ? 'Közös terület' : 'Common area');
}
