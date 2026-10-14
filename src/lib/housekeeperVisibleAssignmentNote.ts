/**
 * Planning/audit breadcrumbs are useful to managers but not housekeeping
 * instructions. Keep them in the assignment record; hide them only in the
 * SLNT housekeeper UI, after the live PMS checkout gate has been evaluated.
 */
const SLNT_SYSTEM_LINES = [
  /^auto[-\s]distributed after full slnt pms sync\.?$/i,
  /^unbooked at planning sync(?:\s*[-–—]\s*revalidate before cleaning)?\.?$/i,
];

export function housekeeperVisibleAssignmentNote(
  notes: string | null | undefined,
  hotel: string | null | undefined,
): string {
  const value = (notes || '').trim();
  if (!value || !['slnt', 'slnt-group'].includes((hotel || '').toLowerCase())) {
    return value;
  }

  return value
    .split(/\r?\n/)
    .filter((line) => !SLNT_SYSTEM_LINES.some((pattern) => pattern.test(line.trim())))
    .join('\n')
    .trim();
}
