#!/usr/bin/env python3
"""One-shot, exact-anchor source patch. Executed in GitHub Actions only.

Changes one Gozsdu-only component; preserves room IDs, persisted room numbers,
PMS reconciliation, room counts, assignment writes and all other hotel paths.
"""
from pathlib import Path

path = Path('src/components/dashboard/GozsduCourtRoomOverview.tsx')
source = path.read_text()

def replace_once(old: str, new: str, description: str) -> None:
    global source
    n = source.count(old)
    if n != 1:
        raise SystemExit(f'Unsafe {description}: expected exactly one anchor, found {n}')
    source = source.replace(old, new, 1)

replace_once(
    "import { reconcileGozsduPmsRoster, type GozsduPmsRow } from '@/lib/gozsduPmsRoster';\n",
    "import { reconcileGozsduPmsRoster, type GozsduPmsRow } from '@/lib/gozsduPmsRoster';\n"
    "import { canonicalGozsduOverviewName, groupGozsduOverviewByBuilding } from '@/lib/gozsduRoomOverviewDisplay';\n",
    'Gozsdu-only display helper import',
)
replace_once(
    "function roomFloor(room: Room): number {\n"
    "  if (room.floor_number != null) return room.floor_number;\n"
    "  const firstDigits = room.room_number.match(/^\\d+/)?.[0];\n"
    "  return firstDigits ? Math.floor(Number(firstDigits) / 100) : 0;\n"
    "}\n",
    '',
    'remove incorrect numeric floor inference',
)
replace_once(
    "  const registryByRoom = useMemo(() => new Map(registry.map(row => [row.room_id, row])), [registry]);\n",
    "  const registryByRoom = useMemo(() => new Map(registry.map(row => [row.room_id, row])), [registry]);\n"
    "  const displayName = useCallback((room: Room) => canonicalGozsduOverviewName(room, registryByRoom), [registryByRoom]);\n",
    'canonical registry label lookup',
)
replace_once(
    'toast.success(`Room ${room.room_number} → ${cleanName(payload.staffName)}`);',
    'toast.success(`Room ${displayName(room)} → ${cleanName(payload.staffName)}`);',
    'successful assignment label',
)
replace_once(
    'toast.warning(`Room ${room.room_number} is already being cleaned; its housekeeper cannot be changed.`);',
    'toast.warning(`Room ${displayName(room)} is already being cleaned; its housekeeper cannot be changed.`);',
    'already-cleaning label',
)
replace_once(
    "                {room.room_number}\n                {room.pms_metadata?.manual_checkout",
    "                {displayName(room)}\n                {room.pms_metadata?.manual_checkout",
    'visible hotel room chip',
)
replace_once(
    '<p className="font-semibold">Room {room.room_number} · {status.replaceAll(\'_\', \' \')}</p>',
    '<p className="font-semibold">Room {displayName(room)} · {status.replaceAll(\'_\', \' \')}</p>',
    'room tooltip title',
)
replace_once(
    "            <p>PMS: {registryByRoom.get(room.id)?.pms_room_name || room.room_number}</p>",
    "            <p>PMS: {displayName(room)}</p>",
    'PMS tooltip label',
)
start_anchor = '  const renderSection = (title: string, list: Room[], bucket: Bucket, icon: React.ReactNode, hint: string) => {\n'
end_anchor = '\n  const refresh = async () => {'
if source.count(start_anchor) != 1 or source.count(end_anchor) != 1:
    raise SystemExit('Unsafe section render anchors: expected one of each')
start = source.index(start_anchor)
end = source.index(end_anchor, start)
replacement = '''  const renderSection = (title: string, list: Room[], bucket: Bucket, icon: React.ReactNode, hint: string) => {
    // Manager section assignments are the physical location source. A 1B/2B
    // PMS name does NOT identify a real building; neither does numeric floor.
    const groups = groupGozsduOverviewByBuilding(list, mappings, buildings, displayName);
    return (
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {icon}<span className="text-sm font-semibold">{title}</span>
          <Badge variant="secondary" className="text-xs">{list.length}</Badge>
          <span className="text-[10px] text-muted-foreground">{hint}</span>
        </div>
        {list.length === 0 ? <p className="pl-6 text-xs text-muted-foreground">No rooms</p> : (
          <div className="space-y-1.5">
            {groups.map(group => (
              <div key={group.key} className="flex items-start gap-2">
                <Badge variant="outline" className="mt-0.5 w-[88px] max-w-[88px] shrink-0 whitespace-normal break-words text-center text-[10px] leading-tight sm:w-[110px] sm:max-w-[110px]" title={group.label}>{group.label}</Badge>
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {group.rooms.map(room => <div key={room.id} className="animate-fade-in">{renderChip(room, bucket)}</div>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };
'''
source = source[:start] + replacement + source[end:]
# A central screenshot regression: active chips must no longer render suffixes.
assert "                {room.room_number}\n                {room.pms_metadata?.manual_checkout" not in source
assert 'groupGozsduOverviewByBuilding(list, mappings, buildings, displayName)' in source
assert 'F{floor}' not in source
assert 'roomId: room.id, roomNumber: room.room_number' in source or 'roomId: room.id,\n' in source
path.write_text(source)
print('Applied Gozsdu-only canonical label and real-building overview patch; no database changes')
