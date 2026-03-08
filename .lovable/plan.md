

## Plan: Make PMS Navigation Visible on Main Dashboard + Continue Phase 1

### Problem
The PMSNavigation bar exists but is only rendered on individual PMS pages (FrontDesk, Reservations, etc.). The main dashboard (Index.tsx) doesn't show it, so admins/managers have no way to navigate to the new PMS modules.

### Changes

#### 1. Add PMSNavigation to Index.tsx
Show the PMS navigation bar below the Header on the main dashboard for roles that have PMS access (admin, manager, reception, front_office, housekeeping_manager, top_management). The PMSNavigation component already handles role filtering internally.

**File**: `src/pages/Index.tsx` — Add `<PMSNavigation />` between `<Header />` and `<Dashboard />`

#### 2. Fix Supabase Types
The new tables (guests, reservations, rate_plans, channels, etc.) were created via migration but the TypeScript types in `src/integrations/supabase/types.ts` need to be regenerated/updated to include the new tables so queries compile correctly.

**File**: `src/integrations/supabase/types.ts` — Add type definitions for `guests`, `reservations`, `reservation_room_assignments`, `rate_plans`, `rate_calendar`, `channels`, `channel_rate_mappings`, `guest_folios`

#### 3. Enhance PMS Pages with Better Data Fetching
The existing PMS pages (FrontDesk, Reservations, Guests, ChannelManager) were created with basic structure. Ensure they properly query the new tables and handle empty states gracefully.

#### 4. Add Reservation Detail and Guest Detail Pages
Complete the detail pages (`ReservationDetail.tsx`, `GuestDetail.tsx`) with proper data display, edit capabilities, and navigation back to list views.

### Files to Edit
| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Add PMSNavigation below Header |
| `src/integrations/supabase/types.ts` | Add type definitions for all new PMS tables |
| `src/pages/FrontDesk.tsx` | Ensure queries reference correct table/column names |
| `src/pages/Reservations.tsx` | Ensure queries work with new types |
| `src/pages/Guests.tsx` | Ensure queries work with new types |
| `src/pages/GuestDetail.tsx` | Complete detail view |
| `src/pages/ReservationDetail.tsx` | Complete detail view |
| `src/pages/ChannelManager.tsx` | Ensure queries work with new types |

