UPDATE public.hotel_revenue_settings s
SET base_currency = x.c
FROM (
  SELECT hotel_id, currency AS c,
         ROW_NUMBER() OVER (PARTITION BY hotel_id ORDER BY COUNT(*) DESC) AS rn
  FROM public.revenue_room_type_rates
  GROUP BY hotel_id, currency
) x
WHERE x.hotel_id = s.hotel_id AND x.rn = 1 AND s.base_currency IS DISTINCT FROM x.c;