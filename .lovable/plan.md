
## Plan: Guest QR Minibar Self-Service + Reception Role Access

This is a large feature with 4 major parts. Here's the breakdown:

---

### Part 1: Guest-Facing QR Minibar Page (Public, No Login Required)

**New public route**: `/:organizationSlug/minibar/:roomToken`

Each room gets a unique token (UUID stored in the `rooms` table). When a guest scans the QR code, they land on a branded, mobile-friendly page showing the hotel's minibar items. They can tap items to add them to a "cart" and submit their usage -- no login, no pressure, just a friendly nudge to record what they took.

**How it works:**
- The page loads the room token from the URL, looks up the room (and hotel branding from `hotel_configurations`)
- Displays minibar items in a beautiful card grid with prices, grouped by category
- Guest taps items, adjusts quantity, and hits "Confirm" to record usage
- Records are inserted into `room_minibar_usage` with `recorded_by = NULL` (guest source) and a new `source` column set to `'guest'`
- A thank-you screen appears after submission

**Branding**: The page pulls the hotel's logo, colors, and name from `hotel_configurations` to match Hotel Ottofiori or any other property.

---

### Part 2: Unique QR Codes per Room + Admin Download

**Database change**: Add a `minibar_qr_token` column (UUID, unique) to the `rooms` table. Pre-populate existing rooms with tokens via migration.

**QR Code Management** (admin feature in the Housekeeping tab or Minibar settings):
- A new "QR Codes" button/section in the Minibar Tracking page (visible to admins)
- Shows a list of all rooms with their QR codes
- Each QR encodes the URL: `https://hotelcare.lovable.app/{org}/minibar/{roomToken}`
- "Download All QRs" button generates a printable PDF/image grid with room number labels
- Individual QR download per room
- Uses a client-side QR code generation library (we'll use a lightweight inline SVG generator or the `qrcode` npm package)

---

### Part 3: Deduplication Logic (Guest vs Housekeeper vs Reception)

**New column on `room_minibar_usage`**: `source` (text, default `'staff'`)
- Values: `'guest'`, `'staff'`, `'reception'`

**Deduplication rules:**
- When a housekeeper records minibar usage, check if the guest already recorded the same item for the same room on the same day. If so, skip the duplicate (keep the guest's record since they reported first)
- When a guest records usage, check if staff already recorded the same item. If so, skip the duplicate (keep staff's record)
- If neither has recorded it, insert normally
- The "source" badge appears in the Minibar Tracking table so managers can see who reported each usage (Guest / Staff / Reception)
- This validation happens at insert time in the component logic -- not at DB level, to keep it flexible

---

### Part 4: Reception Role Dashboard Access

The `reception` role already exists in the `user_role` enum. Currently, reception users land on the "rooms" tab with limited visibility. We need to expand their access:

**Dashboard changes for reception users:**
- Add a new tab layout for `reception` role in `Dashboard.tsx` with tabs: Tickets, Rooms, Minibar, Lost & Found
- The "Minibar" tab shows `MinibarTrackingView` (read access to see all usage) plus a quick-add form at the top
- The "Lost & Found" tab shows `LostAndFoundManagement` (read-only)
- The "Rooms" tab shows `RoomManagement` (read-only team view)

**Quick-Add for Reception:**
- In the Minibar Tracking view, add a "Record Usage" button (visible to reception, manager, admin roles)
- Opens a simple dialog: search/select room number, pick items from dropdown, set quantity, submit
- Source is set to `'reception'`

**RLS adjustments:**
- `room_minibar_usage` INSERT policy already allows all staff -- reception is covered
- `minibar_items` SELECT policy needs to allow anon access for the guest page (or use a dedicated edge function)
- For the guest page (no auth), we'll use an edge function to handle the insert securely, bypassing RLS with service role

---

### Files to Create

| File | Purpose |
|------|---------|
| `src/pages/GuestMinibar.tsx` | Public guest-facing minibar page with hotel branding |
| `src/components/dashboard/MinibarQRManagement.tsx` | Admin QR code generation and download UI |
| `src/components/dashboard/MinibarQuickAdd.tsx` | Reception/manager quick-add usage dialog |
| `supabase/functions/guest-minibar-submit/index.ts` | Edge function for unauthenticated guest submissions |

### Files to Modify

| File | Changes |
|------|---------|
| `src/App.tsx` | Add public route `/:organizationSlug/minibar/:roomToken` |
| `src/components/dashboard/Dashboard.tsx` | Add reception role tab layout with Minibar and Lost & Found tabs |
| `src/components/dashboard/MinibarTrackingView.tsx` | Add source badge column, quick-add button, reception access |
| `src/components/dashboard/HousekeepingTab.tsx` | Add QR management button to minibar section |
| `supabase/config.toml` | Add `[functions.guest-minibar-submit]` with `verify_jwt = false` |

### Database Migration

```sql
-- Add QR token to rooms
ALTER TABLE rooms ADD COLUMN minibar_qr_token uuid DEFAULT gen_random_uuid() UNIQUE;

-- Backfill existing rooms
UPDATE rooms SET minibar_qr_token = gen_random_uuid() WHERE minibar_qr_token IS NULL;

-- Add source column to track who recorded the usage
ALTER TABLE room_minibar_usage ADD COLUMN source text DEFAULT 'staff';

-- Allow anon SELECT on rooms for QR token lookup (limited columns)
-- This will be handled by the edge function instead (service role)
```

### Technical Details

**Guest Minibar Edge Function** (`guest-minibar-submit`):
- Accepts: `{ roomToken, items: [{ minibar_item_id, quantity }] }`
- Validates the room token exists
- Checks for duplicates (same room + same item + same day)
- Inserts into `room_minibar_usage` with `recorded_by = NULL`, `source = 'guest'`
- Returns success/error

**QR Code Generation:**
- Uses inline SVG QR generation (no external dependency needed -- we can use a small utility function, or add the lightweight `qrcode` package)
- Each QR encodes: `{publishedUrl}/{orgSlug}/minibar/{minibar_qr_token}`
- Download all: renders QR codes to a canvas grid and exports as PNG

**Deduplication in Quick-Add and Housekeeper flow:**
- Before inserting, query `room_minibar_usage` for same `room_id`, `minibar_item_id`, and `usage_date` (same day)
- If exists, show a toast: "This item was already recorded for this room today (by {source})" and skip
- Manager can override if needed

**Reception tab layout:**
```
Tickets | Rooms | Minibar | Lost & Found
```
This gives reception staff exactly the tools they need without exposing housekeeping management, assignments, or admin features.
