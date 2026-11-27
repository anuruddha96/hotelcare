Attendance and location: product rule

Principle
Work is mandatory, location is not. A staff member must never be stopped from starting work because their phone cannot share a location. Location is used to verify a check-in, not to allow it.

Check-in flow (staff)
1. The staff member swipes right to check in. The swipe is always shown.
2. HotelCare asks the phone for its position: first a quick network fix (a position the phone measured in the last 5 minutes is accepted), then one GPS attempt. Worst case about 20 seconds.
3. Position found: normal check-in, location saved.
4. No position (blocked, off, timeout, unavailable, unsupported): one simple card, never a blocking pop-up:
   "Your location isn't working right now. No problem — you can start work. We'll let the manager know so they can fix it."
   Primary button: Start work now (one tap, temporary access).
   Secondary: Try location again, How to fix.
5. "How to fix" gives at most three steps and matches the real cause: if the browser already allows the site, it points to the phone's own Location / Chrome app permission, not to browser site settings.

What happens on temporary access
- The attendance row is created with check_in_location.location_unavailable = true, the error reason and device diagnostics (site permission, attempts with native error codes and timings, device/browser, installed-app mode).
- HR and reports show the check-in as not location-verified ("Location unavailable – temporary access").
- Support is emailed at info@hotelcare.app (override with ATTENDANCE_ALERT_INBOX) by the attendance-location-alert function, with the likely cause in plain words and how to fix it on the phone. One email per check-in; the outcome is stored on the row (alert_status, alert_emailed_at).
- Sending the email never delays or undoes the check-in.
- Sign-out never requires a location either.

Wording rules for any location message
- Short, friendly, no technical terms. Say what happened, that work can continue, and who has been told.
- No error codes for staff; codes go to the support email.

Known limits
- A web app cannot open Android/iOS system settings directly. It can re-ask for permission and show the steps. Opening settings automatically needs a native wrapper (TWA/Capacitor), which is a future option.

Future
- Manager in-app/push notification next to the email.
- Weekly report of staff with repeated temporary access, so phones get fixed instead of the exception becoming the norm.
- Optional per-organization setting to require a manager confirmation for repeated unverified check-ins (never to block work).
