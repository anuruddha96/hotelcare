

## Plan: Build PMS Foundation (Phase 1) — Reservations, Guests, Front Desk + CHM Stubs

### Overview
Transform the existing hotel operations app into a full PMS by adding reservation management, guest profiles, a visual availability calendar, front desk check-in/check-out workflows, and a channel manager UI with API stubs. All new modules integrate with existing rooms, housekeeping, and ticket systems. Billing is deferred.

---

### Database Changes (Migration)

**New tables:**

1. **`guests`** — Guest profiles
   - `id`, `hotel_id`, `organization_slug`, `first_name`, `last_name`, `email`, `phone`, `nationality`, `id_document_type`, `id_document_number`, `date_of_birth`, `address`, `city`, `country`, `postal_code`, `vip_status`, `notes`, `tax_id`, `company_name`, `preferences` (jsonb), `created_at`, `updated_at`
   - Hungary-specific: `szallas_registration_number` (NTAK guest registration)

2. **`reservations`** — Core booking records
   - `id`, `reservation_number` (unique, auto-generated), `hotel_id`, `organization_slug`, `guest_id` (FK guests), `room_id` (FK rooms, nullable until assigned), `room_type_requested`, `status` (enum: confirmed, checked_in, checked_out, cancelled, no_show, pending), `check_in_date`, `check_out_date`, `actual_check_in`, `actual_check_out`, `adults`, `children`, `total_nights`, `rate_per_night`, `total_amount`, `currency` (default 'EUR'), `payment_status` (unpaid, partial, paid, refunded), `balance_due`, `source` (direct, booking_com, expedia, previo, walk_in, phone, email), `source_reservation_id`, `special_requests`, `internal_notes`, `created_by`, `cancelled_at`, `cancellation_reason`, `created_at`, `updated_at`

3. **`reservation_room_assignments`** — Links reservations to specific rooms (supports multi-room bookings)
   - `id`, `reservation_id` (FK), `room_id` (FK), `check_in_date`, `check_out_date`, `status`, `created_at`

4. **`rate_plans`** — Room type pricing
   - `id`, `hotel_id`, `organization_slug`, `name`, `room_type`, `base_rate`, `currency`, `is_active`, `valid_from`, `valid_to`, `min_stay`, `max_stay`, `cancellation_policy`, `meal_plan` (room_only, breakfast, half_board, full_board), `created_at`, `updated_at`

5. **`rate_calendar`** — Daily rate overrides
   - `id`, `rate_plan_id` (FK), `date`, `rate`, `available_rooms`, `min_stay_override`, `is_closed`, `created_at`

6. **`channels`** — OTA/distribution channel config
   - `id`, `hotel_id`, `organization_slug`, `channel_name`, `channel_type` (ota, gds, direct, metasearch), `api_endpoint`, `api_key_ref`, `is_active`, `last_sync_at`, `sync_status`, `settings` (jsonb), `created_at`, `updated_at`

7. **`channel_rate_mappings`** — Maps rate plans to channels
   - `id`, `channel_id` (FK), `rate_plan_id` (FK), `channel_rate_code`, `markup_percent`, `is_active`, `created_at`

8. **`guest_folios`** — Charge tracking (lightweight, no payment processing)
   - `id`, `reservation_id` (FK), `guest_id` (FK), `description`, `amount`, `charge_type` (room, minibar, service, tax, discount), `charge_date`, `created_by`, `created_at`

**New enum:** `reservation_status` — confirmed, checked_in, checked_out, cancelled, no_show, pending

**RLS policies:** All tables use `organization_slug` matching via `get_user_organization_slug(auth.uid())`. Guests and reservations are readable by reception, front_office, manager, admin roles. Write access for manager+ roles.

**Trigger:** Auto-generate `reservation_number` (format: `RES-YYYYMMDD-XXXX`) on insert.

---

### New Pages & Routes

Add to `TenantRouter`:
- `/reservations` — Reservation list + calendar view
- `/reservations/:id` — Reservation detail
- `/guests` — Guest directory
- `/guests/:id` — Guest profile detail
- `/front-desk` — Today's arrivals/departures/in-house dashboard
- `/channel-manager` — Channel config, rate push, availability grid

---

### New Components

#### 1. Front Desk Dashboard (`src/pages/FrontDesk.tsx`)
- **Today's Overview**: Arrivals count, Departures count, In-House count, Available rooms
- **Arrivals List**: Reservations arriving today with check-in button
- **Departures List**: Guests departing today with check-out button
- **In-House Guests**: Currently checked-in guests with room numbers
- Check-in action: Assigns room, updates reservation status to `checked_in`, marks room as occupied
- Check-out action: Updates status to `checked_out`, triggers housekeeping room assignment (connects to existing `room_assignments` system)

