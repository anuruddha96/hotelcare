import { describe, expect, it, vi } from 'vitest';
import { persistMinibarQuickAdd, type QuickAddPersistence } from './minibarQuickAdd';

function setup(overrides: Partial<QuickAddPersistence> = {}) {
  const persistence: QuickAddPersistence = {
    findExisting: vi.fn().mockResolvedValue({ data: [], error: null }),
    confirmGuest: vi.fn().mockResolvedValue({ data: [{ id: 'guest-1' }], error: null }),
    createUsage: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
  return persistence;
}

describe('minibar quick add failure boundary', () => {
  it('creates only after an unambiguous successful duplicate lookup', async () => {
    const persistence = setup();
    await expect(persistMinibarQuickAdd(persistence, 2)).resolves.toBe('created');
    expect(persistence.createUsage).toHaveBeenCalledOnce();
  });

  it('fails closed if checking for duplicates fails', async () => {
    const persistence = setup({ findExisting: vi.fn().mockResolvedValue({ data: null, error: { message: 'offline' } }) });
    await expect(persistMinibarQuickAdd(persistence, 1)).rejects.toThrow('offline');
    expect(persistence.createUsage).not.toHaveBeenCalled();
    expect(persistence.confirmGuest).not.toHaveBeenCalled();
  });

  it('fails closed if the duplicate query returns no trustworthy data', async () => {
    const persistence = setup({ findExisting: vi.fn().mockResolvedValue({ data: null, error: null }) });
    await expect(persistMinibarQuickAdd(persistence, 1)).rejects.toThrow('could not be verified');
    expect(persistence.createUsage).not.toHaveBeenCalled();
  });

  it('does not create duplicates when staff usage already exists', async () => {
    const persistence = setup({ findExisting: vi.fn().mockResolvedValue({ data: [{ id: 'staff-1', source: 'reception' }], error: null }) });
    await expect(persistMinibarQuickAdd(persistence, 1)).resolves.toBe('already-recorded');
    expect(persistence.confirmGuest).not.toHaveBeenCalled();
    expect(persistence.createUsage).not.toHaveBeenCalled();
  });

  it('confirms an existing guest row only when the expected row was actually updated', async () => {
    const persistence = setup({ findExisting: vi.fn().mockResolvedValue({ data: [{ id: 'guest-1', source: 'guest' }], error: null }) });
    await expect(persistMinibarQuickAdd(persistence, 1)).resolves.toBe('guest-confirmed');
    expect(persistence.confirmGuest).toHaveBeenCalledWith('guest-1');
    expect(persistence.createUsage).not.toHaveBeenCalled();
  });

  it('does not falsely report success when guest update fails or affects no row', async () => {
    const existing = vi.fn().mockResolvedValue({ data: [{ id: 'guest-1', source: 'guest' }], error: null });
    const rejected = setup({ findExisting: existing, confirmGuest: vi.fn().mockResolvedValue({ data: null, error: { message: 'permission denied' } }) });
    await expect(persistMinibarQuickAdd(rejected, 1)).rejects.toThrow('permission denied');
    expect(rejected.createUsage).not.toHaveBeenCalled();

    const stale = setup({ findExisting: existing, confirmGuest: vi.fn().mockResolvedValue({ data: [], error: null }) });
    await expect(persistMinibarQuickAdd(stale, 1)).rejects.toThrow('changed before confirmation');
    expect(stale.createUsage).not.toHaveBeenCalled();
  });

  it('propagates an insert failure instead of displaying success', async () => {
    const persistence = setup({ createUsage: vi.fn().mockResolvedValue({ data: null, error: { message: 'database unavailable' } }) });
    await expect(persistMinibarQuickAdd(persistence, 2)).rejects.toThrow('database unavailable');
  });

  it.each([0, -1, 1.5, 21, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid quantity %s before any write', async (quantity) => {
    const persistence = setup();
    await expect(persistMinibarQuickAdd(persistence, quantity)).rejects.toThrow('Quantity must');
    expect(persistence.findExisting).not.toHaveBeenCalled();
    expect(persistence.createUsage).not.toHaveBeenCalled();
  });
});
