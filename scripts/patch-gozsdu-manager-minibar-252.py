#!/usr/bin/env python3
from pathlib import Path
p=Path('src/components/dashboard/GozsduRoomEssentials.tsx')
s=p.read_text()
def replace(old,new):
 global s
 assert s.count(old)==1, f'Expected exactly one occurrence of {old!r}, got {s.count(old)}'
 s=s.replace(old,new,1)
replace("import { RoomMinibarOperations } from './RoomMinibarOperations';\n",'')
replace("useState<'main' | 'requests' | 'minibar'>('main')", "useState<'main' | 'requests'>('main')")
replace("  const isCheckout = serviceLabel.toLowerCase().includes('checkout');\n",'')
replace("      {panel === 'requests' ? <RoomGuestRequestsPanel roomId={roomId} roomNumber={roomLabel}\n        assignmentId={assignment?.id || null} workDate={selectedDate} readOnly={!today} />\n        : <RoomMinibarOperations roomId={roomId} roomNumber={roomLabel} isCheckout={isCheckout}\n            readOnly={!today} onChanged={() => void load(false)} />}", "      <RoomGuestRequestsPanel roomId={roomId} roomNumber={roomLabel}\n        assignmentId={assignment?.id || null} workDate={selectedDate} readOnly={!today} />")
replace("      <div className=\"grid gap-2 sm:grid-cols-2\">\n        <Button variant=\"outline\" onClick={() => setPanel('requests')}>Guest requests</Button>\n        <Button variant=\"outline\" onClick={() => setPanel('minibar')}>Minibar & refill history</Button>\n      </div>", "      <Button variant=\"outline\" className=\"w-full\" onClick={() => setPanel('requests')}>Guest requests</Button>")
p.write_text(s)
assert 'minibar' not in s.lower(), 'Unexpected remaining minibar operation in Gozsdu essentials'
print('Removed Gozsdu-only manager minibar panel without touching room data, assignment actions, or other hotels.')
