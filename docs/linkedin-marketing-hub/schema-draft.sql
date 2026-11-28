-- REVIEW ONLY: generate the timestamped migration with Supabase CLI and test
-- in a disposable database before deploying. Not in supabase/migrations yet.
begin;
create table public.linkedin_oauth_states (
 state_hash text primary key,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null,
 expires_at timestamptz not null
);
create table public.linkedin_pending_connections (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null,
 token_ciphertext text not null,
 token_expires_at timestamptz not null,
 expires_at timestamptz not null,
 pages jsonb not null
);
create table public.linkedin_page_connections (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 organization_urn text not null check (organization_urn ~ '^urn:li:organization:[0-9]+$'),
 page_name text not null,
 connected_by uuid not null,
 token_ciphertext text not null,
 token_expires_at timestamptz not null,
 status text not null default 'active' check (status in ('active','disconnected')),
 updated_at timestamptz not null default now(),
 unique(organization_urn),
 unique(organization_id,organization_urn),
 unique(organization_id,id)
);
create table public.linkedin_posts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 connection_id uuid not null,
 created_by uuid not null,
 content text not null check (char_length(btrim(content)) between 1 and 3000),
 publish_at timestamptz not null,
 status text not null default 'scheduled' check(status in ('scheduled','publishing','published','failed','unknown','cancelled')),
 remote_urn text,
 last_error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(organization_id,connection_id) references public.linkedin_page_connections(organization_id,id)
);
create index linkedin_posts_due on public.linkedin_posts(publish_at) where status='scheduled';
create index linkedin_posts_tenant on public.linkedin_posts(organization_id,created_at desc);
alter table public.linkedin_oauth_states enable row level security;
alter table public.linkedin_pending_connections enable row level security;
alter table public.linkedin_page_connections enable row level security;
alter table public.linkedin_posts enable row level security;
-- No direct browser access. All actions run through the authenticated Edge Function.
revoke all on public.linkedin_oauth_states,public.linkedin_pending_connections,public.linkedin_page_connections,public.linkedin_posts from public,anon,authenticated;
grant select,insert,update,delete on public.linkedin_oauth_states,public.linkedin_pending_connections,public.linkedin_page_connections,public.linkedin_posts to service_role;
create function public.linkedin_claim_due(p_limit integer default 5)
returns setof public.linkedin_posts
language sql security invoker set search_path = ''
as $$
 update public.linkedin_posts p set status='publishing',updated_at=now()
 where p.id in (
   select q.id from public.linkedin_posts q where q.status='scheduled' and q.publish_at <= now()
   order by q.publish_at,q.id limit least(greatest(p_limit,1),10) for update skip locked
 )
 returning p.*;
$$;
revoke all on function public.linkedin_claim_due(integer) from public,anon,authenticated;
grant execute on function public.linkedin_claim_due(integer) to service_role;
commit;
