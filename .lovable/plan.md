

## Plan: Fix QR URL Structure, Guest "Recorded By" Label, and Housekeeping Tab Truncation

Three issues to address:

---

### Issue 1: "Recorded By" Should Show "Guest (QR Scan)" for Guest Submissions

Currently, when `recorded_by` is NULL (guest submissions), the "Recorded By" column shows "Unknown". It should show something like "Guest (QR Scan)" to clearly indicate it was submitted by a guest scanning the QR code.

| File | Change |
|------|--------|
| `src/components/dashboard/MinibarTrackingView.tsx` | On line 241, change the fallback logic: if `source === 'guest'`, display `'Guest (QR Scan)'` instead of `'Unknown'`. |

---

### Issue 2: QR Code URL Structure

The user wants shorter, branded URLs without "lovable" in them. The current format is:
`https://hotelcare.lovable.app/rdhotels/minibar/{token}`

The user wants something like:
`my.hotelcare.app/RDHotels/Ottofiori/minibar/{id}`

**Reality check**: The published URL is `hotelcare.lovable.app`. To remove "lovable" from the URL, the user needs to set up a custom domain (e.g., `hotelcare.app` or `my.hotelcare.app`). Once that's done, we update the base URL.

**What we can do now**: Restructure the route to include the hotel name in the path for readability:
- New route: `/:organizationSlug/:hotelSlug/minibar/:roomToken`
- QR URL becomes: `https://hotelcare.lovable.app/rdhotels/ottofiori/minibar/{token}`

This makes the URL cleaner and hotel-specific. When a custom domain is added later, the "lovable" part disappears automatically.

| File | Change |
|------|--------|
| `src/App.tsx` | Add route `/:organizationSlug/:hotelSlug/minibar/:roomToken` pointing to `GuestMinibar` (keep old route for backward compatibility) |
| `src/pages/GuestMinibar.tsx` | Accept optional `hotelSlug` param (ignored functionally since `roomToken` is the lookup key, but makes URL prettier) |
| `src/components/dashboard/MinibarQRManagement.tsx` | Update `getBaseUrl()` and URL construction to include hotel slug in the path. Derive hotel slug from hotel name (lowercase, hyphenated). |

---

### Issue 3: "Housekee..." Truncation on Navigation Tabs

The "Housekeeping" tab label is being truncated to "Housekee..." because the `truncate` class was added in the previous fix. The real issue is the container is still too narrow for 5 tabs.

| File | Change |
|------|--------|
| `src/components/dashboard/Dashboard.tsx` | Remove `truncate` class from tab labels (or at least from "Housekeeping"). Increase container width or switch to `auto-cols` / `flex` layout so all tab labels fit without truncation. |

---

### Technical Details

**Recorded By fix** (MinibarTrackingView.tsx, line 241):
```typescript
recorded_by_name: record.profiles?.full_name 
  || ((record as any).source === 'guest' ? 'Guest (QR Scan)' : 'Unknown'),
```

**QR URL construction** (MinibarQRManagement.tsx):
```typescript
// Derive hotel slug from hotel name
const hotelSlug = room.hotel.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
const url = `${getBaseUrl()}/${getOrgSlug()}/${hotelSlug}/minibar/${room.minibar_qr_token}`;
// Result: hotelcare.lovable.app/rdhotels/hotel-ottofiori/minibar/abc123
```

**Tab layout fix** (Dashboard.tsx, line 396):
Replace `grid` layout with `flex` and allow natural sizing so "Housekeeping" displays fully:
```typescript
<TabsList className="flex w-full min-w-[320px] max-w-2xl h-10 sm:h-12">
  <TabsTrigger ... className="flex-1 ...">
```

Note to user: To fully remove "lovable" from QR URLs, you would need to connect a custom domain (like `hotelcare.app`). The URL structure improvement we're making now will carry over seamlessly once a custom domain is configured.

