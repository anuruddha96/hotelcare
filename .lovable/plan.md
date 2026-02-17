

## Plan: Minibar Enhancements, Guest Services, and Room Overview Actions

This plan covers 4 feature areas requested by the user.

---

### 1. Promote Brownies / Featured Items in Guest Minibar Page

Add a `is_promoted` boolean and `image_url` text column to the `minibar_items` table. Promoted items appear in a highlighted "Featured" section at the top of the guest minibar page, with product images if available.

**Database changes:**
- Add column `image_url TEXT` to `minibar_items`
- Add column `is_promoted BOOLEAN DEFAULT false` to `minibar_items`

**Files to modify:**

| File | Change |
|------|--------|
| `src/pages/GuestMinibar.tsx` | Add a "Featured" section at the top showing promoted items with images, highlighted styling (gold border, star badge). Regular categories follow below. |
| `src/components/dashboard/MinimBarManagement.tsx` | Add `image_url` upload field and `is_promoted` toggle to the add/edit form. Show image thumbnail in item list. Use Supabase storage bucket `minibar-images` for uploads. |

---

### 2. Admin Image Upload for Minibar Products

Admins can upload product photos when creating/editing minibar items. Images are stored in a Supabase storage bucket (`minibar-images`) and displayed both in management and on the guest page.

**Database changes:**
- Storage bucket `minibar-images` (public) -- needs to be created via migration or manually
- The `image_url` column added above stores the path

**Files to modify:**

| File | Change |
|------|--------|
| `src/components/dashboard/MinimBarManagement.tsx` | Add image upload input in the form. On submit, upload to `minibar-images` bucket, save signed/public URL in `image_url`. Display thumbnail next to item name in the list. |

---

### 3. Guest Services / Local Recommendations Section

Add a "Discover" section to the guest minibar page with curated local recommendations. This is hardcoded content (not database-driven for now) that managers can later manage.

**Recommended places to include:**
- **Treats and Stuff Cafe** -- Cozy artisan bakery and cafe, known for brownies and specialty coffee
- **Mika Tivadar Secret Museum** -- Hidden gem museum dedicated to the art of Tivadar Csontvary Kosztka
- Additional suggestions: Szimpla Kert (ruin bar), Hungarian Parliament, Fisherman's Bastion, Great Market Hall, thermal baths

**Files to modify:**

| File | Change |
|------|--------|
| `src/pages/GuestMinibar.tsx` | Add a "Discover Budapest" section below the minibar items with cards for local attractions. Each card shows name, type (cafe/museum/attraction), short description, and a map link. Styled to match the warm amber theme. |

---

### 4. Room Overview: Mark Clean and Switch Room Type

Currently, clicking a room in Hotel Room Overview only opens a size/category editor. Enhance the room click dialog to also allow managers to:

- **Mark checkout rooms as clean** (same as "Mark Ready" in Pending Rooms dialog -- sets `ready_to_clean = true` on the assignment)
- **Switch room type** between checkout and daily (updates `assignment_type` on the room's assignment for today, and toggles `is_checkout_room` on the room)

**Files to modify:**

| File | Change |
|------|--------|
| `src/components/dashboard/HotelRoomOverview.tsx` | Expand the room edit dialog (lines 525-576) to include: (1) A "Mark as Clean" button for checkout rooms that sets `ready_to_clean = true` on the assignment, (2) A "Switch to Daily" / "Switch to Checkout" button that calls `changeAssignmentType()` similar to the `PendingRoomsDialog` logic, updating both `room_assignments.assignment_type` and `rooms.is_checkout_room`. Refresh data after actions. |

---

### Technical Details

**Migration SQL (new columns):**
```sql
ALTER TABLE minibar_items ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE minibar_items ADD COLUMN IF NOT EXISTS is_promoted BOOLEAN DEFAULT false;
```

**Storage bucket:**
A new `minibar-images` public bucket will be created for product photos.

**Guest Minibar Featured Section (GuestMinibar.tsx):**
```typescript
// Filter promoted items
const promotedItems = items.filter(i => (i as any).is_promoted);

// Render featured section at top with gold styling
{promotedItems.length > 0 && (
  <div className="space-y-3">
    <h3 className="font-semibold text-amber-900 flex items-center gap-2">
      <Star /> Featured
    </h3>
    {promotedItems.map(item => (
      // Card with image, gold border, prominent display
    ))}
  </div>
)}
```

**Room Overview Dialog Enhancement (HotelRoomOverview.tsx):**
```typescript
// In the room edit dialog, add action buttons:
const todayAssignment = assignmentMap.get(selectedRoom.id);

// Mark Ready button (for checkout rooms not yet ready)
{todayAssignment?.assignment_type === 'checkout_cleaning' && (
  <Button onClick={() => markReadyToClean(todayAssignment)}>
    Mark as Ready to Clean
  </Button>
)}

// Switch type button
<Button onClick={() => switchRoomType(selectedRoom, todayAssignment)}>
  {todayAssignment?.assignment_type === 'checkout_cleaning' 
    ? 'Switch to Daily' : 'Switch to Checkout'}
</Button>
```

**Guest Services Section (GuestMinibar.tsx):**
Static data array with local recommendations, rendered as attractive cards with icons for category, location links, and brief descriptions. This section appears below the minibar items and above the cart footer.

---

### Summary of All Changes

| File | Changes |
|------|---------|
| Database migration | Add `image_url` and `is_promoted` columns to `minibar_items` |
| Storage | Create `minibar-images` bucket |
| `src/pages/GuestMinibar.tsx` | Featured items section at top, product images, guest services "Discover" section |
| `src/components/dashboard/MinimBarManagement.tsx` | Image upload field, promoted toggle in form, thumbnail display |
| `src/components/dashboard/HotelRoomOverview.tsx` | Room dialog: Mark Ready, Switch checkout/daily type buttons |

