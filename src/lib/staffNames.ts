// One place that decides how a housekeeper's name is written under a room chip.
//
// Two bugs lived here before: a profile stored as " Svetlana Sobolieva" (with a
// leading space) produced an empty label, so her rooms looked unassigned; and
// long names were cut to seven characters ("Nykipanchuk" -> "Nykipan."), which
// nobody could read. Names are now trimmed and shown in full.

/** Collapse stray whitespace so a name never starts or ends with a space. */
export function cleanName(name: string | null | undefined): string {
  return (name ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Label shown under a room chip: the person's full first name, never
 * truncated. Returns `fallback` when the profile could not be read, so an
 * assigned room never looks unassigned.
 */
export function chipStaffLabel(
  name: string | null | undefined,
  fallback: string | null = null,
): string | null {
  const clean = cleanName(name);
  if (!clean) return fallback;
  return clean.split(" ")[0];
}

/**
 * Name for an assignee id using the staff map, falling back to "Assigned"
 * when the id is known but the profile is not readable.
 */
export function assigneeLabel(
  staffMap: Record<string, string | null | undefined>,
  assignedTo: string | null | undefined,
  fallback = "Assigned",
): string | null {
  if (!assignedTo) return null;
  return chipStaffLabel(staffMap[assignedTo], fallback);
}
