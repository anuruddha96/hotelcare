#!/usr/bin/env python3
"""One-shot, exact-anchor Gozsdu-only manager move patch; fail closed on drift."""
from pathlib import Path

ui = Path('src/components/dashboard/AutoRoomAssignmentImpl.tsx')
text = ui.read_text()

def replace_exact(old: str, new: str, label: str, count: int = 1) -> None:
    global text
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f'Unsafe {label}: expected {count} occurrences, found {actual}')
    text = text.replace(old, new)

replace_exact(
    "import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';\n",
    "import { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';\nimport { hasManagerPowers } from '@/lib/roleAccess';\n",
    'manager role import',
)
replace_exact(
    "    const next = moveRoom(assignmentPreviews, roomId, fromStaffId, toStaffId);\n"
    "    if (isGozsdu && next === assignmentPreviews) {\n"
    "      toast.warning('These buildings cannot be combined for the same housekeeper.');\n"
    "      return;\n"
    "    }\n",
    "    // Building restrictions apply to automatic proposals. A deliberate manual\n"
    "    // move may override the route only for a verified manager role.\n"
    "    const managerOverride = isGozsdu && hasManagerPowers(profile?.role);\n"
    "    const next = moveRoom(assignmentPreviews, roomId, fromStaffId, toStaffId, managerOverride);\n"
    "    if (isGozsdu && next === assignmentPreviews) {\n"
    "      toast.warning(isLaundryner(toStaffId)\n"
    "        ? 'Laundryners cannot receive cleaning rooms.'\n"
    "        : 'These buildings cannot be combined automatically. Only managers can override manually.');\n"
    "      return;\n"
    "    }\n"
    "    if (managerOverride && !gozsduAllocationRespectsBuildings(next)) {\n"
    "      toast.info('Manager override: this housekeeper now has rooms across mapped buildings. Automatic allocation rules remain unchanged.');\n"
    "    }\n",
    'manual drag/tap handler',
)
replace_exact(
    '|| !gozsduAllocationRespectsBuildings(assignmentPreviews)',
    '|| (!hasManagerPowers(profile?.role) && !gozsduAllocationRespectsBuildings(assignmentPreviews))',
    'preview and save building guards', count=2,
)
ui.write_text(text)

tests = Path('src/lib/gozsduManagerManualMoves.test.ts')
test_text = tests.read_text()
old = "    expect(autoAssignRooms([room('another-west', 'Building I'), room('another-east', 'Kazinczy C')], staff,\n      undefined, undefined, { hotelName: 'Gozsdu Court Budapest' })).toSatisfy?.toBeUndefined;\n"
new = "    const regenerated = autoAssignRooms([room('another-west', 'Building I'), room('another-east', 'Kazinczy C')], staff,\n      undefined, undefined, { hotelName: 'Gozsdu Court Budapest' });\n    expect(gozsduAllocationRespectsBuildings(regenerated)).toBe(true);\n"
if test_text.count(old) != 1:
    raise SystemExit('Unsafe regression-test anchor')
tests.write_text(test_text.replace(old, new))
print('Patched manager-only UI and confirmation guards; corrected regression test.')
