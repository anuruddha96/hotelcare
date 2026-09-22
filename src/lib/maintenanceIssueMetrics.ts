/** Operational reporting is based on the canonical maintenance tickets table. */
export type MaintenanceMetricRow = {
  id: string;
  status: string;
  pending_supervisor_approval: boolean | null;
  supervisor_approved: boolean | null;
  on_hold: boolean | null;
  room_number: string | null;
  created_at: string;
  closed_at: string | null;
  sla_due_date: string | null;
  attachment_urls: string[] | null;
  completion_photos: string[] | null;
};

export function summarizeMaintenanceIssues(rows: MaintenanceMetricRow[], now = Date.now()) {
  const completed = rows.filter(t => t.status === 'completed');
  const awaitingApproval = rows.filter(t => t.pending_supervisor_approval === true);
  const approved = completed.filter(t => t.supervisor_approved === true && !t.pending_supervisor_approval);
  const elapsed = completed
    .filter(t => t.closed_at && Number.isFinite(Date.parse(t.closed_at)) && Number.isFinite(Date.parse(t.created_at)))
    .map(t => (Date.parse(t.closed_at!) - Date.parse(t.created_at)) / 3600000)
    .filter(h => h >= 0);
  const roomCounts = new Map<string, number>();
  rows.forEach(t => {
    const room = (t.room_number || '').trim();
    if (room && room.toUpperCase() !== 'N/A' && room.toLowerCase() !== 'general') {
      roomCounts.set(room, (roomCounts.get(room) || 0) + 1);
    }
  });
  return {
    total: rows.length,
    open: rows.filter(t => t.status === 'open' && !t.on_hold && !t.pending_supervisor_approval).length,
    inProgress: rows.filter(t => t.status === 'in_progress' && !t.on_hold && !t.pending_supervisor_approval).length,
    onHold: rows.filter(t => t.on_hold && t.status !== 'completed').length,
    awaitingApproval: awaitingApproval.length,
    completed: completed.length,
    approved: approved.length,
    overdue: rows.filter(t => t.status !== 'completed' && !!t.sla_due_date && Date.parse(t.sla_due_date) < now).length,
    averageHours: elapsed.length ? elapsed.reduce((sum, h) => sum + h, 0) / elapsed.length : null,
    missingEvidence: rows.filter(t => !t.attachment_urls?.length && !t.completion_photos?.length).length,
    repeatedRooms: [...roomCounts.entries()].filter(([, n]) => n > 1).sort((a,b) => b[1]-a[1]),
  };
}
