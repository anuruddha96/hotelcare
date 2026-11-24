DROP FUNCTION IF EXISTS public.hr_decide_break_request(uuid,text,text);
DROP POLICY IF EXISTS hr_break_no_delete ON public.break_requests;
DROP POLICY IF EXISTS hr_break_no_direct_update ON public.break_requests;
DROP POLICY IF EXISTS hr_break_read ON public.break_requests;
DROP POLICY IF EXISTS hr_break_scope ON public.break_requests;
DROP FUNCTION IF EXISTS public.is_hr_manager(uuid);
