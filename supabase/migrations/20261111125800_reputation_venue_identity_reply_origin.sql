-- Reputation listings can represent standalone restaurants, museums, brunches or event venues.
-- Their brand identity must not be inferred from the full Google listing title.
alter table public.google_business_locations
  add column if not exists reply_brand_name text,
  add column if not exists business_category text not null default 'other';

alter table public.google_business_locations
  drop constraint if exists google_business_locations_business_category_check;
alter table public.google_business_locations
  add constraint google_business_locations_business_category_check
  check (business_category in ('hotel', 'brunch', 'restaurant', 'conference', 'museum', 'other'));

-- A persistent source makes all published replies distinguishable even if
-- the recent audit event window no longer contains the original event.
alter table public.google_reviews
  add column if not exists reply_origin text not null default 'unknown';
alter table public.google_reviews
  drop constraint if exists google_reviews_reply_origin_check;
alter table public.google_reviews
  add constraint google_reviews_reply_origin_check
  check (reply_origin in ('unknown', 'manager', 'automatic', 'google'));

update public.google_reviews r
set reply_origin = case
  when exists (select 1 from public.google_review_reply_events e where e.review_id=r.id and e.event_type='auto_published') then 'automatic'
  when exists (select 1 from public.google_review_reply_events e where e.review_id=r.id and e.event_type='published') then 'manager'
  else 'google'
end
where r.reply_status='published' and r.reply_origin='unknown';

-- Set verified/known brand identities without altering Google's own listing titles.
update public.google_business_locations
set
  reply_brand_name = case
    when google_location_title='Hotel Memories Budapest - Rumbach Space Events & Conferences' then 'Hotel Memories Budapest'
    when google_location_title='Hotel Ottofiori Budapest' then 'Hotel Ottofiori Budapest'
    when google_location_title='GOZSDU BRUNCH - HOTEL (all you can eat breakfast)' then 'Gozsdu Brunch'
    when google_location_title='Levante Budapest Restaurant & Bar' then 'Levante Budapest Restaurant & Bar'
    when google_location_title='Memories All- You-Can-Eat brunch' then 'Memories Brunch & Café'
    when google_location_title='Mika Tivadar Secret Museum' then 'Mika Tivadar Secret Museum'
    when google_location_title='Ottofiori All-You-Can-Eat Brunch & Café' then 'Ottofiori Brunch & Café'
    when google_location_title='Rumbachspace - Hotel Memories Budapest Conference Center' then 'Rumbachspace'
    else google_location_title
  end,
  business_category = case
    when google_location_title in ('Hotel Memories Budapest - Rumbach Space Events & Conferences','Hotel Ottofiori Budapest') then 'hotel'
    when google_location_title in ('GOZSDU BRUNCH - HOTEL (all you can eat breakfast)','Memories All- You-Can-Eat brunch','Ottofiori All-You-Can-Eat Brunch & Café') then 'brunch'
    when google_location_title='Levante Budapest Restaurant & Bar' then 'restaurant'
    when google_location_title='Mika Tivadar Secret Museum' then 'museum'
    when google_location_title='Rumbachspace - Hotel Memories Budapest Conference Center' then 'conference'
    else 'other'
  end
where reply_brand_name is null;

create index if not exists google_reviews_org_publish_origin_idx
  on public.google_reviews (organization_id,reply_status,reply_origin,google_reply_update_time desc);