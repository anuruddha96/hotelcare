-- Sold-out capture is an internal revenue-sync primitive. It is called by
-- refresh_revenue_published_payload() after the PMS sync completes and should
-- never be directly invokable from the public REST RPC surface.
REVOKE ALL ON FUNCTION public.capture_revenue_soldout_prices(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.capture_revenue_soldout_prices(text) FROM anon;
REVOKE ALL ON FUNCTION public.capture_revenue_soldout_prices(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.capture_revenue_soldout_prices(text) TO service_role;
