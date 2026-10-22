-- Follow-up for already-applied SLNT v5 migrations: Supabase can explicitly
-- grant anon execute through function default privileges.
REVOKE ALL ON FUNCTION public.slnt_team_b_touch_activity_v5() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.slnt_team_b_calendar_v5(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.slnt_team_b_touch_activity_v5() TO authenticated;
GRANT EXECUTE ON FUNCTION public.slnt_team_b_calendar_v5(date,date) TO authenticated;
