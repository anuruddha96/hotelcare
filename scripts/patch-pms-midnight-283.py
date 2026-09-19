#!/usr/bin/env python3
"""Third guarded patch: update an open Team View on Budapest day rollover."""
from pathlib import Path
import subprocess


def patch(path: str, edits: list[tuple[str, str]]) -> None:
    source = Path(path).read_text(encoding='utf-8')
    for old, new in edits:
        count = source.count(old)
        if count != 1:
            raise RuntimeError(f'{path}: expected one match, found {count}: {old[:100]!r}')
        source = source.replace(old, new, 1)
    Path(path).write_text(source, encoding='utf-8')
    print(f'PATCHED {path}')


patch('src/lib/budapestTime.ts', [(
    'function budapestHour(at: Date = new Date()): number {',
    '/** Advance only a live day view when Budapest rolls over. Never override a\n'
    ' * manager-selected historical/future date or discard pending assignments.\n'
    ' */\n'
    'export function rollForwardSelectedBusinessDate(\n'
    '  selectedDate: string, previousBusinessDate: string, currentBusinessDate: string,\n'
    '  hasUnsavedMoves = false,\n'
    '): string {\n'
    '  return !hasUnsavedMoves && selectedDate === previousBusinessDate\n'
    '    && currentBusinessDate > previousBusinessDate\n'
    '    ? currentBusinessDate : selectedDate;\n'
    '}\n\n'
    'function budapestHour(at: Date = new Date()): number {',
)])

patch('src/components/dashboard/HousekeepingManagerView.tsx', [
    (
        "import React, { useState, useEffect } from 'react';",
        "import React, { useState, useEffect, useRef } from 'react';",
    ),
    (
        "import { todayBudapest } from '@/lib/budapestTime';",
        "import { todayBudapest, rollForwardSelectedBusinessDate } from '@/lib/budapestTime';",
    ),
    (
        '  const [selectedDate, setSelectedDate] = useState(todayBudapest());',
        '  const [selectedDate, setSelectedDate] = useState(todayBudapest());\n'
        '  const previousBusinessDateRef = useRef(todayBudapest());',
    ),
    (
        '  const [applying, setApplying] = useState(false);',
        '  const [applying, setApplying] = useState(false);\n\n'
        '  // An open Team View must move to the new Budapest workday without\n'
        '  // changing a deliberately selected date or losing unsaved assignments.\n'
        '  useEffect(() => {\n'
        '    const checkBusinessDay = () => {\n'
        '      const current = todayBudapest();\n'
        '      const previous = previousBusinessDateRef.current;\n'
        '      if (current === previous) return;\n'
        '      previousBusinessDateRef.current = current;\n'
        '      const next = rollForwardSelectedBusinessDate(\n'
        '        selectedDate, previous, current, stagedMoves.length > 0,\n'
        '      );\n'
        '      if (next !== selectedDate) setSelectedDate(next);\n'
        '      else if (selectedDate === previous && stagedMoves.length > 0) {\n'
        '        toast.warning("A new Budapest workday started. Save or discard your unsaved room moves before switching dates.");\n'
        '      }\n'
        '    };\n'
        '    const timer = window.setInterval(checkBusinessDay, 30_000);\n'
        '    window.addEventListener("focus", checkBusinessDay);\n'
        '    return () => {\n'
        '      window.clearInterval(timer);\n'
        '      window.removeEventListener("focus", checkBusinessDay);\n'
        '    };\n'
        '  }, [selectedDate, stagedMoves.length]);',
    ),
])

patch('src/lib/pmsMidnightRollover.test.ts', [
    (
        'import { todayBudapest, tomorrowBudapest, startOfBudapestDayUtc } from "./budapestTime";',
        'import { todayBudapest, tomorrowBudapest, startOfBudapestDayUtc, rollForwardSelectedBusinessDate } from "./budapestTime";',
    ),
    (
        '  it("turns yesterday\'s seven C/O+1 rooms into today\'s scheduled checkouts only on a new PMS snapshot", () => {',
        '  it("rolls an open room board forward but protects selected dates and unsaved assignments", () => {\n'
        '    expect(rollForwardSelectedBusinessDate("2026-09-19", "2026-09-19", "2026-09-20")).toBe("2026-09-20");\n'
        '    expect(rollForwardSelectedBusinessDate("2026-09-18", "2026-09-19", "2026-09-20")).toBe("2026-09-18");\n'
        '    expect(rollForwardSelectedBusinessDate("2026-09-21", "2026-09-19", "2026-09-20")).toBe("2026-09-21");\n'
        '    expect(rollForwardSelectedBusinessDate("2026-09-19", "2026-09-19", "2026-09-20", true)).toBe("2026-09-19");\n'
        '  });\n\n'
        '  it("turns yesterday\'s seven C/O+1 rooms into today\'s scheduled checkouts only on a new PMS snapshot", () => {',
    ),
])
subprocess.run(['git', 'add', 'src/lib/budapestTime.ts', 'src/components/dashboard/HousekeepingManagerView.tsx', 'src/lib/pmsMidnightRollover.test.ts'], check=True)
print('Manager live-day rollover staged')
