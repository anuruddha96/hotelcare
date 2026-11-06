-- A private server worker reviews one compact batch per four-hour UTC slot.
-- The slot key prevents duplicate paid calls from retries or ChatGPT supervision.
select cron.schedule('ottofiori-ai-supervisor-4h','11 */4 * * *',
 $$select public.invoke_ottofiori_ai_supervisor();$$);
