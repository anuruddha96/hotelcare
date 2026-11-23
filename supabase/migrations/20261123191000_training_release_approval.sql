create table public.training_release_approvals (
  organization_slug text not null,
  release_id text not null check (release_id ~ '^[a-z0-9][a-z0-9_-]{2,99}$'),
  approved_by uuid not null default auth.uid(),
  approved_at timestamptz not null default now(),
  primary key (organization_slug, release_id)
);

create table public.training_prompt_receipts (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  prompt_key text not null check (length(prompt_key) between 1 and 140),
  shown_at timestamptz not null default now(),
  primary key (user_id, prompt_key)
);

alter table public.training_release_approvals enable row level security;
alter table public.training_prompt_receipts enable row level security;

revoke all on public.training_release_approvals, public.training_prompt_receipts from anon, authenticated;
grant select, insert on public.training_release_approvals, public.training_prompt_receipts to authenticated;

create policy "Read organization training approvals" on public.training_release_approvals
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and p.organization_slug = training_release_approvals.organization_slug)
  );

create policy "Admins approve training releases for their organization" on public.training_release_approvals
  for insert to authenticated with check (
    approved_by = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and p.organization_slug = training_release_approvals.organization_slug
      and p.role = 'admin')
  );

create policy "Read own training prompts" on public.training_prompt_receipts
  for select to authenticated using (user_id = (select auth.uid()));

create policy "Record own training prompts" on public.training_prompt_receipts
  for insert to authenticated with check (user_id = (select auth.uid()));
