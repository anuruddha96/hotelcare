DROP POLICY IF EXISTS "Org staff can read revenue booking nights" ON public.revenue_booking_nights;
CREATE POLICY "Org staff can read revenue booking nights"
ON public.revenue_booking_nights FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id));

DROP POLICY IF EXISTS "Org staff can read cancelled nights" ON public.revenue_cancelled_nights;
CREATE POLICY "Org staff can read cancelled nights"
ON public.revenue_cancelled_nights FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id));

DROP POLICY IF EXISTS "Org staff can read revenue daily snapshots" ON public.revenue_daily_snapshots;
CREATE POLICY "Org staff can read revenue daily snapshots"
ON public.revenue_daily_snapshots FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id));

DROP POLICY IF EXISTS "Org staff can read revenue rates" ON public.revenue_room_type_rates;
CREATE POLICY "Org staff can read revenue rates"
ON public.revenue_room_type_rates FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id));