-- Signed-out visitors must not be able to call the new finance helpers.
REVOKE EXECUTE ON FUNCTION public.fin_profile(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fin_can_approve(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fin_scope_ok(uuid, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fin_is_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pi_audit_invoice_changes() FROM anon, authenticated;

-- ============ analytics RPCs (RLS-respecting: SECURITY INVOKER) ============

CREATE OR REPLACE FUNCTION public.pi_analytics_summary(
  _from date DEFAULT NULL,
  _to date DEFAULT NULL,
  _company_id uuid DEFAULT NULL,
  _hotel_id text DEFAULT NULL,
  _cost_centre_id uuid DEFAULT NULL,
  _category_id uuid DEFAULT NULL,
  _merchant text DEFAULT NULL,
  _approval_status text DEFAULT NULL,
  _review_status text DEFAULT NULL,
  _currency text DEFAULT NULL
)
RETURNS TABLE (
  spend numeric, invoice_count bigint, avg_amount numeric, vat numeric,
  pending_approval bigint, pending_approval_value numeric,
  approved bigint, rejected bigint, approval_rate numeric,
  extraction_rate numeric, duplicate_alerts bigint, unique_merchants bigint
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH rows AS (
    SELECT * FROM public.purchase_invoices i
     WHERE (_from IS NULL OR coalesce(i.invoice_date, i.created_at::date) >= _from)
       AND (_to IS NULL OR coalesce(i.invoice_date, i.created_at::date) <= _to)
       AND (_company_id IS NULL OR i.buyer_company_id = _company_id)
       AND (_hotel_id IS NULL OR i.hotel_id = _hotel_id)
       AND (_cost_centre_id IS NULL OR i.cost_centre_id = _cost_centre_id)
       AND (_category_id IS NULL OR i.expense_category_id = _category_id)
       AND (_merchant IS NULL OR i.merchant_name = _merchant)
       AND (_approval_status IS NULL OR i.approval_status = _approval_status)
       AND (_review_status IS NULL OR i.review_status = _review_status)
       AND (_currency IS NULL OR i.currency = _currency)
  )
  SELECT
    coalesce(sum(total_amount), 0),
    count(*),
    coalesce(avg(total_amount), 0),
    coalesce(sum(total_vat_amount), 0),
    count(*) FILTER (WHERE review_status = 'pending_approval' AND approval_status <> 'approved'),
    coalesce(sum(total_amount) FILTER (WHERE review_status = 'pending_approval' AND approval_status <> 'approved'), 0),
    count(*) FILTER (WHERE approval_status = 'approved'),
    count(*) FILTER (WHERE approval_status = 'rejected'),
    CASE WHEN count(*) FILTER (WHERE status = 'processed' OR approval_status <> 'none') > 0
         THEN round(100.0 * count(*) FILTER (WHERE approval_status = 'approved')
                    / count(*) FILTER (WHERE status = 'processed' OR approval_status <> 'none'), 0)
         ELSE 0 END,
    CASE WHEN count(*) FILTER (WHERE status <> 'uploaded') > 0
         THEN round(100.0 * count(*) FILTER (WHERE status = 'processed' OR is_verified)
                    / count(*) FILTER (WHERE status <> 'uploaded'), 0)
         ELSE 0 END,
    count(*) FILTER (WHERE duplicate_status IN ('suspected','exact','possible')),
    count(DISTINCT merchant_name)
  FROM rows;
$$;

CREATE OR REPLACE FUNCTION public.pi_analytics_buckets(
  _bucket text DEFAULT 'day',
  _from date DEFAULT NULL,
  _to date DEFAULT NULL,
  _company_id uuid DEFAULT NULL,
  _hotel_id text DEFAULT NULL,
  _cost_centre_id uuid DEFAULT NULL,
  _category_id uuid DEFAULT NULL,
  _merchant text DEFAULT NULL,
  _approval_status text DEFAULT NULL
)
RETURNS TABLE (bucket date, spend numeric, vat numeric, invoice_count bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT
    date_trunc(CASE WHEN _bucket IN ('day','week','month') THEN _bucket ELSE 'day' END,
               coalesce(i.invoice_date, i.created_at::date))::date AS bucket,
    coalesce(sum(i.total_amount), 0),
    coalesce(sum(i.total_vat_amount), 0),
    count(*)
  FROM public.purchase_invoices i
  WHERE (_from IS NULL OR coalesce(i.invoice_date, i.created_at::date) >= _from)
    AND (_to IS NULL OR coalesce(i.invoice_date, i.created_at::date) <= _to)
    AND (_company_id IS NULL OR i.buyer_company_id = _company_id)
    AND (_hotel_id IS NULL OR i.hotel_id = _hotel_id)
    AND (_cost_centre_id IS NULL OR i.cost_centre_id = _cost_centre_id)
    AND (_category_id IS NULL OR i.expense_category_id = _category_id)
    AND (_merchant IS NULL OR i.merchant_name = _merchant)
    AND (_approval_status IS NULL OR i.approval_status = _approval_status)
  GROUP BY 1
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.pi_analytics_breakdown(
  _dimension text DEFAULT 'merchant',
  _from date DEFAULT NULL,
  _to date DEFAULT NULL,
  _hotel_id text DEFAULT NULL,
  _company_id uuid DEFAULT NULL,
  _approval_status text DEFAULT NULL,
  _limit integer DEFAULT 20
)
RETURNS TABLE (label text, spend numeric, invoice_count bigint, credit_total numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT
    CASE _dimension
      WHEN 'company' THEN coalesce(c.legal_name, c.name, i.buyer_name, 'Unassigned')
      WHEN 'property' THEN coalesce(i.hotel_id, 'Unassigned')
      WHEN 'cost_centre' THEN coalesce(cc.label, 'Unassigned')
      WHEN 'category' THEN coalesce(cat.label, i.expense_category, 'Uncategorized')
      ELSE coalesce(i.merchant_name, 'Unknown')
    END AS label,
    coalesce(sum(i.total_amount) FILTER (WHERE coalesce(i.is_credit_note, false) = false), 0),
    count(*),
    coalesce(sum(i.total_amount) FILTER (WHERE coalesce(i.is_credit_note, false)), 0)
  FROM public.purchase_invoices i
  LEFT JOIN public.invoice_buyer_companies c ON c.id = i.buyer_company_id
  LEFT JOIN public.invoice_cost_centres cc ON cc.id = i.cost_centre_id
  LEFT JOIN public.purchase_invoice_categories cat ON cat.id = i.expense_category_id
  WHERE (_from IS NULL OR coalesce(i.invoice_date, i.created_at::date) >= _from)
    AND (_to IS NULL OR coalesce(i.invoice_date, i.created_at::date) <= _to)
    AND (_hotel_id IS NULL OR i.hotel_id = _hotel_id)
    AND (_company_id IS NULL OR i.buyer_company_id = _company_id)
    AND (_approval_status IS NULL OR i.approval_status = _approval_status)
  GROUP BY 1
  ORDER BY 2 DESC
  LIMIT greatest(coalesce(_limit, 20), 1);
$$;

CREATE OR REPLACE FUNCTION public.pi_pending_ageing()
RETURNS TABLE (bucket text, invoice_count bigint, value numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH pending AS (
    SELECT total_amount,
           greatest(0, (now()::date - coalesce(submitted_at, updated_at, created_at)::date)) AS age_days
      FROM public.purchase_invoices
     WHERE review_status = 'pending_approval' AND approval_status <> 'approved'
  )
  SELECT b.bucket, count(p.*), coalesce(sum(p.total_amount), 0)
    FROM (VALUES ('0-2 days', 0, 2), ('3-7 days', 3, 7), ('8+ days', 8, 100000)) AS b(bucket, lo, hi)
    LEFT JOIN pending p ON p.age_days BETWEEN b.lo AND b.hi
   GROUP BY b.bucket, b.lo
   ORDER BY b.lo;
$$;

CREATE OR REPLACE FUNCTION public.pi_search_invoices(
  _q text,
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, invoice_number text, invoice_date date, merchant_name text,
  merchant_tax_id text, buyer_name text, hotel_id text, total_amount numeric,
  currency text, status text, review_status text, approval_status text, rank integer
)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH q AS (
    SELECT coalesce(trim(_q), '') AS raw,
           public.pi_norm_doc_number(_q) AS norm,
           public.pi_norm_tax_id(_q) AS tax,
           CASE WHEN trim(coalesce(_q,'')) ~ '^[0-9]+([.,][0-9]+)?$'
                THEN replace(trim(_q), ',', '.')::numeric END AS amount
  )
  SELECT i.id, i.invoice_number, i.invoice_date, i.merchant_name,
         i.merchant_tax_id, i.buyer_name, i.hotel_id, i.total_amount,
         i.currency, i.status, i.review_status, i.approval_status,
         CASE
           WHEN i.normalized_invoice_number IS NOT NULL AND i.normalized_invoice_number = q.norm THEN 1
           WHEN q.norm IS NOT NULL AND i.normalized_invoice_number LIKE q.norm || '%' THEN 2
           WHEN q.tax IS NOT NULL AND (i.normalized_merchant_tax_id = q.tax
                OR public.pi_norm_tax_id(i.buyer_tax_id) = q.tax) THEN 3
           WHEN q.amount IS NOT NULL AND i.total_amount = q.amount THEN 4
           ELSE 5
         END AS rank
    FROM public.purchase_invoices i, q
   WHERE q.raw <> ''
     AND (
       (q.norm IS NOT NULL AND i.normalized_invoice_number LIKE q.norm || '%')
       OR (q.tax IS NOT NULL AND (i.normalized_merchant_tax_id = q.tax OR public.pi_norm_tax_id(i.buyer_tax_id) = q.tax))
       OR i.merchant_name ILIKE '%' || q.raw || '%'
       OR i.buyer_name ILIKE '%' || q.raw || '%'
       OR i.hotel_id ILIKE '%' || q.raw || '%'
       OR (q.amount IS NOT NULL AND i.total_amount = q.amount)
     )
   ORDER BY rank, i.invoice_date DESC NULLS LAST, i.created_at DESC
   LIMIT greatest(coalesce(_limit, 50), 1) OFFSET greatest(coalesce(_offset, 0), 0);
$$;

REVOKE EXECUTE ON FUNCTION public.pi_analytics_summary(date,date,uuid,text,uuid,uuid,text,text,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pi_analytics_buckets(text,date,date,uuid,text,uuid,uuid,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pi_analytics_breakdown(text,date,date,text,uuid,text,integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pi_pending_ageing() FROM anon;
REVOKE EXECUTE ON FUNCTION public.pi_search_invoices(text,integer,integer) FROM anon;