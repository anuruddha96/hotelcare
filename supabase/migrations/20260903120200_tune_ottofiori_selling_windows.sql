-- Ottofiori selling-window tuning after 2026-09-03 no-booking review.
--
-- Close-in dates already near the market get controlled movement; visibly
-- overpriced 8-14 day dates may converge faster, while 91+ day dates remain
-- protected from no-pickup markdowns. The fill campaign can act several times
-- per local day, but every move is still constrained by ADR, monthly pacing,
-- price bounds, market validation, pickup brakes and whole-euro safety.

update public.revenue_pickup_automation_rules
set max_markdowns_per_day = 5,
    window_rules = jsonb_build_array(
      jsonb_build_object('id','w0_2','min_days_out',0,'max_days_out',2,'no_pickup_wait_hours',4,'max_daily_decrease',15,'max_daily_increase',8,'min_hours_between_decreases',0,'require_above_anchor',false),
      jsonb_build_object('id','w3_7','min_days_out',3,'max_days_out',5,'no_pickup_wait_hours',4,'max_daily_decrease',12,'max_daily_increase',8,'min_hours_between_decreases',0,'require_above_anchor',false),
      jsonb_build_object('id','w3_7','min_days_out',6,'max_days_out',7,'no_pickup_wait_hours',6,'max_daily_decrease',15,'max_daily_increase',8,'min_hours_between_decreases',0,'require_above_anchor',false),
      jsonb_build_object('id','w8_30','min_days_out',8,'max_days_out',14,'no_pickup_wait_hours',8,'max_daily_decrease',30,'max_daily_increase',8,'min_hours_between_decreases',2,'require_above_anchor',false),
      jsonb_build_object('id','w8_30','min_days_out',15,'max_days_out',31,'no_pickup_wait_hours',12,'max_daily_decrease',10,'max_daily_increase',8,'min_hours_between_decreases',6,'require_above_anchor',false),
      jsonb_build_object('id','w31_90','min_days_out',32,'max_days_out',60,'no_pickup_wait_hours',24,'max_daily_decrease',6,'max_daily_increase',8,'min_hours_between_decreases',24,'require_above_anchor',true),
      jsonb_build_object('id','w31_90','min_days_out',61,'max_days_out',90,'no_pickup_wait_hours',72,'max_daily_decrease',3,'max_daily_increase',8,'min_hours_between_decreases',48,'require_above_anchor',true),
      jsonb_build_object('id','w91_180','min_days_out',91,'max_days_out',180,'no_pickup_wait_hours',168,'max_daily_decrease',0,'max_daily_increase',8,'min_hours_between_decreases',72,'require_above_anchor',true),
      jsonb_build_object('id','w181_365','min_days_out',181,'max_days_out',null,'no_pickup_wait_hours',null,'max_daily_decrease',0,'max_daily_increase',10,'min_hours_between_decreases',0,'require_above_anchor',true)
    ),
    updated_at = now()
where hotel_id = 'ottofiori';
