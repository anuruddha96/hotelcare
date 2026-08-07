// Staged (unsaved) housekeeping assignment moves.
//
// Drag & drop on the Team View board no longer writes immediately: moves are
// staged here, mirrored to localStorage so a reload/tab switch does not lose
// them, and written in one pass when the manager presses "Apply".
//
// A tiny module-level store keeps the unit board and the housekeeper cards in
// sync even though they are separate components.

import { useSyncExternalStore } from 'react';

export interface StagedMove {
  roomId: string;
  roomNumber: string;
  /** null = unassign */
  toStaffId: string | null;
  toStaffName: string | null;
  fromStaffId: string | null;
  fromStaffName: string | null;
  /** 'checkout' | 'daily' | 'assigned' — used when inserting a new assignment. */
  sourceType: string;
  stagedAt: number;
}

interface DraftState {
  key: string | null;
  moves: StagedMove[];
  restored: boolean;
}

const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const storageKey = (key: string) => `hk-staged-moves:${key}`;

let state: DraftState = { key: null, moves: [], restored: false };
const listeners = new Set<() => void>();

function emit() {
  state = { ...state };
  listeners.forEach((l) => l());
}

function persist() {
  if (!state.key) return;
  try {
    if (state.moves.length === 0) localStorage.removeItem(storageKey(state.key));
    else localStorage.setItem(storageKey(state.key), JSON.stringify({ savedAt: Date.now(), moves: state.moves }));
  } catch {
    /* storage full / disabled — staging still works in memory */
  }
}

/** Point the store at a user+hotel+date scope, restoring any saved draft. */
export function initStagedScope(key: string) {
  if (state.key === key) return;
  let moves: StagedMove[] = [];
  let restored = false;
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (raw) {
      const parsed = JSON.parse(raw) as { savedAt: number; moves: StagedMove[] };
      if (parsed?.savedAt && Date.now() - parsed.savedAt < MAX_AGE_MS && Array.isArray(parsed.moves)) {
        moves = parsed.moves;
        restored = moves.length > 0;
      } else {
        localStorage.removeItem(storageKey(key));
      }
    }
  } catch {
    /* ignore malformed drafts */
  }
  state = { key, moves, restored };
  emit();
}

export function stageMove(move: Omit<StagedMove, 'stagedAt'>) {
  const others = state.moves.filter((m) => m.roomId !== move.roomId);
  const original = state.moves.find((m) => m.roomId === move.roomId);
  const next: StagedMove = {
    ...move,
    // keep the true original owner so Apply/rollback stay correct after re-drags
    fromStaffId: original ? original.fromStaffId : move.fromStaffId,
    fromStaffName: original ? original.fromStaffName : move.fromStaffName,
    stagedAt: Date.now(),
  };
  // Dragging a unit back to where it started cancels the staged move.
  state = next.toStaffId === next.fromStaffId
    ? { ...state, moves: others }
    : { ...state, moves: [...others, next] };
  persist();
  emit();
}

export function undoLastStagedMove() {
  state = { ...state, moves: state.moves.slice(0, -1) };
  persist();
  emit();
}

export function discardStagedMoves() {
  state = { ...state, moves: [], restored: false };
  persist();
  emit();
}

export function dropStagedMoves(roomIds: string[]) {
  if (roomIds.length === 0) return;
  state = { ...state, moves: state.moves.filter((m) => !roomIds.includes(m.roomId)) };
  persist();
  emit();
}

export function acknowledgeRestore() {
  state = { ...state, restored: false };
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return state;
}

export function useStagedMoves() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Where a unit currently sits on the board, taking staged moves into account. */
export function stagedOwner(moves: StagedMove[], roomId: string, actualStaffId: string | null): string | null {
  const staged = moves.find((m) => m.roomId === roomId);
  return staged ? staged.toStaffId : actualStaffId;
}
