-- `preserve_known_bookingcom_price_on_zero` is a trigger-only SECURITY DEFINER
-- function. It must not be exposed as a callable PostgREST RPC to browser roles.
-- Trigger execution does not require those roles to have direct EXECUTE rights.

revoke execute on function public.preserve_known_bookingcom_price_on_zero()
  from public, anon, authenticated;

-- The durable price memory is backend-only. RLS already blocks browser reads;
-- make the intent explicit at the privilege layer as well.
revoke all on table public.revenue_reservation_price_memory
  from anon, authenticated;