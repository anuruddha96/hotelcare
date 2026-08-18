with ranked as (
 select id, confirmation_status,
        row_number() over (partition by hotel_id, stay_date, room_type_name, occupancy order by created_at desc) rn
 from public.revenue_rate_drafts where superseded_at is null and stay_date >= current_date
)
update public.revenue_rate_drafts d
   set confirmation_status = 'superseded', reconcile_state = null, reconcile_next_at = null, push_error = null
  from ranked r
 where r.id = d.id and r.rn > 1
   and r.confirmation_status in ('different','sent','sending','checking','pending');