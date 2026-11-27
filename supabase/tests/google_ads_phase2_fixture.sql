create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create table public.organizations(id uuid primary key, slug text not null unique, is_active boolean not null default true);
insert into public.organizations values
 ('11111111-1111-4111-8111-111111111111','alpha',true),
 ('22222222-2222-4222-8222-222222222222','beta',true);
