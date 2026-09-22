import { readFileSync, writeFileSync } from 'node:fs';
const file = 'src/components/dashboard/AutoRoomAssignmentImpl.tsx';
let source = readFileSync(file, 'utf8');
const anchor = `    hotelConfig.staffPreferences = historicalPreferences;
    const result = generateSmartHousekeepingPlan({`;
const replacement = `    // A room can enter progress after the board opened. Always reload its
    // live ownership before suggesting any rearrangement; manager unlocks must
    // never override an active in-progress or DND retry assignment.
    const inProgressRoomIds = new Set<string>();
    if (!isNextDayPlanning && roomsToAssign.length) {
      const { data: currentWork, error: currentWorkError } = await supabase
        .from('room_assignments')
        .select('room_id,assigned_to,status')
        .eq('assignment_date', selectedDate)
        .in('room_id', roomsToAssign.map(room => room.id));
      if (currentWorkError) {
        toast.error('Cannot verify current room ownership. Refresh before regenerating.');
        return;
      }
      const previewOwners = new Map(assignmentPreviews.flatMap(person =>
        person.rooms.map(room => [room.id, person.staffId] as const)));
      for (const row of currentWork || []) {
        if (row.status !== 'in_progress' && row.status !== 'dnd_pending_retry') continue;
        if (previewOwners.get(row.room_id) !== row.assigned_to) {
          toast.error('An in-progress room changed since the preview. Refresh before regenerating.');
          return;
        }
        inProgressRoomIds.add(row.room_id);
      }
    }
    const enforcedLocks = new Set([...lockedRoomIds, ...inProgressRoomIds]);
    hotelConfig.staffPreferences = historicalPreferences;
    const result = generateSmartHousekeepingPlan({`;
if (!source.includes(anchor) || source.split(anchor).length !== 2) throw new Error('Expected unique regeneration anchor not found.');
source = source.replace(anchor, replacement);
const lockAnchor = `      previous: assignmentPreviews.length ? assignmentPreviews : undefined,
      lockedRoomIds,
      shiftMinutes,`;
if (!source.includes(lockAnchor) || source.split(lockAnchor).length !== 2) throw new Error('Expected single planning lock parameter not found.');
source = source.replace(lockAnchor, `      previous: assignmentPreviews.length ? assignmentPreviews : undefined,
      lockedRoomIds: enforcedLocks,
      shiftMinutes,`);
writeFileSync(file, source);
console.log('In-progress live assignments now remain hard locked during regeneration.');
