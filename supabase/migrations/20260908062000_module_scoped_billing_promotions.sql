-- Module-scoped promotions are introduced without changing any existing tenant.
--
-- Existing billing_settings rows stay in legacy promotion mode so their current
-- early_bird_* behaviour and prices remain exactly as they were before this
-- migration. RD Hotels is the only existing organization opted in here.
-- New organizations created after this migration default to module-scoped mode
-- so admins can configure each module independently going forward.

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

-- Critical tenant-isolation guard: every organization that already exists keeps
-- the legacy global-promotion behaviour unless it is explicitly opted in.
update public.billing_settings
set module_scoped_promotions_enabled = false
where module_scoped_promotions_enabled is null;

alter table public.billing_settings
  alter column module_scoped_promotions_enabled set default true,
  alter column module_scoped_promotions_enabled set not null;

comment on column public.billing_settings.module_scoped_promotions_enabled is
  'When true, promotions are evaluated per module. Existing tenants were backfilled false; new tenants default true.';
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

-- RD Hotels Group only.
-- Housekeeping: EUR 6 standard -> EUR 3 for six months (50% OFF).
-- Revenue BI and BI + Automation keep their configured prices and receive no
-- promotion. No other existing organization's values are touched.
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
