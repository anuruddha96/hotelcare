import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const overview = readFileSync('src/components/dashboard/HotelRoomOverviewLive.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20260921204500_memories_workday_instruction_guard.sql', 'utf8');

describe('Hotel Memories working-day instructions', () => {
  it('requires expected notes in the previously unprotected chip popover', () => {
    const editor = overview.split('const savePopoverRoomNotes =')[1].split('const formatPrevDate =')[0];
    expect(editor).toContain("rpc('save_room_note_if_unchanged'");
    expect(editor).toContain('p_expected_notes: room.notes ?? null');
    expect(editor).not.toContain(".update({ notes: newFullNotes || null }");
    expect(editor).toContain('if (isHotelMemoriesBudapest(room.hotel) && !noteText.trim() && previousText)');
  });
  it('guards both service switches against competing instruction edits', () => {
    expect(overview.match(/noteUpdate\.select\('id, notes'\)\.maybeSingle\(\)/g)).toHaveLength(2);
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
