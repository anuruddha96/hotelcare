

## Plan: Fix Hotel Selection Screen Not Loading on First Attempt

### Root Cause

The `TenantProvider` runs `fetchTenantData()` immediately on mount (triggered by `organizationSlug` dependency). This calls `get_user_organization_hotels` RPC which requires an authenticated session. On the very first page load, the Supabase auth session is still being established asynchronously. The RPC call fires before the session is ready, returns empty/error results, and `TenantProvider` sets `loading: false` with zero hotels. When auth finishes moments later, `TenantProvider` never re-fetches.

On refresh, the session is already cached in localStorage, so it's available immediately and the fetch succeeds.

### Fix

Make `TenantProvider` aware of auth state by consuming `useAuth()` and re-fetching when the user becomes available.

### Changes

**File: `src/contexts/TenantContext.tsx`**

1. Import and use `useAuth` to get the current `user` and `loading` state
2. Add `user?.id` to the `useEffect` dependency array so `fetchTenantData` re-runs when auth completes
3. Skip fetching while auth is still loading (return early)
4. This ensures the RPC call only fires once a valid session exists

```typescript
// Before (runs once on mount, auth may not be ready)
useEffect(() => {
  fetchTenantData();
}, [organizationSlug]);

// After (waits for auth, re-runs when user arrives)
const { user, loading: authLoading } = useAuth();

useEffect(() => {
  if (authLoading) return;        // wait for auth to finish
  if (!user) {                    // no user = no hotels to fetch
    setHotels([]);
    setLoading(false);
    return;
  }
  fetchTenantData();
}, [organizationSlug, user?.id, authLoading]);
```

### Files to modify

| File | Changes |
|------|---------|
| `src/contexts/TenantContext.tsx` | Add auth awareness: import `useAuth`, gate fetch on auth readiness, add `user?.id` dependency |

This is a minimal, targeted fix. No other files need changes.
