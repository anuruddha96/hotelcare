-- Manual-price protection only cares about the small set of manager-edit sources.
-- Keep the V2 hold-state lookup off the 1.6M-row general audit history.
create index if not exists idx_rate_change_audit_manual_hold_recent
  on public.rate_change_audit (hotel_id, performed_at desc, stay_date)
  where source in ('cell-edit','cell-selection','day-tool','bulk','bulk-edit','manual','quick-adjust');
