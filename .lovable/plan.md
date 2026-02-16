

## Plan: Hotel Selection Screen for Managers and Admins After Login

### Problem
Managers and admins work across multiple hotels in the same organization. Currently, switching hotels requires finding the small dropdown in the header. The user wants a dedicated hotel selection step after login.

### Solution
Add a **Hotel Selection Screen** that appears after login for managers and admins, allowing them to pick which hotel they want to work in. The screen shows only hotels from their organization.

### How It Works

1. **After login**, if the user is a manager or admin, check if they need to select a hotel
2. Show a full-screen hotel selection card with all organization hotels listed as clickable cards
3. Once a hotel is selected, update `assigned_hotel` in the profile and proceed to the dashboard
4. The existing **HotelSwitcher** dropdown in the header remains available for switching hotels mid-session without logging out

### Changes

**New file: `src/components/dashboard/HotelSelectionScreen.tsx`**
- Full-screen component with hotel cards showing each hotel in the user's organization
- Fetches hotels from `hotel_configurations` via the TenantContext
- On selection, updates `profiles.assigned_hotel` and navigates to dashboard
- Shows a "Continue with current hotel" option if they already have one assigned
- Only shows hotels from the same organization (already filtered by TenantContext)

**Modified file: `src/pages/Index.tsx`**
- After auth check, add a condition: if user role is `admin`, `manager`, or `housekeeping_manager` AND they have no `assigned_hotel` set, show the `HotelSelectionScreen` instead of the Dashboard
- Users with an assigned hotel go straight to the dashboard as before
- A "Show hotel picker on login" behavior: store a flag in sessionStorage so the picker shows once per login session for managers/admins, giving them the chance to switch before working

**No changes to:**
- Hotel Ottofiori data or logic
- HotelSwitcher component (still available in header for mid-session switching)
- Auth flow or login page
- Any other hotel's configuration

### Technical Details

```text
Login Flow for Managers/Admins:
  Auth Page --> Login Success --> Index.tsx
    --> Is manager/admin? 
      --> Yes: Has sessionStorage "hotel_selected" flag?
        --> No: Show HotelSelectionScreen
          --> User picks hotel --> Update profiles.assigned_hotel 
              --> Set sessionStorage flag --> Show Dashboard
        --> Yes: Show Dashboard directly
      --> No (housekeeping, etc): Show Dashboard directly
```

The sessionStorage flag ensures the picker shows once per browser session (clears on tab close), so managers see it each time they open the app but not on every page refresh.

