-- =====================================================================
-- OTA channel economics: RLS checks the user once per statement.
--
-- auth.uid() and the role check are wrapped in sub-selects so Postgres
-- evaluates them once per statement (an initplan) instead of once per
-- row; only the per-hotel check stays per row. Same rules as before:
-- revenue users or super admins, for hotels they can access. Matters for
-- statement imports, which upsert thousands of rows at a time.
-- =====================================================================

alter policy "Revenue users view OTA terms" on public.ota_commercial_terms
  using ((select public.is_revenue_user((select auth.uid())) or coalesce(public.is_super_admin((select auth.uid())), false))
         and public.user_can_access_hotel((select auth.uid()), hotel_id));

alter policy "Revenue users add OTA terms" on public.ota_commercial_terms
  with check ((select public.is_revenue_user((select auth.uid())) or coalesce(public.is_super_admin((select auth.uid())), false))
              and public.user_can_access_hotel((select auth.uid()), hotel_id));

alter policy "Revenue users edit OTA terms" on public.ota_commercial_terms
  using ((select public.is_revenue_user((select auth.uid())) or coalesce(public.is_super_admin((select auth.uid())), false))
         and public.user_can_access_hotel((select auth.uid()), hotel_id))
  with check ((select public.is_revenue_user((select auth.uid())) or coalesce(public.is_super_admin((select auth.uid())), false))
              and public.user_can_access_hotel((select auth.uid()), hotel_id));

alter policy "Revenue users remove OTA terms" on public.ota_commercial_terms
  using ((select public.is_revenue_user((select auth.uid())) or coalesce(public.is_super_admin((select auth.uid())), false))
         and public.user_can_access_hotel((select auth.uid()), hotel_id));

alter policy "Revenue users view OTA statements" on public.ota_statement_lines
  using ((select public.is_revenue_user((select auth.uid())) or coalesce(public.is_super_admin((select auth.uid())), false))
         and public.user_can_access_hotel((select auth.uid()), hotel_id));

alter policy "Revenue users import OTA statements" on public.ota_statement_lines
  with check ((select public.is_revenue_user((select auth.uid())) or coalesce(public.is_super_admin((select auth.uid())), false))
              and public.user_can_access_hotel((select auth.uid()), hotel_id));

alter policy "Revenue users re-import OTA statements" on public.ota_statement_lines
  using ((select public.is_revenue_user((select auth.uid())) or coalesce(public.is_super_admin((select auth.uid())), false))
         and public.user_can_access_hotel((select auth.uid()), hotel_id))
  with check ((select public.is_revenue_user((select auth.uid())) or coalesce(public.is_super_admin((select auth.uid())), false))
              and public.user_can_access_hotel((select auth.uid()), hotel_id));

alter policy "Revenue users remove OTA statements" on public.ota_statement_lines
  using ((select public.is_revenue_user((select auth.uid())) or coalesce(public.is_super_admin((select auth.uid())), false))
         and public.user_can_access_hotel((select auth.uid()), hotel_id));
