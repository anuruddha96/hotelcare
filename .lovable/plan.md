

## Plan: Comprehensive Translation Coverage Across All Pages

### Problem
Many pages and components contain hardcoded English strings instead of using the `t()` translation function. This affects:
- **Auth page** (~40 hardcoded strings: labels, placeholders, toast messages, button text)
- **Front Desk** (~15 strings: stats labels, section titles, empty states, buttons)
- **Reservations** (~20 strings: table headers, status labels, filters, buttons)
- **Guests** (~20 strings: table headers, form labels, dialog text, empty states)
- **Guest Detail** (~15 strings: card titles, field labels, empty states)
- **Reservation Detail** (~25 strings: card titles, field labels, action buttons, folio section)
- **Channel Manager** (~20 strings: tab labels, section titles, buttons, placeholder text)
- **CheckIn/CheckOut Dialogs** (~10 strings each: titles, labels, buttons, toasts)
- **CreateReservationDialog** (~15 strings: labels, placeholders, source options, buttons)
- **PMSNavigation** (~5 strings: nav item labels)
- **NotFound page** (~3 strings)
- **GuestSearchSelect** (labels/placeholders)

### Solution
1. **Add ~200 new translation keys** to `src/hooks/useTranslation.tsx` covering all PMS, auth, and utility strings — in all 5 languages (en, hu, mn, es, vi)
2. **Update all affected pages/components** to use `t()` instead of hardcoded strings

### Translation Keys to Add (grouped by area)

**Auth** (`auth.*`): `emailOrUsername`, `password`, `enterEmail`, `enterPassword`, `forgotPassword`, `resetPassword`, `sendVerificationCode`, `sendResetLink`, `sendSMSCode`, `sendLoginLink`, `sending`, `verificationCode`, `newPassword`, `enterNewPassword`, `resetting`, `back`, `welcomeBack`, `accountCreated`, `passwordResetSent`, `loginLinkSent`, `otpSent`, `smsCodeSent`, `resetSuccess`, `invalidOtp`, `passwordTooShort`, `hotelManagement`, `manageOperations`, `emailOTP`, `smsOTP`, `emailLink`, `loginLink`, `enterVerificationCode`, `codeSentTo`, `phoneNumber`, `enterPhone`

**PMS / Front Desk** (`pms.*`): `frontDesk`, `reservations`, `guests`, `channelManager`, `operations`, `arrivals`, `departures`, `inHouse`, `available`, `todaysArrivals`, `todaysDepartures`, `inHouseGuests`, `noArrivalsToday`, `noDeparturesToday`, `noGuestsInHouse`, `checkIn`, `checkOut`, `notes`, `searchGuestReservation`

**Reservations** (`pms.reservations.*`): `title`, `newReservation`, `reservationNumber`, `guest`, `checkInDate`, `checkOutDate`, `nights`, `status`, `source`, `amount`, `loadingReservations`, `noReservationsFound`, `allStatus`, `pending`, `confirmed`, `checkedIn`, `checkedOut`, `cancelled`, `noShow`, `search`, `createReservation`, `creating`

**Guests** (`pms.guests.*`): `directory`, `addGuest`, `searchGuests`, `name`, `email`, `phone`, `nationality`, `vip`, `company`, `noGuestsFound`, `addNewGuest`, `firstName`, `lastName`, `idType`, `idNumber`, `createGuest`, `guestCreated`, `firstLastRequired`, `failedToCreate`, `noEmail`, `noPhone`

**Guest Detail** (`pms.guestDetail.*`): `personalInfo`, `businessInfo`, `stayHistory`, `dateOfBirth`, `idDocument`, `address`, `ntakRegNumber`, `taxId`, `totalStays`, `noReservationsFound`, `guestNotFound`

**Reservation Detail** (`pms.reservationDetail.*`): `guestInfo`, `stayDetails`, `financialSummary`, `notesRequests`, `guestFolio`, `ratePerNight`, `total`, `payment`, `balance`, `specialRequests`, `internalNotes`, `noCharges`, `confirm`, `cancel`, `noGuestLinked`, `notSpecified`, `adults`, `children`, `actualCheckIn`, `actualCheckOut`, `created`, `reservationNotFound`, `backToReservations`, `statusUpdated`, `failedToUpdate`

**Check-in/out** (`pms.checkIn.*`, `pms.checkOut.*`): `checkInGuest`, `assignRoom`, `selectCleanRoom`, `pleaseSelectRoom`, `failedCheckIn`, `processing`, `checkOutGuest`, `checkedIn`, `createHousekeepingAssignment`, `failedCheckOut`

**Create Reservation** (`pms.createReservation.*`): `newReservation`, `checkInDate`, `checkOutDate`, `adults`, `children`, `roomType`, `ratePerNight`, `source`, `specialRequests`, `guestPreferences`, `staffNotes`, `guestCheckInOutRequired`, `checkOutAfterCheckIn`, `reservationCreated`, `failedToCreate`

**Channel Manager** (`pms.channels.*`): `title`, `channels`, `ratePush`, `availability`, `syncLog`, `connectedChannels`, `availableChannels`, `noChannelsYet`, `addChannelToStart`, `active`, `inactive`, `lastSync`, `sync`, `configure`, `add`, `ratePushGrid`, `configureRatePlans`, `comingSoon`, `availabilityGrid`, `manageAvailability`, `openCloseRooms`, `syncHistory`, `viewHistory`, `failedToAdd`, `channelAdded`

**NotFound** (`notFound.*`): `title`, `message`, `returnHome`

### Files to Edit

| File | Changes |
|------|---------|
| `src/hooks/useTranslation.tsx` | Add ~200 keys in all 5 language blocks (en, hu, mn, es, vi) |
| `src/pages/Auth.tsx` | Replace all hardcoded strings with `t()` calls |
| `src/pages/FrontDesk.tsx` | Replace all hardcoded strings with `t()` calls |
| `src/pages/Reservations.tsx` | Replace all hardcoded strings with `t()` calls |
| `src/pages/Guests.tsx` | Replace all hardcoded strings with `t()` calls |
| `src/pages/GuestDetail.tsx` | Replace all hardcoded strings with `t()` calls |
| `src/pages/ReservationDetail.tsx` | Replace all hardcoded strings with `t()` calls |
| `src/pages/ChannelManager.tsx` | Replace all hardcoded strings with `t()` calls |
| `src/pages/NotFound.tsx` | Replace hardcoded strings with `t()` calls |
| `src/components/frontdesk/CheckInDialog.tsx` | Replace all hardcoded strings with `t()` calls |
| `src/components/frontdesk/CheckOutDialog.tsx` | Replace all hardcoded strings with `t()` calls |
| `src/components/reservations/CreateReservationDialog.tsx` | Replace all hardcoded strings with `t()` calls |
| `src/components/layout/PMSNavigation.tsx` | Replace nav labels with `t()` calls |
| `src/components/guests/GuestSearchSelect.tsx` | Replace labels with `t()` calls |

### Implementation Order
1. Add all translation keys to `useTranslation.tsx` (en + hu + mn + es + vi)
2. Update Auth page
3. Update PMS pages (FrontDesk, Reservations, Guests, GuestDetail, ReservationDetail, ChannelManager)
4. Update dialogs (CheckIn, CheckOut, CreateReservation)
5. Update PMSNavigation and NotFound
6. Update GuestSearchSelect

