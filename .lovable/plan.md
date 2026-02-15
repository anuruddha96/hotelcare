

## Plan: Fix PMS Checkout Detection Bug + Manual Check-In for Managers

### Issue 1: PMS Still Not Detecting Checkouts

**Root Cause:** There are two problems:

1. The code fixes from earlier (dynamic column mapping, Excel time handling) have NOT been published to the live site yet. The user is uploading from the published URL (hotelcare.lovable.app), which still runs the OLD code with hardcoded property names like `row.Departure`.

2. Even in the new code, there is a remaining bug on line 607: `if (isCheckout && departureVal)` still uses the raw `departureVal` instead of `departureParsed`. If the Excel departure value is the number `0` (midnight), this check fails because `0` is falsy in JavaScript, causing `checkout_time` to not be saved.

**Fix in `src/components/dashboard/PMSUpload.tsx`:**
- Change line 607 from `if (isCheckout && departureVal)` to `if (isCheckout && departureParsed !== null)` so it correctly handles numeric Excel time values including midnight.

**After this fix, the app must be PUBLISHED for the changes to reach the live site.**

---

### Issue 2: Manual Check-In Dropdown Missing Manager Profiles

**Root Cause:** The database function `get_employees_by_hotel` filters employees with:
```
WHERE p.role IN ('housekeeping', 'reception', 'maintenance', 'marketing', 'control_finance', 'front_office')
```

This explicitly excludes `manager` and `housekeeping_manager` roles, so Francesca Carolina (a manager) never appears in the "Manual Employee Check-In" dropdown.

**Fix:** Update the `get_employees_by_hotel` function via a new SQL migration to include `'manager'` and `'housekeeping_manager'` in the role filter. This applies to both the hotel-specific query and the admin-level query (which currently excludes only `'admin'` but should also show managers).

**Migration SQL:**
```sql
CREATE OR REPLACE FUNCTION public.get_employees_by_hotel()
  -- Same signature, updated role filter to include manager roles
  WHERE p.role IN (
    'housekeeping', 'reception', 'maintenance', 'marketing', 
    'control_finance', 'front_office', 'manager', 'housekeeping_manager'
  )
```

---

### Summary

| File | Change |
|------|--------|
| `src/components/dashboard/PMSUpload.tsx` | Fix line 607: use `departureParsed !== null` instead of raw `departureVal` |
| New SQL migration | Add `manager` and `housekeeping_manager` to `get_employees_by_hotel` role filter |

### Important Note
After these changes are applied, the app **must be Published** for the PMS upload fix to take effect on the live site. The user should then re-upload the PMS file.

