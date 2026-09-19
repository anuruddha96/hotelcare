#!/usr/bin/env python3
"""One-time, fail-closed source patch for issue #283. Remove after applying."""
from pathlib import Path


def patch(path: str, replacements: list[tuple[str, str]]) -> None:
    p = Path(path)
    original = p.read_text(encoding="utf-8")
    content = original
    for old, new in replacements:
        occurrences = content.count(old)
        if occurrences != 1:
            raise RuntimeError(f"{path}: expected exactly one match, found {occurrences}: {old[:110]!r}")
        content = content.replace(old, new, 1)
    if original == content:
        raise RuntimeError(f"{path}: patch did not change file")
    p.write_text(content, encoding="utf-8")
    print(f"PATCHED {path} ({len(replacements)} guarded edits)")


patch("src/lib/budapestTime.ts", [
    (
        "export function todayBudapest(at: Date = new Date()): string {\n"
        "  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(at);\n"
        "}",
        "export function todayBudapest(at: Date = new Date()): string {\n"
        "  const parts = new Intl.DateTimeFormat('en-GB', {\n"
        "    timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit',\n"
        "  }).formatToParts(at);\n"
        "  const part = (type: string) => parts.find(item => item.type === type)?.value;\n"
        "  const year = part('year');\n"
        "  const month = part('month');\n"
        "  const day = part('day');\n"
        "  if (!year || !month || !day) throw new Error('Unable to determine Budapest business date');\n"
        "  return `${year}-${month}-${day}`;\n"
        "}",
    ),
    (
        "function budapestHour(at: Date = new Date()): number {",
        "/** Convert a Budapest business day to its actual UTC midnight for sync history.\n"
        " * The offset is +01:00 or +02:00 depending on the local date (DST).\n"
        " */\n"
        "export function startOfBudapestDayUtc(day: string): string {\n"
        "  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(day)) throw new Error('Invalid business day');\n"
        "  const utcMidnight = new Date(`${day}T00:00:00.000Z`);\n"
        "  if (Number.isNaN(utcMidnight.getTime())) throw new Error('Invalid business day');\n"
        "  const parts = new Intl.DateTimeFormat('en-GB', {\n"
        "    timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit',\n"
        "    second: '2-digit', hourCycle: 'h23',\n"
        "  }).formatToParts(utcMidnight);\n"
        "  const part = (type: string) => Number(parts.find(item => item.type === type)?.value);\n"
        "  const hour = part('hour');\n"
        "  const minute = part('minute');\n"
        "  const second = part('second');\n"
        "  if (![hour, minute, second].every(Number.isFinite)) throw new Error('Invalid Budapest time');\n"
        "  return new Date(utcMidnight.getTime() - (hour * 3600 + minute * 60 + second) * 1000).toISOString();\n"
        "}\n\n"
        "function budapestHour(at: Date = new Date()): number {",
    ),
])

patch("src/lib/pmsRefresh.ts", [
    (
        'import { resolveHotelKeys } from "@/lib/hotelKeys";',
        'import { resolveHotelKeys } from "@/lib/hotelKeys";\n'
        'import { todayBudapest } from "@/lib/budapestTime";',
    ),
    (
        '  const direct = raw.match(/^\\d{4}-\\d{2}-\\d{2}/)?.[0];\n'
        '  if (direct) return direct;\n'
        '  const parsed = new Date(raw);\n'
        '  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().split("T")[0];',
        '  // A date-only value is a business date; timestamps are instants and\n'
        '  // must be interpreted locally (22:12Z is already next day in Budapest).\n'
        '  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)) return raw;\n'
        '  const parsed = new Date(raw);\n'
        '  return Number.isNaN(parsed.getTime()) ? null : todayBudapest(parsed);',
    ),
    (
        '      if ((accData as any)?.reservationDataAuthoritative === false) merged.reservationDataAuthoritative = false;',
        '      const accountBusinessDate = (accData as any)?.businessDate;\n'
        '      if (accountBusinessDate) {\n'
        '        if (merged.businessDate && merged.businessDate !== accountBusinessDate) {\n'
        '          throw new Error("Previo accounts returned snapshots for different business dates; retry the sync.");\n'
        '        }\n'
        '        merged.businessDate = accountBusinessDate;\n'
        '      }\n'
        '      if ((accData as any)?.reservationDataAuthoritative === false) merged.reservationDataAuthoritative = false;',
    ),
    (
        '  const today = new Date().toISOString().split("T")[0];',
        '  const today = todayBudapest();\n'
        '  const snapshotBusinessDate = (data as any)?.businessDate;\n'
        '  // Do not apply a snapshot fetched across local midnight to another\n'
        '  // day, especially not before the destructive new-day housekeeping reset.\n'
        '  if (snapshotBusinessDate && snapshotBusinessDate !== today) {\n'
        '    throw new Error(`Previo snapshot is for ${snapshotBusinessDate}, but Budapest business date is ${today}. Please refresh again.`);\n'
        '  }',
    ),
    (
        '  // New-day DND reset: when the most recent PMS refresh for this hotel was',
        '  // New-day DND reset: when the most recent PMS refresh for this hotel was',
    ) if False else (
        '  if (!dryRun) {\n    try {\n      const { data: probe } = await supabase',
        '  if (!dryRun && reservationDataAuthoritative) {\n    try {\n      const { data: probe } = await supabase',
    ),
    (
        '        updateData.is_checkout_room = preserveExistingCheckout ? true : shouldBeCheckoutRoom;',
        '        updateData.is_checkout_room = effectiveCheckoutFlag;',
    ),
])

