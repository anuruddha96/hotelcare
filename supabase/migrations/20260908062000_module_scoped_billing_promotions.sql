-- Module-scoped promotions are introduced without changing any other tenant.
--
-- Every existing and future organization stays in legacy promotion mode until
-- an administrator intentionally edits promotion-specific settings. RD Hotels
-- is the only organization explicitly opted in by this migration.

alter table public.billing_settings
  add column if not exists module_scoped_promotions_enabled boolean,
  add column if not exists revenue_bi_promo_enabled boolean not null default false,
  add column if not exists revenue_bi_promo_label text,
  add column if not exists revenue_bi_promo_note text,
  add column if not exists revenue_bi_promo_ends_at date,
  add column if not exists revenue_automation_promo_enabled boolean not null default false,
  add column if not exists revenue_automation_promo_label text,
  add column if not exists revenue_automation_promo_note text,
  add column if not exists revenue_automation_promo_ends_at date;

-- Critical tenant-isolation guard: every organization keeps the exact old
-- promotion behaviour unless RD Hotels is opted in below or an admin later
-- changes promotion-specific fields for that organization.
update public.billing_settings
set module_scoped_promotions_enabled = false
where module_scoped_promotions_enabled is null;

alter table public.billing_settings
  alter column module_scoped_promotions_enabled set default false,
  alter column module_scoped_promotions_enabled set not null;

comment on column public.billing_settings.module_scoped_promotions_enabled is
  'When true, promotions are evaluated per module. Default false protects existing/new tenants until an admin intentionally configures promotions.';
comment on column public.billing_settings.early_bird_enabled is
  'Legacy global promotion flag. In module-scoped mode this is Housekeeping/Operations only.';
comment on column public.billing_settings.early_bird_label is
  'Legacy global promotion label. In module-scoped mode this is Housekeeping/Operations only.';
comment on column public.billing_settings.early_bird_note is
  'Legacy global promotion note. In module-scoped mode this is Housekeeping/Operations only.';
comment on column public.billing_settings.early_bird_ends_at is
  'Legacy global promotion end date. In module-scoped mode this is Housekeeping/Operations only.';
comment on column public.billing_settings.revenue_bi_promo_enabled is
  'Module-scoped mode only: whether the Revenue BI per-room promotion is enabled.';
comment on column public.billing_settings.revenue_automation_promo_enabled is
  'Module-scoped mode only: whether the Revenue BI + Automation per-room promotion is enabled.';

-- Admin future-customization bridge. The current admin screen already has
-- separate Housekeeping, BI, and BI + Automation promotion controls. Touching
-- promotion-specific fields is the explicit opt-in signal for that organization.
-- Normal pricing, trial, VAT, Stripe or other settings do NOT opt an org in.
create or replace function public.enable_module_scoped_promotions_on_promo_edit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.early_bird_enabled, false)
       or coalesce(new.revenue_bi_promo_enabled, false)
       or coalesce(new.revenue_automation_promo_enabled, false) then
      new.module_scoped_promotions_enabled := true;
    end if;
  elsif tg_op = 'UPDATE' and not coalesce(old.module_scoped_promotions_enabled, false) then
    if new.early_bird_enabled is distinct from old.early_bird_enabled
       or new.early_bird_label is distinct from old.early_bird_label
       or new.early_bird_note is distinct from old.early_bird_note
       or new.early_bird_ends_at is distinct from old.early_bird_ends_at
       or new.revenue_bi_promo_enabled is distinct from old.revenue_bi_promo_enabled
       or new.revenue_bi_promo_label is distinct from old.revenue_bi_promo_label
       or new.revenue_bi_promo_note is distinct from old.revenue_bi_promo_note
       or new.revenue_bi_promo_ends_at is distinct from old.revenue_bi_promo_ends_at
       or new.revenue_automation_promo_enabled is distinct from old.revenue_automation_promo_enabled
       or new.revenue_automation_promo_label is distinct from old.revenue_automation_promo_label
       or new.revenue_automation_promo_note is distinct from old.revenue_automation_promo_note
       or new.revenue_automation_promo_ends_at is distinct from old.revenue_automation_promo_ends_at then
      new.module_scoped_promotions_enabled := true;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists billing_settings_enable_module_scoped_promotions on public.billing_settings;
create trigger billing_settings_enable_module_scoped_promotions
before insert or update on public.billing_settings
for each row execute function public.enable_module_scoped_promotions_on_promo_edit();

-- RD Hotels Group only.
-- Housekeeping: EUR 6 standard -> EUR 3 for six months (50% OFF).
-- Revenue BI and BI + Automation keep their configured prices and receive no
-- promotion. No other organization's prices or promotion settings are touched.
update public.billing_settings
set
  module_scoped_promotions_enabled = true,
  early_bird_enabled = true,
  early_bird_label = 'First 6 months 50% OFF',
  early_bird_note = 'RD Hotels Group founding-partner offer — Housekeeping only.',
  early_bird_ends_at = date '2027-03-08',
  operations_price_cents = 300,
  standard_operations_price_cents = 600,
  revenue_bi_promo_enabled = false,
  revenue_bi_promo_label = null,
  revenue_bi_promo_note = null,
  revenue_bi_promo_ends_at = null,
  revenue_automation_promo_enabled = false,
  revenue_automation_promo_label = null,
  revenue_automation_promo_note = null,
  revenue_automation_promo_ends_at = null
where organization_slug = 'rdhotels';
