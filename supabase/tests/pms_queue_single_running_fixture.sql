CREATE TABLE public.pms_refresh_queue (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 hotel_id text NOT NULL,
 status text NOT NULL,
 request_kind text NOT NULL,
 requested_by uuid,
 requested_at timestamptz NOT NULL DEFAULT now()
);
