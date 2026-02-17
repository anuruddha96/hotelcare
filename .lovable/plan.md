

## Fix: Dirty Linen Management Not Showing Data

### Root Cause

The manager account (Ricsi) has `assigned_hotel = 'ottofiori'` (short hotel ID format), while housekeepers have `assigned_hotel = 'Hotel Ottofiori'` (full display name). The component filters housekeepers using the manager's value directly, which means `.eq('assigned_hotel', 'ottofiori')` matches zero housekeepers -- so no data appears.

### Solution

Update `SimplifiedDirtyLinenManagement.tsx` to resolve this mismatch by looking up the hotel's full name from `hotel_configurations` when filtering housekeepers. If the manager's `assigned_hotel` doesn't match housekeepers directly, use the `hotel_name` from `hotel_configurations` as a fallback.

### File to Modify

| File | Change |
|------|--------|
| `src/components/dashboard/SimplifiedDirtyLinenManagement.tsx` | In `fetchData()`, after getting `userHotel`, also query `hotel_configurations` to get the matching `hotel_name`. Then filter housekeepers using both the raw value and the resolved display name. |

### Technical Detail

```typescript
// After getting userHotel from profiles
const userHotel = currentProfile?.assigned_hotel;

// Resolve the display name via hotel_configurations
let resolvedHotelName = userHotel;
if (userHotel) {
  const { data: hotelConfig } = await supabase
    .from('hotel_configurations')
    .select('hotel_name')
    .eq('hotel_id', userHotel)
    .maybeSingle();
  if (hotelConfig?.hotel_name) {
    resolvedHotelName = hotelConfig.hotel_name;
  }
}

// Filter housekeepers using both possible values
if (userHotel) {
  housekeepersQuery = housekeepersQuery.or(
    `assigned_hotel.eq.${userHotel},assigned_hotel.eq.${resolvedHotelName}`
  );
}
```

This ensures the query finds housekeepers regardless of whether their `assigned_hotel` uses the short ID (`ottofiori`) or the full name (`Hotel Ottofiori`).

