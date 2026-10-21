/**
 * Planning/audit breadcrumbs are useful to managers but not housekeeping
 * instructions. Preserve them in the assignment audit, but suppress recognized
 * automatic status lines in the corresponding housekeeper view.
 */
// Hotel Memories stores the guest's green-board decision in assignment.notes
// for workflow/audit. The machine-generated status must not be presented as
// a manager instruction, particularly after the housekeeping plan changes.
const MEMORIES_SYSTEM_LINES = [
  /^\[GREEN_BOARD_CLEAN_REQUEST\]\s*Green Clean My Room card seen at the door\s*[—–-]\s*cleaning requested\.?$/i,
  /^\[NO_BOARD_NO_CLEANING\]\s*Door checked\s*[—–-]\s*no green Clean My Room card\s*\/\s*no cleaning request\.?$/i,
];

const SLNT_SYSTEM_LINES = [
  /^auto[-\s]distributed after full slnt pms sync\.?$/i,
  /^unbooked at planning sync(?:\s*[-–—]\s*revalidate before cleaning)?\.?$/i,
];

export function housekeeperVisibleAssignmentNote(
  notes: string | null | undefined,
  hotel: string | null | undefined,
): string {
  const value = (notes || '').trim();
  if (!value) return '';
  const key = (hotel || '').trim().toLowerCase();
  const systemLines = ['slnt', 'slnt-group'].includes(key)
    ? SLNT_SYSTEM_LINES
    : ['hotel memories budapest', 'memories budapest', 'memories-budapest'].includes(key)
      ? MEMORIES_SYSTEM_LINES
      : [];
  if (!systemLines.length) return value;

  return value
    .split(/\r?\n/)
    .filter((line) => !systemLines.some((pattern) => pattern.test(line.trim())))
    .join('\n')
    .trim();
}
