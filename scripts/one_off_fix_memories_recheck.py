"""One-time, anchored patch for Memories' stale supervisor-recheck board state.

This script runs only on the dedicated repair branch, refuses unexpected code
shapes, and is removed by its one-time workflow before the final fix commit.
"""
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    matches = text.count(old)
    if matches != 1:
        raise RuntimeError(f"{label}: expected exactly one anchor, found {matches}")
    return text.replace(old, new, 1)


path = Path('src/components/dashboard/HotelRoomOverviewLive.tsx')
source = path.read_text()
source = replace_once(
    source,
    "import { todayBudapest } from '@/lib/budapestTime';",
    "import { todayBudapest } from '@/lib/budapestTime';\n"
    "import { isHotelMemoriesBudapest } from '@/lib/hotel-memories-housekeeping';\n"
    "import { isCurrentNoServiceOutcome, selectCurrentHousekeepingAssignments } from '@/lib/currentHousekeepingAssignments';",
    'overview imports',
)
source = replace_once(
    source,
    "  pms_hold?: boolean | null;\n  notes: string | null;\n}\n\ninterface PublicAreaTask",
    "  pms_hold?: boolean | null;\n  notes: string | null;\n  created_at?: string | null;\n"
    "  service_result?: string | null;\n}\n\ninterface PublicAreaTask",
    'overview assignment data shape',
)
source = replace_once(
    source,
    ".select('id, room_id, assigned_to, status, assignment_type, started_at, supervisor_approved, ready_to_clean, pms_hold, notes')",
    ".select('id, room_id, assigned_to, status, assignment_type, started_at, supervisor_approved, ready_to_clean, pms_hold, notes, created_at, service_result')",
    'overview live assignment query',
)
source = replace_once(
    source,
    "  const assignmentMap = new Map<string, AssignmentData>();\n  assignments.forEach(a => assignmentMap.set(a.room_id, a));",
    "  // A Memories supervisor recheck retains the earlier submission for audit\n"
    "  // and inserts a new assignment. PostgREST does not promise row order: an\n"
    "  // old completed [NO_SERVICE] row must never replace active cleaning.\n"
    "  // Preserve the other hotels' existing assignment behavior unchanged.\n"
    "  const memoriesOverview = isHotelMemoriesBudapest(hotelName);\n"
    "  const assignmentMap: Map<string, AssignmentData> = memoriesOverview\n"
    "    ? selectCurrentHousekeepingAssignments(assignments)\n"
    "    : new Map<string, AssignmentData>();\n"
    "  if (!memoriesOverview) assignments.forEach(a => assignmentMap.set(a.room_id, a));",
    'overview selected assignment',
)
source = replace_once(
    source,
    "    const assignmentStatus = assignment?.status || null;\n    const roomFlags = parseRoomFlags(room.notes);",
    "    const assignmentStatus = assignment?.status || null;\n"
    "    const noServiceOutcome = memoriesOverview\n"
    "      ? isCurrentNoServiceOutcome(assignment)\n"
    "      : !!assignment?.notes?.includes('[NO_SERVICE]');\n"
    "    const roomFlags = parseRoomFlags(room.notes);",
    'overview no service status binding',
)
source = replace_once(
    source,
    "{assignment?.notes?.includes('[NO_SERVICE]') && <span className=\"ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-gray-500 text-white\">NS</span>}",
    "{noServiceOutcome && <span className=\"ml-0.5 px-0.5 rounded text-[9px] font-extrabold bg-gray-500 text-white\">NS</span>}",
    'overview live NS badge',
)
source = replace_once(
    source,
    "{assignment?.status === 'completed' && assignment?.supervisor_approved && !assignment?.notes?.includes('[NO_SERVICE]') && <span className=\"ml-0.5 text-[9px]\">✅</span>}",
    "{assignment?.status === 'completed' && assignment?.supervisor_approved && !noServiceOutcome && <span className=\"ml-0.5 text-[9px]\">✅</span>}",
    'overview green completion badge',
)
path.write_text(source)

