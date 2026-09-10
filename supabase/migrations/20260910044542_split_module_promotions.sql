-- Replace the legacy organization-wide promotion with independent
-- Housekeeping and Revenue Management promotion windows. Existing regular and
-- promotional price columns remain in place so older billing records and
-- Stripe metadata stay compatible.

alter table public.billing_settings
  add column if not exists operations_promotion_enabled boolean not null default false,
  add column if not exists operations_promotion_label text not null default 'Housekeeping offer',
  add column if not exists operations_promotion_note text not null default '',
  add column if not exists operations_promotion_starts_on date,
  add column if not exists operations_promotion_ends_on date,
  add column if not exists revenue_promotion_enabled boolean not null default false,
  add column if not exists revenue_promotion_label text not null default 'Revenue Management offer',
  add column if not exists revenue_promotion_note text not null default '',
  add column if not exists revenue_promotion_starts_on date,
  add column if not exists revenue_promotion_ends_on date;

comment on column public.billing_settings.operations_promotion_starts_on is
  'First eligible checkout date for the Housekeeping promotion (inclusive).';
comment on column public.billing_settings.operations_promotion_ends_on is
  'Last eligible checkout date for the Housekeeping promotion (inclusive).';
comment on column public.billing_settings.revenue_promotion_starts_on is
  'First eligible checkout date for the Revenue Management promotion (inclusive).';
comment on column public.billing_settings.revenue_promotion_ends_on is
  'Last eligible checkout date for the Revenue Management promotion (inclusive).';

-- Preserve existing promotion behaviour by copying the legacy campaign into
-- each module only when that module actually has a lower promotional price.
update public.billing_settings
set
  operations_promotion_enabled = early_bird_enabled
    and operations_price_cents > 0
    and standard_operations_price_cents > operations_price_cents,
  operations_promotion_label = early_bird_label,
  operations_promotion_note = early_bird_note,
  operations_promotion_starts_on = trial_start,
  operations_promotion_ends_on = early_bird_ends_at,
  revenue_promotion_enabled = early_bird_enabled
    and (
      (revenue_bi_price_cents > 0 and standard_revenue_bi_price_cents > revenue_bi_price_cents)
      or
      (revenue_automation_price_cents > 0 and standard_revenue_automation_price_cents > revenue_automation_price_cents)
    ),
  revenue_promotion_label = early_bird_label,
  revenue_promotion_note = early_bird_note,
  revenue_promotion_starts_on = trial_start,
  revenue_promotion_ends_on = early_bird_ends_at;

-- The RD Hotels "First 6 months 50% OFF" agreement is Housekeeping-only.
-- Revenue keeps its normal configured prices and can receive a separate offer
-- later through the new Revenue promotion controls.
update public.billing_settings
set
  revenue_promotion_enabled = false,
  revenue_promotion_label = 'Revenue Management offer',
  revenue_promotion_note = '',
  revenue_promotion_starts_on = null,
  revenue_promotion_ends_on = null
where organization_slug = 'rdhotels';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_settings_operations_promotion_dates_chk'
      and conrelid = 'public.billing_settings'::regclass
  ) then
    alter table public.billing_settings
      add constraint billing_settings_operations_promotion_dates_chk
      check (
        operations_promotion_starts_on is null
        or operations_promotion_ends_on is null
        or operations_promotion_ends_on >= operations_promotion_starts_on
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_settings_revenue_promotion_dates_chk'
      and conrelid = 'public.billing_settings'::regclass
  ) then
    alter table public.billing_settings
      add constraint billing_settings_revenue_promotion_dates_chk
      check (
        revenue_promotion_starts_on is null
        or revenue_promotion_ends_on is null
        or revenue_promotion_ends_on >= revenue_promotion_starts_on
      );
  end if;
end
$$;
