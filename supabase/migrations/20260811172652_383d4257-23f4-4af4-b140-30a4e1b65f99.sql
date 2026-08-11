-- 1. Normalise the stored currency label ("9\n HUF" -> "HUF")
UPDATE public.revenue_booking_nights
SET source_currency = (regexp_match(upper(source_currency), '\m(EUR|HUF|USD|GBP|CZK|PLN|CHF|RON|SEK|NOK|DKK)\M'))[1]
WHERE source_currency IS NOT NULL
  AND upper(source_currency) ~ '\m(EUR|HUF|USD|GBP|CZK|PLN|CHF|RON|SEK|NOK|DKK)\M'
  AND source_currency <> (regexp_match(upper(source_currency), '\m(EUR|HUF|USD|GBP|CZK|PLN|CHF|RON|SEK|NOK|DKK)\M'))[1];

-- 2. Convert amounts that are not in the property's base currency
WITH fx(code, per_eur) AS (
  VALUES ('EUR',1.0),('HUF',390.0),('USD',1.09),('GBP',0.85),('CZK',25.0),
         ('PLN',4.3),('CHF',0.94),('RON',4.97),('SEK',11.2),('NOK',11.6),('DKK',7.46)
), base AS (
  SELECT s.hotel_id,
         upper(coalesce(s.base_currency,'EUR')) AS base_code,
         coalesce(s.eur_conversion_rate, f.per_eur, 1.0) AS base_per_eur
  FROM public.hotel_revenue_settings s
  LEFT JOIN fx f ON f.code = upper(coalesce(s.base_currency,'EUR'))
)
UPDATE public.revenue_booking_nights n
SET nightly_price_eur = round((n.nightly_price_eur / src.per_eur * b.base_per_eur)::numeric, 2),
    total_price_eur   = round((n.total_price_eur   / src.per_eur * b.base_per_eur)::numeric, 2)
FROM base b, fx src
WHERE b.hotel_id = n.hotel_id
  AND src.code = upper(n.source_currency)
  AND upper(n.source_currency) <> b.base_code;