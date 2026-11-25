-- Seed only the current actionable 14-day low-star backlog.
-- Existing reviews are not re-published or changed.
INSERT INTO public.google_reputation_alerts
 (organization_id,google_location_id,google_review_name,review_id,star_rating,review_excerpt)
SELECT r.organization_id,r.google_location_id,r.google_review_name,r.id,
       r.star_rating,LEFT(COALESCE(r.comment,''),600)
FROM public.google_reviews r
WHERE r.star_rating BETWEEN 1 AND 3
  AND r.reply_status <> 'published'
  AND r.review_create_time >= now()-interval '14 days'
  AND r.review_create_time <= now()
ON CONFLICT (organization_id,google_review_name) DO NOTHING;