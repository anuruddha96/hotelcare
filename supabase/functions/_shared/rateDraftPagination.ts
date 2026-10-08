// A read of active rate drafts must not silently stop at PostgREST's default
// 1,000-row response limit. Callers MUST keep a stable ordering and MUST
// finish collecting pages before mutating any draft statuses.
export type ActiveRateDraftRef = {
  id: string;
  stay_date: string;
  room_type_name: string;
  occupancy: number;
};

export type RateDraftPageResult = {
  data: ActiveRateDraftRef[] | null;
  error: { message: string } | null;
};

export const rateDraftCellKey = (draft: Pick<ActiveRateDraftRef, "stay_date" | "room_type_name" | "occupancy">) =>
  `${draft.stay_date}|${draft.room_type_name}|${draft.occupancy}`;

export async function findDraftsToSupersede(
  fetchPage: (from: number, to: number) => Promise<RateDraftPageResult>,
  incomingKeys: ReadonlySet<string>,
  pageSize = 500,
): Promise<string[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("Invalid active-draft page size");
  }
  const ids: string[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await fetchPage(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    for (const draft of page) {
      if (incomingKeys.has(rateDraftCellKey(draft))) ids.push(draft.id);
    }
    if (page.length < pageSize) return ids;
  }
}
