-- Backend revenue workers use the service_role JWT. Give those internal reads
-- enough headroom to survive a transient storage/checkpoint spike without changing
-- the shorter timeouts used by browser users (anon/authenticated).
alter role service_role set statement_timeout = '15s';
