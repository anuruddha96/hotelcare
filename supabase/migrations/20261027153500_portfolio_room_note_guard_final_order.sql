-- BEFORE triggers run alphabetically in Postgres. The portfolio guard
-- must run after the HMB-specific cleanup/manager guard, so its write
-- provenance checks see the final text intended for persistence.
-- No existing room data is modified.
ALTER TRIGGER zzzzzzzzzzzzzzzzzzz_hc_portfolio_manager_note_origin ON public.rooms
RENAME TO zzzzzzzzzzzzzzzzzzzzzzzzz_hc_portfolio_manager_note_origin;
