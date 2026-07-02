## Plan

### 1) Repair the manager training flow
- Add missing spotlight anchors for the Attendance module, especially **Daily timesheet**, so the overlay highlights the correct UI instead of showing a text-only card.
- Rebuild the manager training structure as one clear orientation path:
  1. HR & Attendance
  2. Swipe/check-in behavior
  3. Break Types
  4. PMS upload / PMS sync
  5. Team view
  6. Pending approvals
  7. Staff / performance
  8. Photos / DND
  9. Maintenance
  10. Lost & Found
  11. Dirty linen
  12. HR management
- Remove duplicate/confusing manager modules from the visible Training Center by separating:
  - one **required Manager Complete Walkthrough**
  - smaller child modules used internally by the chain or replayed only where useful
- Keep the impressive first step, but make the rest continuous: when one module ends, the next starts without stacked resume cards or separate prompts.

### 2) Organize training prompts and notifications
- Replace repeated one-by-one training resume toasts with a single grouped training prompt.
- If multiple deferred training steps become relevant, show one message like **“Training ready to continue”** with one Resume action, not many separate notifications.
- Keep skipped/deferred training silent in the background unless it is genuinely ready and useful.
- Prevent the user from seeing skipped steps as errors.

### 3) Improve Training Center layout
- Group trainings by role and purpose:
  - **Required orientation**
  - **Daily operations**
  - **Feature refreshers**
- Show only the correct top-level modules by default.
- Hide or visually de-emphasize duplicate child modules that are only part of the continuous walkthrough.
- Make progress clearer: one visible progress state for the manager walkthrough instead of many confusing partial entries.

### 4) Fix Maintenance assignment filtering
- In the maintenance ticket dialog, load assignable maintenance users only for the currently selected property/hotel.
- For admins/top management, still respect the property selected in the form instead of showing every maintenance user across all properties.
- Apply the same filtering in both:
  - create ticket dialog
  - ticket detail / reassignment dialog
- Use existing hotel alias resolution so stored hotel IDs and display names both match correctly.

### 5) Change SLNT wording from Hotel to Property where needed
- For organization slug `slnt`, change labels in the maintenance ticket form from:
  - **Hotel** → **Property**
  - **Select Hotel** → **Select Property**
  - “hotel staff” → “property team”
- Keep “Hotel” wording for hotel organizations so existing hotel workflows are not affected.

### 6) Ensure maintenance appears under Housekeeping > Maintenance
- Confirm maintenance tickets are visible in the Housekeeping maintenance area.
- Ensure eligible users can open tickets there and update status, resolution, comments, and attachments.
- Keep role access restricted to the appropriate hotel/property and organization.

### 7) Complete yesterday’s PMS/no-show missing task
- Add a focused PMS reconciliation safety check for empty/no-show detection:
  - identify rooms present in housekeeping state but missing from PMS guest/reservation data for that date
  - mark them as empty/no-show candidate instead of leaving them active as occupied
  - record the reason/source so managers can audit why rooms like Ottofiori 302/303 were handled that way
- Add a small regression path around Ottofiori-style cases: PMS file has no guests for rooms 302/303, app must not keep them as occupied.

### 8) Complete yesterday’s SLNT long-term tenant task foundation
- Add the first safe tenant portal foundation without overbuilding payments:
  - tenant role support
  - property/unit distinction for SLNT rentals
  - tenant login landing route
  - maintenance issue creation connected into the existing maintenance workflow
  - emergency contacts section with configurable numbers
  - meter readings and contract placeholders if the supporting tables already exist, otherwise prepare the migration plan for them
- Use **112** as the EU emergency default unless the app already stores a configured SLNT-specific emergency number.

### 9) Validation
- Run targeted training curriculum tests and add coverage for:
  - Daily timesheet selector exists
  - manager chain has no duplicate visible top-level modules
  - deferred/resume notifications are grouped
- Verify in browser:
  - manager training starts and continues without breaking
  - Daily timesheet spotlight appears
  - create maintenance ticket only lists maintenance staff for the selected property
  - SLNT displays “Property” instead of “Hotel” in the ticket form
  - maintenance tickets appear and can be updated from Housekeeping > Maintenance

## Technical notes
- Main files likely affected:
  - `src/components/training/v2/TrainingV2Provider.tsx`
  - `src/components/training/v2/TrainingCenter.tsx`
  - `src/components/training/v2/curricula/*`
  - manager/attendance UI components that need `data-training` anchors
  - `src/components/dashboard/CreateTicketDialog.tsx`
  - `src/components/dashboard/TicketDetailDialog.tsx`
  - `src/components/dashboard/HousekeepingManagerView.tsx`
  - relevant Supabase migration(s) for PMS reconciliation and tenant foundation if missing
- Backend changes will include explicit grants for every new public table and RLS-safe role filtering.