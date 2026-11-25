/**
 * Classify a standard, per-category Previo availability change.
 * This never chooses a complimentary upgrade: borrowing a room from another
 * category is a separate, explicit workflow.
 */
export function standardRoomsToSellDecision(
  requested: number,
  current: number | undefined,
  physicalCapacity: number,
):
  | { kind: "invalid"; message: string }
  | { kind: "unchanged" }
  | { kind: "standard"; roomsToSell: number } {
  if (!Number.isInteger(requested) || requested < 0 || requested > 999 ||
      !Number.isInteger(physicalCapacity) || physicalCapacity < 0 ||
      requested > physicalCapacity || current === undefined ||
      !Number.isInteger(current) || current < 0) {
    return { kind: "invalid", message: "Choose a whole number between 0 and the category's physical capacity. Refresh the calendar if availability is missing." };
  }
  if (requested === current) return { kind: "unchanged" };
  return { kind: "standard", roomsToSell: requested };
}
