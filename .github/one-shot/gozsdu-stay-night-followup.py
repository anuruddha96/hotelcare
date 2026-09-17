from pathlib import Path


def change(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected exactly one anchor, found {count}: {old[:100]!r}')
    target.write_text(text.replace(old, new, 1))

eligibility = 'src/lib/autoAssignRoomEligibility.gozsdu.test.ts'
change(eligibility, "it('includes operating second-night towel service'", "it('includes third-night PMS towel service (two nights completed)'")
change(eligibility, 'currentNight: 2, totalNights: 3 },\n    })).toBe(true);', 'currentNight: 3, totalNights: 3 },\n    })).toBe(true);')
change(eligibility, "it('includes operating fourth-night Change Room when the stay continues long enough'", "it('includes operating fifth-night Complete Textile Change when the stay continues long enough'")
change(eligibility, 'currentNight: 4, totalNights: 6 },\n    })).toBe(true);', 'currentNight: 5, totalNights: 7 },\n    })).toBe(true);')
change(eligibility, "it('keeps odd-night and arrival-only rooms out of Auto Assign'", "it('keeps even PMS nights and arrival-only rooms out of Auto Assign'")
change(eligibility, 'currentNight: 3, totalNights: 6 },\n    })).toBe(false);', 'currentNight: 4, totalNights: 6 },\n    })).toBe(false);')
change(eligibility, 'isNoShow: true, currentNight: 2, totalNights: 3', 'isNoShow: true, currentNight: 3, totalNights: 3')

bridge = 'src/lib/nextDayAutoAssignBridge.gozsdu.test.ts'
change(bridge,
       "it('keeps checkout, selects only even-night service, and excludes inactive rooms'",
       "it('keeps checkout, selects tomorrow PMS 3/N and 5/N service, and excludes inactive rooms'")
change(bridge,
       "room('odd', 2, 6), room('towel', 3, 5), room('full', 3, 6),\n      room('private', 3, 6, { availability: 'non_guest' }),\n      room('unavailable', 3, 6, { availability: 'unavailable' }),",
       "room('not_due', 3, 6), room('towel', 2, 5), room('full', 4, 7),\n      room('private', 4, 7, { availability: 'non_guest' }),\n      room('unavailable', 4, 7, { availability: 'unavailable' }),")

snapshot = 'src/lib/nextDayHousekeepingSnapshot.test.ts'
change(snapshot,
       "it('respects Gozsdu 4/5 towel-only versus 4/6 Change Room tomorrow'",
       "it('respects Gozsdu 5/6 towel-only versus 5/7 Complete Textile Change on the selected date'")
change(snapshot,
       "snapshot('ST-101','ongoing','2026-09-07','2026-09-12'),\n      snapshot('ST-102','ongoing','2026-09-07','2026-09-13'),\n      snapshot('ST-103','ongoing','2026-09-10','2026-09-14')",
       "snapshot('ST-101','ongoing','2026-09-06','2026-09-12'),\n      snapshot('ST-102','ongoing','2026-09-06','2026-09-13'),\n      snapshot('ST-103','ongoing','2026-09-07','2026-09-14')")

hub = 'src/components/dashboard/RoomOperationsQuickHub.tsx'
change(hub,
       "import { hasManagerPowers } from '@/lib/roleAccess';",
       "import { hasManagerPowers } from '@/lib/roleAccess';\nimport { isGozsduCourtHotel } from '@/lib/gozsdu-housekeeping';")
change(hub,
       "  const readOnlyForPast = selectedDate !== todayBudapest();",
       "  const readOnlyForPast = selectedDate !== todayBudapest();\n  const textileChangeLabel = isGozsduCourtHotel(hotelName) ? 'Complete Textile Change' : 'Change Room';")
change(hub,
       "`Change Room ${selection.linenChangeRequired ? 'removed' : 'required'} — room ${selection.roomNumber}`",
       "`${textileChangeLabel} ${selection.linenChangeRequired ? 'removed' : 'required'} — room ${selection.roomNumber}`")
change(hub,
       '<p className="mt-1 text-xs font-bold">Change Room</p>',
       '<p className="mt-1 text-xs font-bold">{textileChangeLabel}</p>')

print('Updated Gozsdu-only next-day and auto-assign test fixtures plus property-gated QuickHub terminology.')