path = Path('src/components/dashboard/HousekeepingManagerView.tsx')
source = path.read_text()
source = replace_once(
    source,
    "import { resolveHotelKeys } from '@/lib/hotelKeys';",
    "import { resolveHotelKeys } from '@/lib/hotelKeys';\n"
    "import { isHotelMemoriesBudapest } from '@/lib/hotel-memories-housekeeping';\n"
    "import { selectCurrentHousekeepingAssignments } from '@/lib/currentHousekeepingAssignments';",
    'team view imports',
)
source = replace_once(
    source,
    ".select('assigned_to, status, room_id')",
    ".select('id, assigned_to, status, room_id, created_at')",
    'team summary assignment query',
)
source = replace_once(
    source,
    "      const summaryMap = new Map<string, TeamAssignment>();",
    "      // Count only the latest room assignment for Hotel Memories. A supervisor\n"
    "      // recheck creates a fresh row and preserves the earlier completed one\n"
    "      // for approval history; it must not inflate Done/Working/room counts.\n"
    "      const memoriesCurrent = selectCurrentHousekeepingAssignments(\n"
    "        filteredData.filter(row => isHotelMemoriesBudapest(roomMap.get(row.room_id)?.hotel)),\n"
    "      );\n"
    "      const currentData = filteredData.filter(row =>\n"
    "        !isHotelMemoriesBudapest(roomMap.get(row.room_id)?.hotel)\n"
    "        || memoriesCurrent.get(row.room_id)?.id === row.id,\n"
    "      );\n\n"
    "      const summaryMap = new Map<string, TeamAssignment>();",
    'team current assignment filter',
)
source = replace_once(
    source,
    "      filteredData.forEach((row: any) => {\n        const staffId = row.assigned_to as string;",
    "      currentData.forEach((row: any) => {\n        const staffId = row.assigned_to as string;",
    'team summary counting',
)
source = replace_once(
    source,
    "          status,\n          rooms!inner(room_number, hotel, venue_id)",
    "          status,\n          created_at,\n          rooms!inner(room_number, hotel, venue_id)",
    'team room-assignment query',
)
source = replace_once(
    source,
    "      const assignments = filteredData.map((item: any) => ({",
    "      const currentMemories = selectCurrentHousekeepingAssignments(\n"
    "        filteredData.filter((item: any) => isHotelMemoriesBudapest(item.rooms?.hotel)),\n"
    "      );\n"
    "      const assignments = filteredData.filter((item: any) =>\n"
    "        !isHotelMemoriesBudapest(item.rooms?.hotel)\n"
    "        || currentMemories.get(item.room_id)?.id === item.id,\n"
    "      ).map((item: any) => ({",
    'team live room assignments',
)
path.write_text(source)

path = Path('src/components/dashboard/HotelMemoriesManagerStatusDialog.tsx')
source = path.read_text()
source = replace_once(
    source,
    "import { todayBudapest } from '@/lib/budapestTime';",
    "import { todayBudapest } from '@/lib/budapestTime';\n"
    "import { selectCurrentHousekeepingAssignments } from '@/lib/currentHousekeepingAssignments';",
    'Memories drilldown import',
)
source = replace_once(
    source,
    "        .eq('assigned_to', staffId)\n        .eq('assignment_date', selectedDate)\n        .eq('status', status);",
    "        .eq('assigned_to', staffId)\n        .eq('assignment_date', selectedDate);",
    'Memories drilldown query all attempts',
)
source = replace_once(
    source,
    "      const rows = (data || [])\n        .map((row: any) => ({ ...row, rooms: row.rooms || null }))\n        .filter((row: AssignmentRow) => isHotelMemoriesBudapest(row.rooms?.hotel)) as AssignmentRow[];\n      setAssignments(rows);",
    "      const hotelRows = (data || [])\n"
    "        .map((row: any) => ({ ...row, rooms: row.rooms || null }))\n"
    "        .filter((row: AssignmentRow) => isHotelMemoriesBudapest(row.rooms?.hotel)) as AssignmentRow[];\n"
    "      const currentByRoom = selectCurrentHousekeepingAssignments(hotelRows);\n"
    "      const rows = hotelRows.filter(row => currentByRoom.get(row.room_id)?.id === row.id && row.status === status);\n"
    "      setAssignments(rows);",
    'Memories drilldown selected attempt',
)
path.write_text(source)

print('Patched Hotel Memories room chips, team counts, and status drilldowns; other hotels remain on existing behavior.')
