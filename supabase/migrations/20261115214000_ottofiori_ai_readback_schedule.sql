-- The AI supervisor's Previo readback only ran when a manager pressed the
-- button, so the revenue panel always showed "Readback not yet confirmed".
-- Schedule it 30 minutes after each four-hour review (the queue has delivered
-- by then). The function picks the latest completed review itself.
create or replace function public.invoke_ottofiori_ai_supervisor(p_body jsonb)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'net', 'vault'
as $function$
declare v_secret text; v_id bigint;
begin
 select decrypted_secret into strict v_secret from vault.decrypted_secrets where name='hotelcare_otto_ai_worker_secret';
 select net.http_post(url:='https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/ottofiori-ai-supervisor',
 headers:=jsonb_build_object('Content-Type','application/json','x-otto-ai-worker',v_secret),body:=coalesce(p_body,'{}'::jsonb),timeout_milliseconds:=5000) into v_id;
 return v_id;
end $function$;

select cron.schedule('ottofiori-ai-readback-4h','41 */4 * * *',
 $$select public.invoke_ottofiori_ai_supervisor('{"action":"readback"}'::jsonb);$$);
