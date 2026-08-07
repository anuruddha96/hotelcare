// Shared "tap to select" state for the housekeeping board.
//
// Native HTML5 drag does not fire on touch devices, and on a long board a chip
// at the top is painful to drag down to the housekeeper cards. Selection mode
// gives the same result with taps: pick units on the board, then pick a
// housekeeper in the sticky assign bar.
//
// The board and the housekeeper cards are separate components, so the state
// lives in a tiny module-level store (same pattern as stagedAssignments).

import { useSyncExternalStore } from 'react';

export interface SelectedUnit {
  roomId: string;
  roomNumber: string;
  /** 'checkout' | 'daily' — used when inserting a new assignment. */
  sourceType: string;
  assignedTo: string | null;
  assignedToName: string | null;
}

let selection: SelectedUnit[] = [];
const listeners = new Set<() => void>();

function emit() {
  selection = [...selection];
  listeners.forEach((l) => l());
}

export function toggleUnitSelection(unit: SelectedUnit) {
  selection = selection.some((u) => u.roomId === unit.roomId)
    ? selection.filter((u) => u.roomId !== unit.roomId)
    : [...selection, unit];
  emit();
}

/** Select every given unit; if all of them are already selected, deselect them. */
export function toggleUnitGroupSelection(units: SelectedUnit[]) {
  if (units.length === 0) return;
  const allSelected = units.every((u) => selection.some((s) => s.roomId === u.roomId));
  if (allSelected) {
    const ids = new Set(units.map((u) => u.roomId));
    selection = selection.filter((s) => !ids.has(s.roomId));
  } else {
    const existing = new Set(selection.map((s) => s.roomId));
    selection = [...selection, ...units.filter((u) => !existing.has(u.roomId))];
  }
  emit();
}

export function clearUnitSelection() {
  if (selection.length === 0) return;
  selection = [];
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return selection;
}

export function useUnitSelection() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
