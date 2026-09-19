#!/usr/bin/env python3
"""Second fail-closed patch for issue #283: server-side midnight safety."""
from pathlib import Path
import subprocess


def patch(path: str, replacements: list[tuple[str, str]]) -> None:
    p = Path(path)
    content = p.read_text(encoding="utf-8")
    for old, new in replacements:
        count = content.count(old)
        if count != 1:
            raise RuntimeError(f"{path}: expected one match, found {count}: {old[:95]!r}")
        content = content.replace(old, new, 1)
    p.write_text(content, encoding="utf-8")
    print(f"PATCHED {path}")


patch("supabase/functions/_shared/budapestBusinessDate.ts", [(
    "  return `${year}-${month}-${day}`;\n}\n",
    "  return `${year}-${month}-${day}`;\n}\n\n"
    "/** UTC instant at the start of the specified Budapest calendar day.\n"
    " * Unlike `${day}T00:00:00Z`, this respects winter/summer time.\n"
    " */\n"
    "export function budapestBusinessDayStartUtc(day: string): string {\n"
    "  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(day)) throw new Error('Invalid Budapest business date');\n"
    "  const midnight = new Date(`${day}T00:00:00.000Z`);\n"
    "  if (Number.isNaN(midnight.getTime())) throw new Error('Invalid Budapest business date');\n"
    "  const parts = new Intl.DateTimeFormat('en-GB', {\n"
    "    timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit',\n"
    "    second: '2-digit', hourCycle: 'h23',\n"
    "  }).formatToParts(midnight);\n"
    "  const part = (type: string) => Number(parts.find(item => item.type === type)?.value);\n"
    "  const hour = part('hour');\n"
    "  const minute = part('minute');\n"
    "  const second = part('second');\n"
    "  if (![hour, minute, second].every(Number.isFinite)) throw new Error('Invalid Budapest midnight');\n"
    "  return new Date(midnight.getTime() - (hour * 3600 + minute * 60 + second) * 1000).toISOString();\n"
    "}\n",
)])

patch("supabase/functions/_shared/previoRoomStateGuard.ts", [
    (
        "interface CurrentRoomState {",
        'import { budapestBusinessDate } from "./budapestBusinessDate.ts";\n\ninterface CurrentRoomState {',
    ),
    (
        '    const today = new Date().toISOString().slice(0, 10);',
        '    const today = budapestBusinessDate();',
    ),
])

patch("supabase/functions/previo-pms-sync/core.ts", [
    (
        'import { budapestBusinessDate } from "../_shared/budapestBusinessDate.ts";',
        'import { budapestBusinessDate, budapestBusinessDayStartUtc } from "../_shared/budapestBusinessDate.ts";',
    ),
    (
        '        const todayStart = `${today}T00:00:00Z`;',
        '        const todayStart = budapestBusinessDayStartUtc(today);',
    ),
    (
        '        const todayEnd = `${tomorrow}T00:00:00Z`;',
        '        const todayEnd = budapestBusinessDayStartUtc(tomorrow);',
    ),
])

patch("src/lib/pmsMidnightRollover.test.ts", [
    (
        'import { budapestBusinessDate } from "../../supabase/functions/_shared/budapestBusinessDate";',
        'import { budapestBusinessDate, budapestBusinessDayStartUtc } from "../../supabase/functions/_shared/budapestBusinessDate";',
    ),
    (
        '    expect(startOfBudapestDayUtc(day)).toBe(expected);',
        '    expect(startOfBudapestDayUtc(day)).toBe(expected);\n    expect(budapestBusinessDayStartUtc(day)).toBe(expected);',
    ),
])

for path, stale in {
    'supabase/functions/_shared/previoRoomStateGuard.ts': 'const today = new Date().toISOString().slice(0, 10)',
    'supabase/functions/previo-pms-sync/core.ts': 'const todayStart = `${today}T00:00:00Z`',
}.items():
    if stale in Path(path).read_text(encoding='utf-8'):
        raise RuntimeError(f'Stale UTC date remains in {path}')

# Existing workflow stages first-round source files after tests/build. Stage
# second-round changes explicitly so both rounds are committed together.
subprocess.run([
    'git', 'add',
    'supabase/functions/_shared/budapestBusinessDate.ts',
    'supabase/functions/_shared/previoRoomStateGuard.ts',
    'supabase/functions/previo-pms-sync/core.ts',
    'src/lib/pmsMidnightRollover.test.ts',
], check=True)
print('Second-round server changes staged for guarded CI commit')
