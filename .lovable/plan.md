

## Plan: Guest Minibar UI Overhaul, Multi-language Support, Cart UX, Reception Fix, and Admin Features

This plan covers 7 feature areas.

---

### 1. Hide Early Sign-Out Approvals for Reception Users

**Root Cause**: `HousekeepingManagerView.tsx` (line 522-527) renders two internal tabs -- "Team View" and "Early Sign-Out Approvals" -- for all users. Reception users see both even though they should only see Team View.

**Fix**: Pass the user role to `HousekeepingManagerView` (or read it via `useAuth`) and conditionally hide the "Early Sign-Out Approvals" tab for reception users.

| File | Change |
|------|--------|
| `src/components/dashboard/HousekeepingManagerView.tsx` | Import `useAuth`, check if role is `reception`. If so, hide the `TabsList` entirely and only render the "team" content directly (no tabs). Otherwise show both tabs as before. |

---

### 2. Add Custom Minibar Logo Per Hotel (Admin Setting)

The `hotel_configurations` table already has `custom_logo_url`. The guest minibar page already reads it. However, admins need a way to upload/set a minibar-specific logo per hotel. We'll add a "Hotel Minibar Logo" upload field in the Minibar Tracking page settings area.

**Database change**: Add `minibar_logo_url TEXT` column to `hotel_configurations` so hotels can have a separate minibar logo distinct from the main app logo.

| File | Change |
|------|--------|
| Database migration | Add `minibar_logo_url` column to `hotel_configurations` |
| `src/components/dashboard/MinibarTrackingView.tsx` | Add a "Minibar Branding" section (visible to admins/managers) with an image upload for the hotel minibar logo |
| `src/pages/GuestMinibar.tsx` | Prefer `minibar_logo_url` over `custom_logo_url` when rendering the header logo |

---

### 3. Improve Guest Minibar UI

Redesign the guest page for a more polished, premium hotel experience:

- Personalized welcome: "Welcome to Hotel Ottofiori" using the hotel name from branding
- Better typography and spacing
- Refined card designs with subtle shadows
- Footer with hotel branding and "Powered by HotelCare" text
- Language switcher in the header

| File | Change |
|------|--------|
| `src/pages/GuestMinibar.tsx` | Complete UI refresh: personalized welcome using `branding.hotel_name`, improved card styling, add footer section at the bottom with hotel logo and powered-by text |

---

### 4. Multi-language Support for Guest Minibar Page

Add a language switcher to the guest minibar page. Since this is a public page (no auth), we'll use a self-contained translation system with a `useState` for language selection. All static text (welcome, categories, buttons, discover section headers) will be translated. Product names come from the database and won't be translated.

**Supported languages**: English, German, French, Italian, Spanish, Portuguese, Hungarian, Czech, Polish, Dutch, Korean, Chinese (Simplified), Hindi

| File | Change |
|------|--------|
| `src/pages/GuestMinibar.tsx` | Add a `guestTranslations` object with all static strings in all languages. Add a language selector dropdown in the header. Wrap all static text with a `gt()` helper function that reads from the translations object. Store language preference in `localStorage`. |

**Translation keys needed:**
- `welcome` ("Welcome to your Minibar")
- `welcomeDesc` ("Enjoyed something from the minibar?...")
- `featured` ("Featured")
- `discover` ("Discover Budapest")
- `discoverDesc` ("Explore the best of Budapest...")
- `confirmUsage` ("Confirm Usage")
- `recording` ("Recording...")
- `items` ("items")
- `noPayment` ("This simply records what you've enjoyed...")
- `thankYou` / `recorded` / `enjoyStay` / `recordMore`
- `invalidQR` / `invalidDesc`
- `map` ("Map")
- `error` / `dismiss`
- Category labels: `snacks`, `beverages`, `alcohols`

---

### 5. Enhanced Cart Display with Item Details

Currently the sticky cart footer only shows total count and price. Enhance it to show individual cart items with names, quantities, and per-item prices in a collapsible section.

