

## Plan: Fix Minibar Image Display, Add Category Sorting, and Discover Listings Management

Three issues to address:

---

### 1. Fix: Brownie Image Not Showing on Guest Page (Bug)

**Root Cause**: In `GuestMinibar.tsx` line 125, the query only selects `'id, name, category, price'`. The `image_url` and `is_promoted` columns are never fetched from the database, so they're always undefined on the guest page -- even though admins uploaded images successfully.

**Fix**: Update the select to include all needed columns.

| File | Change |
|------|--------|
| `src/pages/GuestMinibar.tsx` | Line 125: Change `.select('id, name, category, price')` to `.select('id, name, category, price, image_url, is_promoted')` |

---

### 2. Admin Category Sort Order for Guest Minibar

Currently categories are sorted alphabetically. Add a `category_sort_order` column to `minibar_items` (or a dedicated `minibar_categories` table) so admins can control the display order of categories (e.g., Snacks first, then Beverages, then Alcohol).

**Approach**: Add a `display_order` integer column to `minibar_items` for item-level sorting within categories, and create a new `minibar_category_order` table to store the category display order. Add a simple up/down reorder UI in the admin `MinimBarManagement` dialog.

**Database changes**:
- Add `display_order INTEGER DEFAULT 0` column to `minibar_items`
- Create table `minibar_category_order` with columns: `id UUID`, `category TEXT UNIQUE`, `sort_order INTEGER DEFAULT 0`
- Seed default entries for existing categories

| File | Change |
|------|--------|
| Database migration | Add `display_order` to `minibar_items`, create `minibar_category_order` table |
| `src/components/dashboard/MinimBarManagement.tsx` | Add a "Category Order" section with up/down arrow buttons to reorder categories |
| `src/pages/GuestMinibar.tsx` | Fetch category order from `minibar_category_order` and sort categories accordingly; sort items within categories by `display_order` |

---

### 3. Discover Budapest Listings - Admin Sortable (Drag & Drop)

Currently the "Discover Budapest" recommendations are hardcoded in `GuestMinibar.tsx`. To allow admins to sort them, move the data to a database table and add a drag-and-drop management UI.

**Database changes**:
- Create table `guest_recommendations` with columns: `id UUID`, `name TEXT`, `type TEXT`, `description TEXT`, `specialty TEXT`, `map_url TEXT`, `icon TEXT`, `sort_order INTEGER DEFAULT 0`, `is_active BOOLEAN DEFAULT true`, `created_at TIMESTAMPTZ`
- Seed with the current 6 hardcoded recommendations
- Add RLS policies (public read for active items, admin/manager write)

| File | Change |
|------|--------|
| Database migration | Create `guest_recommendations` table with seed data |
| `src/pages/GuestMinibar.tsx` | Fetch recommendations from `guest_recommendations` table instead of hardcoded array, ordered by `sort_order` |
| `src/components/dashboard/MinimBarManagement.tsx` | Add a "Guest Recommendations" section with drag-and-drop reordering (using simple up/down buttons since we don't have a DnD library), plus add/edit/delete for recommendations |

---

### Technical Details

**Guest page query fix** (line 125):
```typescript
const { data: minibarItems } = await supabase
  .from('minibar_items')
  .select('id, name, category, price, image_url, is_promoted')
  .eq('is_active', true)
  .order('category')
  .order('name');
```

**Category order table**:
```sql
CREATE TABLE minibar_category_order (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT UNIQUE NOT NULL,
  sort_order INTEGER DEFAULT 0
);
INSERT INTO minibar_category_order (category, sort_order) VALUES
  ('beverage', 1), ('snack', 2), ('alcohol', 3);
```

**Guest recommendations table**:
```sql
CREATE TABLE guest_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  specialty TEXT,
  map_url TEXT,
  icon TEXT DEFAULT '📍',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- Seed current hardcoded data
-- RLS: public SELECT for active, admin/manager INSERT/UPDATE/DELETE
```

**Sorting UI**: Since the project doesn't include a drag-and-drop library, sorting will use simple up/down arrow buttons for both categories and recommendations. This keeps things lightweight and avoids adding new dependencies.

---

### Summary of All Changes

| File | Changes |
|------|---------|
| Database migration | Add `display_order` to `minibar_items`, create `minibar_category_order` and `guest_recommendations` tables with seed data and RLS |
| `src/pages/GuestMinibar.tsx` | Fix select query to include `image_url` and `is_promoted`; fetch category order and recommendations from DB |
| `src/components/dashboard/MinimBarManagement.tsx` | Add category reorder UI and guest recommendations management section |

