import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const refresh = readFileSync('src/lib/pmsRefresh.ts', 'utf8');
const hub = readFileSync('src/components/dashboard/RoomOperationsQuickHub.tsx', 'utf8');
const detail = readFileSync('src/components/dashboard/RoomDetailDialog.tsx', 'utf8');
const provenance = readFileSync('src/components/dashboard/RoomNoteProvenance.tsx', 'utf8');
const db = readFileSync('supabase/migrations/20261027151500_portfolio_manager_owned_room_note_origin.sql', 'utf8');

describe('shared room notes are manager owned across every venue', () => {
  it('never writes incoming PMS note text into rooms.notes (RD, Gozsdu and SLNT)', () => {
    expect(refresh).toContain('updateData.pms_metadata.noteInternal = housekeepingNote ?? null');
    expect(refresh).toContain('updateData.pms_metadata.slntPrevioHousekeepingNote = housekeepingNote');
    expect(refresh).not.toContain('updateData.notes =');
    expect(refresh).not.toContain('reconcileSlntPrevioRoomNote(');
    expect(refresh).not.toContain('inferBedConfigFromNote(');
  });
  it('does not silently rewrite notes during the new-day PMS reset', () => {
    expect(refresh).not.toContain('patch.notes =');
    expect(refresh).toContain('if (!isStale) continue;');
  });
  it('restricts note entry but retains reception communication access', () => {
    expect(hub).toContain('const canWriteNotes = canManage;');
    expect(hub).toContain('const canCommunicate = canManage || (!isMemories && isReception);');
    expect(hub).toContain('canEdit={canWriteNotes}');
    expect(detail).toContain("const canEditRoomNote = hasManagerPowers(profile?.role) || profile?.role === 'supervisor';");
  });
  it('shows PMS source notes separately, never labelled as manager approval', () => {
    expect(hub).toContain('Previo source note — not manager-approved');
    expect(hub).toContain('It is not sent as a manager instruction');
    expect(provenance).toContain("rpc('get_room_note_history'");
  });
  it('guards every non-HMB property against automatic insert, replacement and clear', () => {
    expect(db).toContain('v_actor IS NULL OR NEW.pms_metadata IS DISTINCT FROM OLD.pms_metadata');
    expect(db).toContain('v_original_human_text');
    expect(db).toContain('NEW.hotelcare_planned_note_shadow');
    expect(db).toContain('COLLECT_EXTRA_TOWELS');
    expect(db).toContain('Only managers or supervisors');
    expect(db).toContain('hotel memories budapest');
  });
});
