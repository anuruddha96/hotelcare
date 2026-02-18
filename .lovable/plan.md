
## Plan: Fix Minibar Logo Upload, Redesign Guest Minibar UI, and Add Hotel Information Pages

---

### 1. Fix: Minibar Logo Upload Not Working

**Root Cause**: The `hotel-assets` storage bucket does not exist. The upload code in `MinibarTrackingView.tsx` (line 111-113) attempts to upload to `supabase.storage.from('hotel-assets')`, but no migration ever created this bucket.

**Fix**: Create a database migration to add the `hotel-assets` storage bucket with public access and appropriate RLS policies.

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('hotel-assets', 'hotel-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admins can upload hotel assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'hotel-assets' AND ...admin check...);

CREATE POLICY "Anyone can view hotel assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'hotel-assets');
```

| File | Change |
|------|--------|
| New database migration | Create `hotel-assets` bucket with RLS policies |

---

### 2. Redesign Guest Minibar Page (Wolt-Inspired UI)

Completely rework `GuestMinibar.tsx` to match a Wolt-style product listing:

**Product Cards (Wolt-style)**:
- Each item: product name (bold) on the left, larger image (80x80 rounded) on the right
- Price displayed below the name in amber/accent color
- Promoted items show a "Popular" badge
- When item is in cart: show -/count/+ controls replacing the + button
- Clean white background, subtle separator between items

**Cart Footer Improvements**:
- Always show item breakdown with prices (not hidden by default)
- Each line: item name, quantity, line total
- Subtotal line
- Add a polite VAT/tax notice: "All prices include VAT and taxes"
- Add payment info: "Payment by card (debit/credit) at reception during checkout"

**Welcome Section**:
- Personalized "Welcome to Hotel Ottofiori" header
- Subtitle about recording minibar usage

| File | Change |
|------|--------|
| `src/pages/GuestMinibar.tsx` | Complete UI redesign of product cards, cart footer, and layout |

---

### 3. Add Hotel Information Pages (from Guest Booklet)

Add navigational sections to the guest minibar page for hotel information extracted from the Ottofiori Guest Booklet. These will be collapsible accordion sections placed below the minibar items but above the Discover section, keeping minibar as the primary focus.

**Sections to add** (as expandable accordions):
- **About the Hotel** - WiFi info, welcome message, amenities overview
- **Services** - Daily cleaning, towel replacement, bed linen, breakfast, parking, etc.
- **Important Information** - Checkout time, smoking policy, room security, emergency info
- **Things to Know** - Currency tips, taxi services, service charges, safety tips
- **Explore Budapest** - Danube cruise, Parliament, thermal baths, nightlife, tram line 2

**Implementation**: Add these as a collapsible "Hotel Guide" section using simple show/hide toggles. All text will be translatable via the existing `gt()` system -- add new translation keys for each section.

| File | Change |
|------|--------|
| `src/pages/GuestMinibar.tsx` | Add collapsible hotel information sections between minibar items and Discover section |
| `src/lib/guest-minibar-translations.ts` | Add translation keys for hotel info sections, VAT notice, payment info across all 13 languages |

---

### 4. Translation Updates

Add new translation keys to all 13 languages:

- `vatIncluded`: "All prices include VAT and taxes"
- `paymentInfo`: "Payment by card (debit/credit) at reception during checkout"
- `hotelGuide`: "Hotel Guide"
- `aboutHotel`: "About the Hotel"
- `services`: "Services"
- `importantInfo`: "Important Information"
- `thingsToKnow`: "Things to Know"
- `exploreBudapest`: "Explore Budapest"
- `popular`: "Popular"
- Various hotel info content strings

| File | Change |
|------|--------|
| `src/lib/guest-minibar-translations.ts` | Add ~15 new keys across all 13 languages |

---

### Technical Details

**Storage bucket migration:**
```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('hotel-assets', 'hotel-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admins and managers can upload hotel assets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'hotel-assets'
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Anyone can view hotel assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'hotel-assets');
```

**Wolt-style item card layout:**
```tsx
<div className="flex items-center gap-4 py-4 border-b border-stone-100">
  <div className="flex-1 min-w-0">
    <p className="font-semibold text-stone-800">{item.name}</p>
    <p className="text-sm text-amber-600 font-medium mt-0.5">
      EUR {item.price.toFixed(2)}
    </p>
    {item.is_promoted && (
      <Badge className="bg-amber-100 text-amber-800 text-[10px] mt-1">
        Popular
      </Badge>
    )}
  </div>
  {item.image_url && (
    <img src={item.image_url} alt={item.name}
      className="w-20 h-20 rounded-xl object-cover flex-shrink-0" />
  )}
  {/* +/- controls on the right */}
</div>
```

**Hotel info as collapsible sections:**
```tsx
const [openSection, setOpenSection] = useState<string | null>(null);

<div className="space-y-2">
  <button onClick={() => toggle('about')} className="w-full flex justify-between...">
    <span>About the Hotel</span>
    <ChevronDown />
  </button>
  {openSection === 'about' && (
    <div className="text-sm text-stone-600 space-y-2 px-4 pb-3">
      <p>WiFi: OTTOFIORI (Open Network)</p>
      <p>Free coffee & tea in every room</p>
      ...
    </div>
  )}
</div>
```

---

### Summary of All Changes

| Area | Changes |
|------|---------|
| Database migration | Create `hotel-assets` storage bucket with RLS policies |
| `src/pages/GuestMinibar.tsx` | Wolt-inspired UI redesign: larger product images, price-visible cart breakdown, VAT/payment info, collapsible hotel information sections |
| `src/lib/guest-minibar-translations.ts` | Add ~15 new translation keys (VAT, payment, hotel guide sections, "Popular" badge) across all 13 languages |