patch("src/contexts/LiveSyncContext.tsx", [
    (
        'import { resolveHotelKeys } from "@/lib/hotelKeys";',
        'import { resolveHotelKeys } from "@/lib/hotelKeys";\n'
        'import { startOfBudapestDayUtc, todayBudapest } from "@/lib/budapestTime";',
    ),
    (
        '  const [drawerOpen, setDrawerOpen] = useState(false);',
        '  const [drawerOpen, setDrawerOpen] = useState(false);\n'
        '  const [businessDate, setBusinessDate] = useState(() => todayBudapest());',
    ),
    (
        '  const enabled = !!user && !!profile?.role && ELIGIBLE_ROLES.has(profile.role) && hasPrevio;',
        '  // An open mobile/desktop tab must detect a new Budapest business day,\n'
        '  // not wait until logout, login or a full page reload.\n'
        '  useEffect(() => {\n'
        '    const updateBusinessDate = () => setBusinessDate(todayBudapest());\n'
        '    const timer = window.setInterval(updateBusinessDate, 30_000);\n'
        '    window.addEventListener("focus", updateBusinessDate);\n'
        '    return () => {\n'
        '      window.clearInterval(timer);\n'
        '      window.removeEventListener("focus", updateBusinessDate);\n'
        '    };\n'
        '  }, []);\n\n'
        '  const enabled = !!user && !!profile?.role && ELIGIBLE_ROLES.has(profile.role) && hasPrevio;',
    ),
    (
        '    const today = new Date().toISOString().slice(0, 10);',
        '    const today = businessDate;',
    ),
    (
        '.gte("created_at", `${today}T00:00:00`)',
        '.gte("created_at", startOfBudapestDayUtc(today))',
    ),
    (
        '  }, [enabled, hotelId, user?.id, runPms, runCheckouts, executiveRole]);',
        '  }, [enabled, hotelId, user?.id, runPms, runCheckouts, executiveRole, businessDate]);',
    ),
])

patch("supabase/functions/previo-pms-sync/core.ts", [
    (
        'import { callPrevioXml, loadPrevioCredentials, type PrevioXmlAuthVariant } from "../_shared/previoCredentials.ts";',
        'import { callPrevioXml, loadPrevioCredentials, type PrevioXmlAuthVariant } from "../_shared/previoCredentials.ts";\n'
        'import { budapestBusinessDate } from "../_shared/budapestBusinessDate.ts";',
    ),
    (
        'function todayUtcDate(): string {\n  return new Date().toISOString().slice(0, 10);\n}\n\n',
        '',
    ),
    (
        '    const today = todayUtcDate();',
        '    const today = budapestBusinessDate();',
    ),
    (
        '        hotel_id: targetHotel,\n        dryRun,\n        rosterSource,',
        '        hotel_id: targetHotel,\n        dryRun,\n        businessDate: today,\n        rosterSource,',
    ),
])

poll_path = Path("supabase/functions/previo-poll-checkouts/core.ts")
poll = poll_path.read_text(encoding="utf-8")
poll_import = 'import { callPrevioXml, loadPrevioCredentials } from "../_shared/previoCredentials.ts";'
if poll.count(poll_import) != 1:
    raise RuntimeError("Unexpected Previo poll import location")
poll = poll.replace(poll_import, poll_import + '\nimport { budapestBusinessDate } from "../_shared/budapestBusinessDate.ts";', 1)
poll_utc = 'const todayUtc = () => new Date().toISOString().slice(0, 10);\n'
if poll.count(poll_utc) != 1:
    raise RuntimeError("Unexpected Previo poll date declaration")
poll = poll.replace(poll_utc, '', 1)
if 'todayUtc()' not in poll:
    raise RuntimeError("Expected checkout polling date calls")
poll = poll.replace('todayUtc()', 'budapestBusinessDate()')
poll_path.write_text(poll, encoding="utf-8")
print("PATCHED supabase/functions/previo-poll-checkouts/core.ts (all business-date reads)")

# Fail closed if somebody reintroduces the known UTC date expressions in these paths.
for path, prohibited in {
    'src/lib/pmsRefresh.ts': 'const today = new Date().toISOString().split("T")[0]',
    'src/contexts/LiveSyncContext.tsx': 'const today = new Date().toISOString().slice(0, 10)',
    'supabase/functions/previo-pms-sync/core.ts': 'todayUtcDate()',
    'supabase/functions/previo-poll-checkouts/core.ts': 'todayUtc()',
}.items():
    if prohibited in Path(path).read_text(encoding="utf-8"):
        raise RuntimeError(f"UTC business day remains in {path}")
print("All guarded date rewrites completed")
