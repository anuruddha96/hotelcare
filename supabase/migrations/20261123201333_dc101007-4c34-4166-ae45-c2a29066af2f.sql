DROP POLICY IF EXISTS "All authenticated users can view break types" ON public.break_types;
CREATE POLICY "Signed-in users can view break types" ON public.break_types FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Anyone can view category order" ON public.minibar_category_order;
CREATE POLICY "Signed-in users can view category order" ON public.minibar_category_order FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
REVOKE SELECT ON public.minibar_category_order FROM anon;
REVOKE SELECT ON public.break_types FROM anon;