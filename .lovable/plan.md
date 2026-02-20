

## Plan: Reception Room Overview, Guest Minibar UI Polish, and Translation Fixes

---

### 1. Remove "Team View" Tab for Reception, Show Hotel Room Overview in "Rooms" Tab

**File: `src/components/dashboard/Dashboard.tsx`**

**Current state**: Reception users see 5 tabs: Tickets, Rooms, Team View, Minibar, Lost & Found. The "Rooms" tab shows `<RoomManagement />` (a room list manager). The "Team View" tab shows `<HousekeepingTab />` which includes the Hotel Room Overview.

**Changes:**

A. **Remove the "Team View" tab** from the reception TabsList (line 433-436).

B. **For reception users, render `<HotelRoomOverview />` inside the "Rooms" TabsContent** instead of (or in addition to) `<RoomManagement />`. This gives receptionists the same at-a-glance room status view that managers see in the Team View, directly in their Rooms tab.

C. The reception TabsList will now have 4 tabs: Tickets, Rooms, Minibar, Lost & Found.

---

### 2. Guest Minibar Page UI Improvements

**File: `src/pages/GuestMinibar.tsx`**

A. **Bigger header logo**: Change the logo from `h-9` to `h-12` (line 345) for more prominence.

B. **Fix bottom gap / footer styling**: The `pb-64` padding on the content area (line 391) creates excess whitespace. Reduce it to `pb-32` when cart is empty. Also increase the footer logo from `h-12` to `h-16` and remove the `opacity-60` to make it more visible.

C. **More attractive styling**: Add subtle background gradients to category section headers, give the welcome section a warm background card, and use slightly larger category header text.

---

### 3. Fix Product Name Translations

**Root cause**: The `translations` field in the `minibar_items` table is empty `{}` for all products. The code already reads `item.translations?.[guestLang]` (line 283) and falls back to `item.name` — so the code is correct, but no translation data exists.

**File: `src/pages/GuestMinibar.tsx`**

The existing code at line 283 already handles this correctly:
```typescript
item.translations?.[guestLang] || item.name
```

Since translations are empty in the database, the admin needs to add them via the Minibar management UI. However, we should ensure the category labels (`getCategoryLabel`) also use the guest translation system properly — which they already do via `gt('snacks')`, `gt('beverages')`, `gt('alcohols')`.

No code change needed for product translations — the infrastructure works, the data just needs to be entered by admins.

---

### 4. Fix "Discover Budapest" Section Translations

**File: `src/pages/GuestMinibar.tsx`**

**Root cause**: The `guest_recommendations` table has no translation columns — `name`, `type`, `description`, `specialty` are all plain text with no multi-language support. The page renders them directly without going through the `gt()` translation function.

**Changes:**

A. **Add translation columns to `guest_recommendations`**: Add a `translations` JSONB column to the table (similar to `minibar_items`). Structure: `{ "de": { "name": "...", "type": "...", "description": "...", "specialty": "..." }, "fr": {...} }`.

B. **Update the GuestMinibar page** to use translated recommendation fields when available:
```typescript
// Instead of: place.name
// Use: place.translations?.[guestLang]?.name || place.name
```

Same for `type`, `description`, and `specialty`.

C. **Update the `loadData` query** to also select the `translations` column from `guest_recommendations`.

---

### 5. Hotel Guide Section Translations

The Hotel Guide sections (About, Services, Important Info, Things to Know, Explore Budapest) already use `gt(contentKey)` which reads from `guestTranslations`. All 13 languages already have translations for these sections in `guest-minibar-translations.ts`. These should already work — if they're not, it may be a language code mismatch issue. Will verify the `gt()` fallback logic is correct.

---

### Technical Summary

| File | Changes |
|------|---------|
| `src/components/dashboard/Dashboard.tsx` | Remove "Team View" tab for reception. Add `<HotelRoomOverview />` to the "Rooms" tab content for reception role. Reduce tabs from 5 to 4. |
| `src/pages/GuestMinibar.tsx` | Bigger header logo (`h-12`). Fix footer gap (`pb-32` when no cart). Larger footer logo (`h-16`). More attractive welcome section. Use translated recommendation fields. |
| `supabase/migrations/` | Add `translations` JSONB column to `guest_recommendations` table. |

