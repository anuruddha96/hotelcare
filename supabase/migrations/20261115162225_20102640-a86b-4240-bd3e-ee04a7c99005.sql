DROP POLICY IF EXISTS "rec_read" ON public.revenue_engine_config;
CREATE POLICY "rec_read" ON public.revenue_engine_config FOR SELECT TO authenticated
USING (public.get_current_user_role() IN ('admin'::user_role,'top_management'::user_role,'top_management_manager'::user_role,'manager'::user_role));

DROP POLICY IF EXISTS "Authenticated can read quote refresh state" ON public.motivational_quote_state;
CREATE POLICY "Admins can read quote refresh state" ON public.motivational_quote_state FOR SELECT TO authenticated
USING (public.get_current_user_role() = 'admin'::user_role);

DROP POLICY IF EXISTS "market events read authenticated" ON public.market_events;
CREATE POLICY "market events read revenue roles" ON public.market_events FOR SELECT TO authenticated
USING (public.get_current_user_role() IN ('admin'::user_role,'top_management'::user_role,'top_management_manager'::user_role,'manager'::user_role));

DROP POLICY IF EXISTS "All authenticated users can view hotels" ON public.hotels;
CREATE POLICY "Signed-in users can view hotels" ON public.hotels FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "All authenticated users can view minibar items" ON public.minibar_items;
CREATE POLICY "Signed-in users can view minibar items" ON public.minibar_items FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can upload DND photos" ON storage.objects;
CREATE POLICY "Authenticated users can upload DND photos" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'dnd-photos' AND owner_id = (select auth.uid()::text));

DROP POLICY IF EXISTS "Authenticated users can upload room photos" ON storage.objects;
CREATE POLICY "Authenticated users can upload room photos" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'room-photos' AND owner_id = (select auth.uid()::text));