from pathlib import Path
p = Path('src/lib/nextDayAutoAssignBridgeCore.ts')
s = p.read_text()
old = '  if (!roomCount || capturedTimes.length !== snapshotRows.length) return null;'
new = "  // Preserve the original count-based reuse behaviour for every other hotel.\n  // Only Gozsdu requires every selected-date row to carry a capture timestamp.\n  if (!roomCount || (args.hotelId === GOZSDU_COURT_HOTEL_ID\n    ? capturedTimes.length !== snapshotRows.length\n    : capturedTimes.length < roomCount)) return null;"
assert s.count(old) == 1, f'Unexpected snapshot count anchor: {s.count(old)}'
p.write_text(s.replace(old, new, 1))
print('Non-Gozsdu reuse count condition preserved verbatim.')
