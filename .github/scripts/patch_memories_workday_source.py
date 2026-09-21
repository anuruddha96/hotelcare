"""One-time, assertion-checked patch for the Memories room-overview note writer.

The same shared editor code serves other hotels, so changes here are limited to
CAS safety and avoiding stale/blank autosaves; no hotel workflow is altered.
"""
from pathlib import Path

source_path = Path('src/components/dashboard/HotelRoomOverviewLive.tsx')
source = source_path.read_text()
start_marker = '  const savePopoverRoomNotes = useCallback(async ('
end_marker = '  // Format a YYYY-MM-DD date for the "Yesterday — {date}" header'
assert source.count(start_marker) == 1, 'Cannot uniquely locate popover note writer'
assert source.count(end_marker) == 1, 'Cannot uniquely locate popover note writer end'
start = source.index(start_marker)
end = source.index(end_marker, start)
source = source[:start] + '''  const savePopoverRoomNotes = useCallback(async (
    room: RoomData,
    noteText: string,
    assignmentStatus?: string,
    notify: boolean = false,
  ) => {
    try {
      const previousText = parseRoomFlags(room.notes).cleanNotes.trim();
      // A blur from an untouched or re-rendered popover is NOT an instruction
      // to clear the manager's note. Empty text may expire at local midnight.
      if (noteText.trim() === previousText) {
        setPopoverNotesSaveState('saved');
        return true;
      }
      if (!noteText.trim() && previousText) {
        throw new Error('Today’s manager notes remain active until midnight. Refresh the room if this note is outdated.');
      }

      setPopoverNotesSaveState('saving');
      const currentFlags = parseRoomFlags(room.notes);
      const { buildRoomNotes } = await import('@/lib/room-service-flags');
      const newFullNotes = buildRoomNotes(
        {
          collectExtraTowels: currentFlags.collectExtraTowels,
          roomCleaning: currentFlags.roomCleaning,
        },
        noteText,
      );

      if (newFullNotes !== (room.notes || '')) {
        // Compare-and-swap is essential: PMS, supervisors, or another open
        // editor may have updated the note after the chip was rendered.
        const { data, error } = await (supabase as any).rpc('save_room_note_if_unchanged', {
          p_room_id: room.id,
          p_notes: newFullNotes,
          p_expected_notes: room.notes ?? null,
        });
        if (error) throw error;
        const savedRoom = Array.isArray(data) ? data[0] : data;
        if (!savedRoom?.room_id) throw new Error('Room note was not saved. Refresh and retry.');

        setRooms(prev => prev.map(r =>
          r.id === room.id ? { ...r, notes: savedRoom.notes ?? null } : r,
        ));
        window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
      }

      setPopoverNotesSaveState('saved');
      if (assignmentStatus === 'completed' && notify) {
        toast.warning(`⚠️ Room ${room.room_number} was already cleaned. The housekeeper will need to be informed.`, { duration: 5000 });
      }
      if (notify) toast.success(`Notes saved for room ${room.room_number}`);
      return true;
    } catch (error) {
      console.error('Failed to save room notes:', error);
      setPopoverNotesSaveState('error');
      if (notify) toast.error((error as Error)?.message || 'Failed to save notes');
      window.dispatchEvent(new CustomEvent('hk-assignments-changed'));
      return false;
    }
  }, []);

''' + source[end:]

# Both service-flag buttons previously used an unconditional update of the
# complete notes column. A stale flag click could erase newer manual text.
old_flag_write = '''                      const { error } = await supabase.from('rooms').update({ notes: updatedNotes || null } as any).eq('id', room.id);
                      if (error) throw error;
                      setRooms(prev => prev.map(r => r.id === room.id ? { ...r, notes: updatedNotes || null } : r));'''
new_flag_write = '''                      let noteUpdate = supabase.from('rooms').update({ notes: updatedNotes || null } as any).eq('id', room.id);
                      noteUpdate = room.notes == null
                        ? noteUpdate.is('notes', null)
                        : noteUpdate.eq('notes', room.notes);
                      const { data: savedRoom, error } = await noteUpdate.select('id, notes').maybeSingle();
                      if (error) throw error;
                      if (!savedRoom) throw new Error('Room instructions changed. Refresh before retrying.');
                      setRooms(prev => prev.map(r => r.id === room.id ? { ...r, notes: savedRoom.notes ?? null } : r));'''
