import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isHotelMemoriesBudapest } from '../hotel-memories-housekeeping';

const pms = readFileSync('src/lib/pmsRefresh.ts', 'utf8');
const hub = readFileSync('src/components/dashboard/RoomOperationsQuickHub.tsx', 'utf8');
const provenance = readFileSync('src/components/dashboard/RoomNoteProvenance.tsx', 'utf8');
const detail = readFileSync('src/components/dashboard/RoomDetailDialog.tsx', 'utf8');
const guard = readFileSync('supabase/migrations/20261027143000_hmb_manager_only_room_note_origin.sql', 'utf8');

describe('Hotel Memories room note origin isolation', () => {
  it('recognizes both Hotel Memories aliases', () => {
    expect(isHotelMemoriesBudapest('Hotel Memories Budapest')).toBe(true);
    expect(isHotelMemoriesBudapest('memories-budapest')).toBe(true);
    expect(isHotelMemoriesBudapest('Hotel Mika Downtown')).toBe(false);
  });
  it('does not overwrite a manager note with Previo text during HMB refresh', () => {
    expect(pms).not.toContain('updateData.notes =');
    expect(pms).toContain('updateData.pms_metadata.noteInternal = housekeepingNote ?? null');
  });
  it('shows only authentic staff edits in operational note history', () => {
    expect(provenance).toContain("rpc('get_room_note_history'");
    expect(detail).toContain("rpc('get_room_note_history'");
    expect(provenance).not.toContain("rpc('get_room_note_provenance'");
  });
  it('keeps HMB reception view-only for shared instructions', () => {
    expect(hub).toContain('const canWriteNotes = canManage;');
  });
  it('blocks unverified text injection while preserving planned notes and service flags', () => {
    expect(guard).toContain('v_user IS NULL OR v_pms_changed');
    expect(guard).toContain('v_old_human_original');
    expect(guard).toContain('NEW.hotelcare_planned_note_shadow');
    expect(guard).toContain('[ROOM_CLEANING]');
    expect(guard).toContain('Only Hotel Memories managers or supervisors');
  });
});
