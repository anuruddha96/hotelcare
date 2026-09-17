from pathlib import Path
import re


def change(path: str, before: str, after: str) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(before)
    assert count == 1, f'{path}: expected one exact anchor, found {count}: {before[:95]!r}'
    file.write_text(source.replace(before, after, 1))


overview = 'src/components/dashboard/GozsduCourtRoomOverview.tsx'
change(overview,
       '            <div\n              className={`flex flex-col items-center gap-0.5 select-none transition-transform',
       '            <div\n              data-room-id={room.id}\n              className={`flex flex-col items-center gap-0.5 select-none transition-transform')

operations = 'src/components/dashboard/RoomOperationsWrapper.tsx'
change(operations,
       "import { todayBudapest } from '@/lib/budapestTime';",
       "import { todayBudapest } from '@/lib/budapestTime';\nimport { roomOperationsLookup } from '@/lib/roomOperationsLookup';")
change(operations,
       '      if (roomNumber) return { roomNumber, element: node };',
       '      if (roomNumber) return { roomNumber, roomId: node.dataset.roomId || null, element: node };')
change(operations,
       '  const loadRoom = useCallback(async (roomNumber: string) => {',
       '  const loadRoom = useCallback(async (roomNumber: string, roomId: string | null = null) => {')
change(operations,
       "      const { data: roomRows, error: roomError } = await supabase\n        .from('rooms')\n        .select('id, hotel, room_number, status, notes, room_type, room_category, room_size_sqm, bed_configuration, floor_number, is_checkout_room, towel_change_required, linen_change_required, last_cleaned_at, last_cleaned_by')\n        .in('hotel', hotelKeys)\n        .eq('room_number', roomNumber);",
       "      // Gozsdu displays the canonical PMS name, but 52 legacy rooms have a\n      // shortened persisted room_number. Resolve the clicked room by its stable\n      // database ID, while still enforcing the selected hotel's scope.\n      const lookup = roomOperationsLookup(roomId, roomNumber);\n      const { data: roomRows, error: roomError } = await supabase\n        .from('rooms')\n        .select('id, hotel, room_number, status, notes, room_type, room_category, room_size_sqm, bed_configuration, floor_number, is_checkout_room, towel_change_required, linen_change_required, last_cleaned_at, last_cleaned_by')\n        .in('hotel', hotelKeys)\n        .eq(lookup.column, lookup.value);")
change(operations, '    void loadRoom(chip.roomNumber);', '    void loadRoom(chip.roomNumber, chip.roomId);')
change(operations, '    await loadRoom(selection.roomNumber);', '    await loadRoom(selection.roomNumber, selection.roomId);')

maintenance = 'src/components/dashboard/MaintenanceStaffView.tsx'
change(maintenance,
       "  const [completionFile, setCompletionFile] = useState<File | null>(null);",
       "  const [completionFile, setCompletionFile] = useState<File | null>(null);\n  const [isSubmittingCompletion, setIsSubmittingCompletion] = useState(false);")
change(maintenance,
       "  const submitCompletion = async () => {\n    if (!selected || !resolution.trim() || !completionFile || !user?.id) { toast.error(c.photoRequired); return; }\n    try {",
       "  const submitCompletion = async () => {\n    if (isSubmittingCompletion) return;\n    if (!selected || !resolution.trim() || !completionFile || !user?.id) { toast.error(c.photoRequired); return; }\n    if (!completionFile.type.startsWith('image/')) { toast.error(c.photoRequired); return; }\n    setIsSubmittingCompletion(true);\n    try {")
change(maintenance,
       "    } catch (error) { console.error(error); toast.error(c.failed); }\n  };\n\n  const filtered =",
       "    } catch (error) { console.error(error); toast.error(c.failed); }\n    finally { setIsSubmittingCompletion(false); }\n  };\n\n  const filtered =")
change(maintenance,
       "onClick={() => { setSelected(ticket); setDialog('complete'); }}",
       "onClick={() => { setSelected(ticket); setResolution(ticket.resolution_text || ''); setCompletionFile(null); if (fileRef.current) fileRef.current.value = ''; setDialog('complete'); }}")
source = Path(maintenance).read_text()
old = re.search(r"      <Dialog open=\{dialog === 'complete'\}.*?</DialogContent></Dialog>", source, flags=re.S)
assert old and source.count("<Dialog open={dialog === 'complete'}") == 1, 'completion dialog anchor missing or duplicated'
new = '''      <Dialog open={dialog === 'complete'} onOpenChange={(next) => { if (!next && !isSubmittingCompletion) setDialog(null); }}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader><DialogTitle>{c.complete}</DialogTitle></DialogHeader>
          <Textarea value={resolution} onChange={e => setResolution(e.target.value)} placeholder={c.resolutionPlaceholder} rows={4} disabled={isSubmittingCompletion} />
          <p className="text-xs text-muted-foreground">
            {language === 'hu'
              ? 'A hibabejelentés mellékletei nem helyettesítik a javítás utáni fotót. Készítsen képet, vagy válassza ki a galériából.'
              : 'Issue attachments show the original problem. Add a separate after-repair photo using the camera or gallery.'}
          </p>
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label={c.photoRequired}
            onChange={e => {
              const file = e.currentTarget.files?.[0] || null;
              if (file && !file.type.startsWith('image/')) {
                toast.error(c.photoRequired);
                e.currentTarget.value = '';
                setCompletionFile(null);
                return;
              }
              setCompletionFile(file);
            }} />
          <Button type="button" variant="outline" disabled={isSubmittingCompletion}
            className="h-auto min-h-11 w-full min-w-0 justify-start whitespace-normal break-all py-2 text-left"
            onClick={() => fileRef.current?.click()}>
            <Camera className="mr-2 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">{completionFile
              ? `${language === 'hu' ? 'Kiválasztott fotó' : 'Selected photo'}: ${completionFile.name}`
              : language === 'hu' ? 'Befejezési fotó készítése / kiválasztása' : 'Take or choose completion photo'}</span>
          </Button>
          {!completionFile && <p className="text-xs text-amber-700" role="status">{c.photoRequired}</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button type="button" className="h-auto min-h-11 w-full min-w-0 whitespace-normal py-2" variant="outline"
              disabled={isSubmittingCompletion} onClick={() => setDialog(null)}>{c.cancel}</Button>
            <Button type="button" className="h-auto min-h-11 w-full min-w-0 whitespace-normal break-words bg-green-600 py-2 text-center leading-snug hover:bg-green-700"
              onClick={() => void submitCompletion()} disabled={isSubmittingCompletion || !resolution.trim() || !completionFile}>
              <CheckCircle2 className="mr-1 h-4 w-4 shrink-0" />{isSubmittingCompletion ? (language === 'hu' ? 'Beküldés…' : 'Submitting…') : c.submitApproval}
            </Button>
          </div>
        </DialogContent>
      </Dialog>'''
Path(maintenance).write_text(source[:old.start()] + new + source[old.end():])

# Guard against accidental changes outside the three intended existing files.
print('Patched Gozsdu chip ID, scoped operations lookup and mobile maintenance completion UX.')