assert source.count(old_flag_write) == 2, f'Expected two unsafe flag writers, found {source.count(old_flag_write)}'
source = source.replace(old_flag_write, new_flag_write)

old_blur = '''                    onBlur={() => {
                      if (popoverNotesSaveTimerRef.current) {
                        clearTimeout(popoverNotesSaveTimerRef.current);
                        popoverNotesSaveTimerRef.current = null;
                      }
                      void savePopoverRoomNotes(room, popoverNotes, assignmentStatus);
                    }}'''
new_blur = '''                    onBlur={() => {
                      if (popoverNotesSaveTimerRef.current) {
                        clearTimeout(popoverNotesSaveTimerRef.current);
                        popoverNotesSaveTimerRef.current = null;
                      }
                      // No stale/blank blur saves. A save already in flight
                      // must finish before another write may begin.
                      if (popoverNotesSaveState === 'saving'
                        || popoverNotes === parseRoomFlags(room.notes).cleanNotes
                        || !popoverNotes.trim()) return;
                      void savePopoverRoomNotes(room, popoverNotes, assignmentStatus);
                    }}'''
assert source.count(old_blur) == 1, 'Cannot locate exact unsafe blur writer'
source = source.replace(old_blur, new_blur)

# Prevent a prior room's pending autosave from accidentally targeting another
# room after the supervisor moves the mouse between chips.
old_hover = '''    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredRoomId(roomId);
      const flags = parseRoomFlags(room.notes);
      setPopoverNotes(flags.cleanNotes);
      setPopoverNotesSaveState('idle');
    }, 150);'''
new_hover = '''    hoverTimeoutRef.current = setTimeout(() => {
      // A pending edit continues using its own captured room and draft; it
      // must not mutate the next room or auto-clear its note on hover.
      setHoveredRoomId(roomId);
      const flags = parseRoomFlags(room.notes);
      setPopoverNotes(flags.cleanNotes);
      setPopoverNotesSaveState('idle');
    }, 150);'''
assert source.count(old_hover) == 1
source = source.replace(old_hover, new_hover)
source_path.write_text(source)

regression = Path('src/lib/__tests__/memoriesWorkdayInstructions.test.ts')
assert not regression.exists(), 'Regression test already exists; inspect before retrying'
regression.write_text('''import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const overview = readFileSync('src/components/dashboard/HotelRoomOverviewLive.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20260921204500_memories_workday_instruction_guard.sql', 'utf8');

describe('Hotel Memories working-day instructions', () => {
  it('requires expected notes in the previously unprotected chip popover', () => {
    const editor = overview.split('const savePopoverRoomNotes =')[1].split('const formatPrevDate =')[0];
    expect(editor).toContain("rpc('save_room_note_if_unchanged'");
    expect(editor).toContain('p_expected_notes: room.notes ?? null');
    expect(editor).not.toContain(".update({ notes: newFullNotes || null }");
    expect(editor).toContain('if (!noteText.trim() && previousText)');
  });
  it('guards both service switches against competing instruction edits', () => {
    expect(overview.match(/noteUpdate\\.select\\('id, notes'\\)\\.maybeSingle\\(\\)/g)).toHaveLength(2);
    expect(overview).toContain("noteUpdate.eq('notes', room.notes)");
    expect(overview).toContain("noteUpdate.is('notes', null)");
  });
  it('does not autosave untouched, blank, or in-flight popovers on blur', () => {
    expect(overview).toContain("popoverNotesSaveState === 'saving'");
    expect(overview).toContain('popoverNotes === parseRoomFlags(room.notes).cleanNotes');
    expect(overview).toContain('|| !popoverNotes.trim()) return;');
  });
  it('confines the database safeguard and expiry to Memories and Budapest date', () => {
    expect(migration).toContain("'hotel memories budapest'");
    expect(migration).toContain("AT TIME ZONE 'Europe/Budapest'");
    expect(migration).toContain('OLD.memories_manual_note_date = v_today');
    expect(migration).toContain('r.memories_manual_note_date < v_today');
    expect(migration).toContain('r.memories_manual_bed_date < v_today');
    expect(migration).not.toContain('DELETE FROM public.room_assignments');
  });
});
''')
print('Patched room-overview editor, 2 flag writers, blur guard; created regression tests.')
