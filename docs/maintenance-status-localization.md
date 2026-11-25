# Maintenance ticket status localization

Maintenance ticket cards must keep lifecycle state and hold context understandable for staff using the Hungarian interface.

The lifecycle presentation helper owns the fallback labels for `open`, `in_progress`, `on_hold`, `pending_supervisor_approval`, and `completed`. Hungarian (`hu`) has explicit operational labels for all five states plus the hold-reason caption and missing-reason fallback. Other languages continue using the existing translated core statuses where available and safe English fallbacks for the newer maintenance-only states.

This is presentation-only. It does not mutate ticket status, assignment, hotel scope, RLS, notifications, or production data.
