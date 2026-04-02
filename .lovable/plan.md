

## Plan: Real Username Preview & Standardized Default Passwords

### Problem
1. **Username preview is fake**: The client counts `profiles.nickname ILIKE 'FirstName_%'` to guess the next number, but the server uses `get_next_housekeeper_sequence` (an atomic counter). These diverge over time.
2. **Default password is random**: Server generates `RD` + random hex. User wants `FirstName@XXX` format (e.g., `Petra@021`).

### Changes

**File: `src/components/dashboard/HousekeepingStaffManagement.tsx`**

1. Replace the `checkUsernameAvailability` function: instead of querying `profiles` and counting, call the RPC `get_next_housekeeper_sequence` in **peek mode** — but since the RPC increments the counter, we cannot call it for preview. Instead, query `housekeeper_username_sequence` table directly to read `last_sequence_number` and show `last_sequence_number + 1` as preview.
   ```typescript
   const { data } = await supabase
     .from('housekeeper_username_sequence')
     .select('last_sequence_number')
     .eq('organization_slug', orgSlug)
     .maybeSingle();
   const nextNumber = (data?.last_sequence_number ?? 0) + 1;
   setPreviewUsername(`${firstName}_${String(nextNumber).padStart(3, '0')}`);
   ```

2. Show the default password preview below the username preview: `Password: FirstName@XXX` (when custom password is not enabled).

**File: `supabase/functions/create-housekeeper/index.ts`**

3. Change the default password generation (line 124-126) from random hex to the standardized format:
   ```typescript
   const generatedPassword = (password && String(password).trim().length
     ? String(password).trim()
     : `${firstName}@${String(sequenceNumber).padStart(3, '0')}`);
   ```

### RLS Note
The `housekeeper_username_sequence` table currently only has a service-role policy. We need to add a SELECT policy for authenticated users so managers can read the current sequence number.

**New migration**: Add RLS policy allowing authenticated users to SELECT from `housekeeper_username_sequence`.

### Summary

| File | Changes |
|------|---------|
| `src/components/dashboard/HousekeepingStaffManagement.tsx` | Query real sequence number for preview; show default password preview |
| `supabase/functions/create-housekeeper/index.ts` | Change default password to `FirstName@XXX` format |
| New migration | Add SELECT RLS policy on `housekeeper_username_sequence` for authenticated users |

