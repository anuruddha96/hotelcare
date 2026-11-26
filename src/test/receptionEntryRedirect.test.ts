import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useReceptionEntryRedirect } from '@/hooks/useReceptionEntryRedirect';
import type { AccessSubject } from '@/lib/accessPolicy';

const entry = {
  ready: true,
  userId: 'reception-user' as string | null,
  profile: { role: 'manager', access_role: 'reception' } as AccessSubject,
  organizationSlug: 'rdhotels',
  pathname: '/rdhotels/guests',
  search: '',
  hash: '',
};
const home = '/rdhotels/reception';

describe('reception session entry', () => {
  it('waits for authenticated profile readiness and opens the room planner', () => {
    const { result, rerender } = renderHook(useReceptionEntryRedirect, { initialProps: { ...entry, ready: false } });
    expect(result.current).toBeNull();
    rerender(entry);
    expect(result.current).toBe(home);
    rerender({ ...entry, pathname: home });
    expect(result.current).toBeNull();
    rerender({ ...entry, pathname: '/rdhotels/reception/reports' });
    expect(result.current).toBeNull();
  });

  it('redirects after a reload on any other workspace page', () => {
    for (const pathname of ['/rdhotels', '/rdhotels/reservations/abc', '/rdhotels/reception/reports', '/rdhotels/reception/breakfast-upload', '/rdhotels/revenue']) {
      const hook = renderHook(useReceptionEntryRedirect, { initialProps: { ...entry, pathname } });
      expect(hook.result.current).toBe(home);
      hook.unmount();
    }
  });

  it('leaves the canonical planner alone and permits normal navigation afterwards', () => {
    const { result, rerender } = renderHook(useReceptionEntryRedirect, { initialProps: { ...entry, pathname: home } });
    expect(result.current).toBeNull();
    rerender({ ...entry, pathname: '/rdhotels', search: '?tab=maintenance' });
    expect(result.current).toBeNull();
  });

  it('clears stale URL state on fresh entry but never intercepts recovery', () => {
    const { result, rerender } = renderHook(useReceptionEntryRedirect, { initialProps: { ...entry, pathname: '/rdhotels/reset-password' } });
    expect(result.current).toBeNull();
    rerender({ ...entry, pathname: home, search: '?view=list', hash: '#old' });
    expect(result.current).toBe(home);
  });

  it('reapplies the default after logout/login with the same account', () => {
    const { result, rerender } = renderHook(useReceptionEntryRedirect, { initialProps: { ...entry, pathname: home } });
    rerender({ ...entry, userId: null, profile: null });
    expect(result.current).toBeNull();
    rerender(entry);
    expect(result.current).toBe(home);
  });

  it('does not redirect any non-reception roles, including ordinary managers', () => {
    for (const role of ['manager', 'admin', 'top_management', 'housekeeping', 'housekeeping_manager', 'maintenance', 'hr', 'control_finance', 'breakfast_staff']) {
      const hook = renderHook(useReceptionEntryRedirect, { initialProps: { ...entry, profile: { role } } });
      expect(hook.result.current).toBeNull();
      hook.unmount();
    }
  });

  it('supports legacy reception roles and the current organization', () => {
    for (const role of ['reception', 'front_office', 'reception_manager']) {
      const hook = renderHook(useReceptionEntryRedirect, { initialProps: { ...entry, profile: { role }, organizationSlug: 'hotelcare-test', pathname: '/hotelcare-test/guests' } });
      expect(hook.result.current).toBe('/hotelcare-test/reception');
      hook.unmount();
    }
  });
});