#### 2. Reservations Module (`src/pages/Reservations.tsx`)
- **List View**: Searchable/filterable table of all reservations with status badges
- **Calendar View**: Visual availability grid (rooms on Y-axis, dates on X-axis) similar to Previo screenshot but with modern styling — color-coded blocks for reservations, drag-to-create
- **Create Reservation Dialog**: Guest search/create, room type selection, date picker, rate selection, source dropdown
- **Reservation Detail Page**: Full reservation info, guest details, room assignment, folio charges, status history, action buttons (check-in, cancel, modify)

#### 3. Guest Management (`src/pages/Guests.tsx`)
- **Guest Directory**: Searchable list with filters (VIP, nationality, returning)
- **Guest Profile**: Contact info, ID documents (Hungary NTAK compliance), stay history, preferences, folio history
- **Quick Create**: Inline form for walk-in guests

#### 4. Channel Manager (`src/pages/ChannelManager.tsx`)
- **Channels List**: Connected OTAs with status indicators (active/error/syncing)
- **Rate Push Grid**: Room types x Dates matrix showing rates per channel, bulk edit capability
- **Availability Grid**: Room availability by type per date, with open/close controls
- **Sync Log**: History of rate/availability pushes with success/error status
- API stubs for Booking.com, Expedia (no actual integration yet, just the UI and data structures)

#### 5. Navigation Update
- Add sidebar navigation for PMS modules (Front Desk, Reservations, Guests, Channel Manager) alongside existing dashboard tabs
- Role-based visibility: Reception sees Front Desk + Reservations; Managers see everything; Housekeeping sees existing tabs only

---

### Integration Points with Existing System

1. **Check-out → Housekeeping**: When a guest checks out, auto-create a `checkout_cleaning` room assignment (reuse existing `room_assignments` flow)
2. **Rooms table**: Reservations reference existing `rooms` table. Room status updates flow bidirectionally
3. **PMS Upload**: The existing PMS upload system can be enhanced to also create/update reservations from Previo data
4. **Minibar**: Guest folio charges can include minibar usage from existing `room_minibar_usage` table
5. **Profiles**: Existing staff profiles and roles are reused for access control

---

### Files to Create

| File | Purpose |
|------|---------|
| `src/pages/FrontDesk.tsx` | Front desk arrivals/departures dashboard |
| `src/pages/Reservations.tsx` | Reservation list + calendar |
| `src/pages/ReservationDetail.tsx` | Single reservation detail page |
| `src/pages/Guests.tsx` | Guest directory |
| `src/pages/GuestDetail.tsx` | Guest profile page |
| `src/pages/ChannelManager.tsx` | CHM rate/availability management |
| `src/components/reservations/ReservationCalendar.tsx` | Visual availability grid |
| `src/components/reservations/CreateReservationDialog.tsx` | New booking form |
| `src/components/reservations/ReservationCard.tsx` | Reservation list item |
| `src/components/guests/GuestSearchSelect.tsx` | Guest search/create combo |
| `src/components/guests/GuestProfileCard.tsx` | Guest info display |
| `src/components/frontdesk/ArrivalsDeparturesBoard.tsx` | Today's board |
| `src/components/frontdesk/CheckInDialog.tsx` | Check-in workflow |
| `src/components/frontdesk/CheckOutDialog.tsx` | Check-out workflow |
| `src/components/channels/ChannelCard.tsx` | OTA channel status card |
| `src/components/channels/RatePushGrid.tsx` | Rate management grid |
| `src/components/layout/PMSNavigation.tsx` | Sidebar navigation for PMS |

### Files to Edit

| File | Change |
|------|--------|
| `src/App.tsx` | Add new routes under TenantRouter |
| `src/components/layout/Header.tsx` | Add PMS navigation links |
| `src/components/dashboard/Dashboard.tsx` | Add Front Desk quick-access for reception role |

---

### Implementation Order

1. Database migration (all tables + RLS + triggers)
2. PMSNavigation sidebar + routing
3. Guest management (CRUD)
4. Reservation system (list, create, detail)
5. Reservation calendar view
6. Front desk dashboard with check-in/check-out
7. Channel manager UI with stubs
8. Integration wiring (checkout → housekeeping)

This is a large build. I will implement it incrementally across multiple steps, starting with the database and navigation scaffolding.

