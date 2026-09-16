/**
 * Minibar Quick Add's client-side failure boundary. This does not replace a
 * database transaction: concurrent devices still need a future server-side
 * idempotent RPC. Never report a guest override as saved when its update failed
 * or did not affect the expected pending row.
 */
export interface QuickAddExistingUsage {
  id: string;
  source: string | null;
}

export interface QuickAddResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface QuickAddPersistence {
  findExisting: () => Promise<QuickAddResult<QuickAddExistingUsage[]>>;
  confirmGuest: (id: string) => Promise<QuickAddResult<Array<{ id: string }>>>;
  createUsage: () => Promise<QuickAddResult<unknown>>;
}

export type QuickAddOutcome = 'created' | 'guest-confirmed' | 'already-recorded';

export async function persistMinibarQuickAdd(
  persistence: QuickAddPersistence,
  quantity: number,
): Promise<QuickAddOutcome> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new Error('Quantity must be a whole number between 1 and 20.');
  }

  const lookup = await persistence.findExisting();
  if (lookup.error) throw new Error(`Cannot check existing minibar usage: ${lookup.error.message}`);
  if (!lookup.data) throw new Error('Existing minibar usage could not be verified. Please retry.');

  const existing = lookup.data[0];
  if (existing) {
    if (existing.source !== 'guest') return 'already-recorded';

    const confirmation = await persistence.confirmGuest(existing.id);
    if (confirmation.error) throw new Error(`Guest minibar confirmation failed: ${confirmation.error.message}`);
    if (!confirmation.data?.some((row) => row.id === existing.id)) {
      throw new Error('Guest record changed before confirmation. Refresh and try again.');
    }
    return 'guest-confirmed';
  }

  const creation = await persistence.createUsage();
  if (creation.error) throw new Error(`Minibar usage could not be saved: ${creation.error.message}`);
  return 'created';
}