| File | Change |
|------|--------|
| `src/pages/GuestMinibar.tsx` | Add an expandable cart details section above the confirm button. When expanded, shows each cart item with name, quantity (with +/- controls), and line total. Collapsed by default, tap to expand. |

---

### 6. Add Levante Budapest and Mitico Budapest to Discover Listings

Insert two new recommendations into the `guest_recommendations` database table.

| Change | Details |
|--------|---------|
| Database migration | Insert `Levante Budapest` and `Mitico Budapest` into `guest_recommendations` with appropriate descriptions, types, icons, and map URLs |

---

### 7. Add Footer to Guest Minibar Page

Add a branded footer at the bottom of the guest minibar page showing:
- Hotel logo (if available)
- Hotel name
- "Powered by HotelCare" text
- A subtle divider

| File | Change |
|------|--------|
| `src/pages/GuestMinibar.tsx` | Add a footer section after the Discover Budapest section, before the sticky cart. Shows hotel logo, hotel name, and powered-by attribution. |

---

### Technical Details

**Language switcher implementation (GuestMinibar.tsx):**
```typescript
const GUEST_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr', name: 'Francais', flag: '🇫🇷' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'es', name: 'Espanol', flag: '🇪🇸' },
  { code: 'pt', name: 'Portugues', flag: '🇵🇹' },
  { code: 'hu', name: 'Magyar', flag: '🇭🇺' },
  { code: 'cs', name: 'Cestina', flag: '🇨🇿' },
  { code: 'pl', name: 'Polski', flag: '🇵🇱' },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'hi', name: 'हिन्दी', flag: '🇮🇳' },
];

const [guestLang, setGuestLang] = useState(() => 
  localStorage.getItem('guest_minibar_lang') || 'en'
);

const gt = (key: string) => guestTranslations[guestLang]?.[key] || guestTranslations['en'][key];
```

**Reception early-signout fix (HousekeepingManagerView.tsx):**
```typescript
const { user } = useAuth();
const userRole = user?.role || '';
const isReception = userRole === 'reception';

// In the render:
{isReception ? (
  // Render team content directly without tabs
  <div className="space-y-6">...</div>
) : (
  <Tabs defaultValue="team">
    <TabsList>...</TabsList>
    ...
  </Tabs>
)}
```

**Expandable cart section:**
```typescript
const [cartExpanded, setCartExpanded] = useState(false);

// In sticky footer:
{cartExpanded && (
  <div className="max-h-40 overflow-y-auto space-y-1 border-b pb-2 mb-2">
    {cart.map(item => (
      <div className="flex justify-between text-sm">
        <span>{item.name} x{item.quantity}</span>
        <span>EUR {(item.price * item.quantity).toFixed(2)}</span>
      </div>
    ))}
  </div>
)}
```

**New recommendations seed SQL:**
```sql
INSERT INTO guest_recommendations (name, type, description, specialty, map_url, icon, sort_order)
VALUES
  ('Levante Budapest', 'Restaurant', 'Modern Mediterranean cuisine...', 'Mediterranean dining', 'https://maps.google.com/...', '🍽️', 7),
  ('Mitico Budapest', 'Restaurant', 'Italian fine dining...', 'Italian cuisine', 'https://maps.google.com/...', '🍝', 8);
```

---

### Summary of All Changes

| Area | Changes |
|------|---------|
| Database migration | Add `minibar_logo_url` to `hotel_configurations`; Insert Levante + Mitico into `guest_recommendations` |
| `src/pages/GuestMinibar.tsx` | UI overhaul, multi-language support (13 languages), language switcher, expandable cart with item details, footer with branding, personalized welcome |
| `src/components/dashboard/HousekeepingManagerView.tsx` | Hide Early Sign-Out tab for reception users |
| `src/components/dashboard/MinibarTrackingView.tsx` | Add minibar logo upload for admins |

