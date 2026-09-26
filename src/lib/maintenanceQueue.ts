export type MaintenanceQueueRow = {
  status: 'open' | 'in_progress' | 'completed';
  on_hold?: boolean | null;
  pending_supervisor_approval?: boolean | null;
  sla_due_date?: string | null;
  priority?: 'low' | 'medium' | 'high' | 'urgent' | null;
  created_at?: string | null;
};

export type MaintenanceQueueBucket = 'active' | 'progress' | 'hold' | 'approval' | 'done';
export type MaintenanceQueueFilter = 'work' | 'overdue' | 'due_soon' | MaintenanceQueueBucket | 'all';

/** One exclusive classification for the two views; approval outranks hold and
 * completion outranks everything. An open issue is not also "In progress". */
export function maintenanceQueueBucket(ticket: MaintenanceQueueRow): MaintenanceQueueBucket {
  if (ticket.status === 'completed') return 'done';
  if (ticket.pending_supervisor_approval) return 'approval';
  if (ticket.on_hold) return 'hold';
  return ticket.status === 'in_progress' ? 'progress' : 'active';
}

export function isMaintenanceOverdue(ticket: MaintenanceQueueRow, now = Date.now()): boolean {
  if (ticket.status === 'completed' || !ticket.sla_due_date) return false;
  const due = Date.parse(ticket.sla_due_date);
  return Number.isFinite(due) && due < now;
}

export function isMaintenanceDueSoon(ticket: MaintenanceQueueRow, now = Date.now(), withinHours = 6): boolean {
  if (ticket.status === 'completed' || !ticket.sla_due_date || withinHours <= 0) return false;
  const due = Date.parse(ticket.sla_due_date);
  return Number.isFinite(due) && due >= now && due <= now + withinHours * 3_600_000;
}

export function maintenanceMatchesFilter(
  ticket: MaintenanceQueueRow,
  filter: string,
  now = Date.now(),
): boolean {
  switch (filter as MaintenanceQueueFilter) {
    case 'all': return true;
    case 'work': return ticket.status !== 'completed';
    case 'overdue': return isMaintenanceOverdue(ticket, now);
    case 'due_soon': return isMaintenanceDueSoon(ticket, now);
    case 'active':
    case 'progress':
    case 'hold':
    case 'approval':
    case 'done':
      return maintenanceQueueBucket(ticket) === filter;
    default:
      return ticket.status !== 'completed';
  }
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/** Operational order: breached work first, then work approaching SLA, approval,
 * active work, new work, blocked work, and completed history last. */
export function maintenanceOperationalRank(ticket: MaintenanceQueueRow, now = Date.now()): number {
  if (ticket.status === 'completed') return 6;
  if (isMaintenanceOverdue(ticket, now)) return 0;
  if (isMaintenanceDueSoon(ticket, now)) return 1;
  if (ticket.pending_supervisor_approval) return 2;
  if (ticket.status === 'in_progress' && !ticket.on_hold) return 3;
  if (ticket.status === 'open' && !ticket.on_hold) return 4;
  return 5;
}

export function sortMaintenanceTickets<T extends MaintenanceQueueRow>(rows: readonly T[], now = Date.now()): T[] {
  return [...rows].sort((a, b) => {
    const rank = maintenanceOperationalRank(a, now) - maintenanceOperationalRank(b, now);
    if (rank) return rank;

    const aDue = a.sla_due_date ? Date.parse(a.sla_due_date) : Number.POSITIVE_INFINITY;
    const bDue = b.sla_due_date ? Date.parse(b.sla_due_date) : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;

    const priority = (PRIORITY_ORDER[a.priority || ''] ?? 4) - (PRIORITY_ORDER[b.priority || ''] ?? 4);
    if (priority) return priority;

    const aCreated = a.created_at ? Date.parse(a.created_at) : Number.POSITIVE_INFINITY;
    const bCreated = b.created_at ? Date.parse(b.created_at) : Number.POSITIVE_INFINITY;
    return aCreated - bCreated;
  });
}

export function maintenanceQueueCounts(tickets: readonly MaintenanceQueueRow[], now = Date.now()) {
  const counts = {
    total: tickets.length,
    work: 0,
    overdue: 0,
    dueSoon: 0,
    active: 0,
    progress: 0,
    hold: 0,
    approval: 0,
    done: 0,
  };
  for (const ticket of tickets) {
    counts[maintenanceQueueBucket(ticket)]++;
    if (ticket.status !== 'completed') counts.work++;
    if (isMaintenanceOverdue(ticket, now)) counts.overdue++;
    if (isMaintenanceDueSoon(ticket, now)) counts.dueSoon++;
  }
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
