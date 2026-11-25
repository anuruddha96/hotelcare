import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const detail = readFileSync('src/components/dashboard/RoomDetailDialog.tsx', 'utf8');
const quick = readFileSync('src/components/dashboard/RoomOperationsQuickHub.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20260920105000_memories_preserve_notes_and_cas.sql', 'utf8');

describe('manager room instructions must not be silently erased', () => {
  it('uses compare-and-swap in both note editors', () => {
    expect(detail).toContain("rpc('save_room_note_if_unchanged'");
    expect(detail).toContain('p_expected_notes: lastPersistedNotesRef.current');
    expect(quick).toContain("rpc('save_room_note_if_unchanged'");
    expect(quick).toContain('p_expected_notes: selection.roomNotes');
  });
  it('status changes cannot write stale notes and draft does not reset on room prop refresh', () => {
    const status = detail.split('const handleStatusChange =')[1].split('const handleSaveNotes =')[0];
    expect(status).not.toContain('notes: roomNotes');
    expect(detail).toContain('}, [open, room?.id]);');
  });
  it('flag toggles reject competing note changes', () => {
    expect(quick).toContain("Object.prototype.hasOwnProperty.call(patch, 'notes')");
    expect(quick).toContain("query.eq('notes', selection.roomNotes)");
    expect(quick).toContain('if (!data) throw new Error');
  });
  it('database guards same-stay PMS refresh and rejects stale note edits', () => {
    expect(migration).toContain('hotelcare_guard_memories_notes_on_refresh');
    expect(migration).toContain('r.notes IS NOT DISTINCT FROM p_expected_notes');
    expect(migration).toContain('NEW.pms_metadata');
  });
});
