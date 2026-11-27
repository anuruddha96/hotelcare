-- Test double for pg_cron's named scheduling contract, not a live cron daemon.
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobname text PRIMARY KEY, schedule text NOT NULL, command text NOT NULL);
CREATE FUNCTION cron.schedule(_name text,_schedule text,_command text) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN INSERT INTO cron.job VALUES(_name,_schedule,_command) ON CONFLICT(jobname) DO UPDATE SET schedule=excluded.schedule,command=excluded.command; RETURN 1; END $$;
INSERT INTO cron.job VALUES('auto-signout-daily','50 23 * * *','SELECT public.run_auto_signout();');
