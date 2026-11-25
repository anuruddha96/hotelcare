-- Keep the generated ticket title consistent when the room is corrected.
CREATE OR REPLACE FUNCTION public.correct_maintenance_ticket_room(p_ticket_id uuid, p_room_number text, p_expected_updated_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_ticket public.tickets%ROWTYPE;
 v_room public.rooms%ROWTYPE;
 v_new_number text := pg_catalog.btrim(coalesce(p_room_number,''));
 v_old_number text;
 v_new_title text;
 v_new_description text;
 v_recipients uuid[];
 v_hotel_id text;
 v_hotel_name text;
BEGIN
 IF auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Please sign in to correct a maintenance ticket' USING ERRCODE='28000';
 END IF;
 SELECT * INTO v_ticket FROM public.tickets WHERE id=p_ticket_id FOR UPDATE;
 IF NOT FOUND OR v_ticket.department IS DISTINCT FROM 'maintenance' THEN
  RAISE EXCEPTION 'Maintenance ticket not found' USING ERRCODE='22023';
 END IF;
 IF NOT public.can_review_maintenance_for_hotel(v_ticket.organization_slug,v_ticket.hotel) THEN
  RAISE EXCEPTION 'Only a supervisor or authorized manager of this hotel can change the room'
   USING ERRCODE='42501';
 END IF;
 IF p_expected_updated_at IS NULL OR v_ticket.updated_at IS DISTINCT FROM p_expected_updated_at THEN
  RAISE EXCEPTION 'This ticket was updated by another user. Refresh and try again.' USING ERRCODE='PT409';
 END IF;
 IF pg_catalog.length(v_new_number) = 0 OR pg_catalog.length(v_new_number)>30 THEN
  RAISE EXCEPTION 'Choose a valid room number' USING ERRCODE='22023';
 END IF;
 v_old_number := coalesce(v_ticket.room_number,'');
 IF v_old_number = v_new_number THEN RETURN; END IF;

 SELECT r.* INTO v_room
 FROM public.rooms r
 WHERE r.organization_slug=v_ticket.organization_slug
   AND r.room_number=v_new_number
   AND (
    r.hotel=v_ticket.hotel
    OR (public.get_hotel_name_from_id(r.hotel)
         = public.get_hotel_name_from_id(v_ticket.hotel))
    OR EXISTS (SELECT 1 FROM public.hotel_configurations h
               WHERE r.hotel IN (h.hotel_id,h.hotel_name)
                 AND v_ticket.hotel IN (h.hotel_id,h.hotel_name))
   )
 ORDER BY CASE WHEN r.hotel=v_ticket.hotel THEN 0 ELSE 1 END
 LIMIT 1;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'This room does not exist at the ticket hotel' USING ERRCODE='22023';
 END IF;

 v_new_title:=v_ticket.title;
 v_new_description:=v_ticket.description;
 -- Only rewrite a leading, generated room label, not other room references in free text.
 IF v_old_number<>'' AND pg_catalog.left(v_new_title,pg_catalog.length('Room '||v_old_number||':'))='Room '||v_old_number||':' THEN
  v_new_title:='Room '||v_new_number||':'||pg_catalog.substr(v_new_title,pg_catalog.length('Room '||v_old_number||':')+1);
 END IF;
 IF v_old_number<>'' AND pg_catalog.left(v_new_title,pg_catalog.length(v_old_number||' '))=v_old_number||' ' THEN
  v_new_title:=v_new_number||pg_catalog.substr(v_new_title,pg_catalog.length(v_old_number)+1);
 END IF;
 IF v_old_number<>'' AND pg_catalog.left(v_new_description,pg_catalog.length(v_old_number||' '))=v_old_number||' ' THEN
  v_new_description:=v_new_number||pg_catalog.substr(v_new_description,pg_catalog.length(v_old_number)+1);
 END IF;

 -- A generated title repeats the description after its room prefix.
 -- Keep both references consistent when the description starts with the old room.
 IF v_old_number<>'' AND v_ticket.title =
     'Room '||v_old_number||': '||coalesce(v_ticket.description,'') THEN
  v_new_title:='Room '||v_new_number||': '||v_new_description;
 END IF;

 -- Preserve original source_assignment_id as historical attribution; link current room properly.
 UPDATE public.tickets
 SET room_number=v_new_number, title=v_new_title, description=v_new_description,
     source_room_id=CASE WHEN source_room_id IS NOT NULL THEN v_room.id ELSE NULL END
 WHERE id=v_ticket.id;

 INSERT INTO public.maintenance_room_change_audit
  (ticket_id,organization_slug,hotel,old_room_number,new_room_number,changed_by,source,
   old_title,old_description,old_source_room_id)
 VALUES (v_ticket.id,v_ticket.organization_slug,v_ticket.hotel,v_old_number,v_new_number,auth.uid(),
  'supervisor',v_ticket.title,v_ticket.description,v_ticket.source_room_id);

 INSERT INTO public.comments(ticket_id,user_id,organization_slug,content)
 VALUES (v_ticket.id,auth.uid(),v_ticket.organization_slug,
  '[Maintenance room correction] Room '||coalesce(nullif(v_old_number,''),'not set')||
  ' → '||v_new_number||'. The assigned room has been corrected; original issue history is preserved.');

 SELECT h.hotel_id,h.hotel_name INTO v_hotel_id,v_hotel_name
 FROM public.hotel_configurations h
 WHERE v_ticket.hotel IN (h.hotel_id,h.hotel_name) LIMIT 1;
 SELECT coalesce(pg_catalog.array_agg(DISTINCT p.id),'{}'::uuid[]) INTO v_recipients
 FROM public.profiles p
 WHERE p.deleted_at IS NULL AND p.organization_slug=v_ticket.organization_slug
   AND p.id IS DISTINCT FROM auth.uid()
   AND (p.id IN (v_ticket.assigned_to,v_ticket.created_by)
        OR (p.role::text IN ('maintenance','manager','housekeeping_manager',
               'maintenance_manager','reception_manager','supervisor',
               'top_management','top_management_manager')
            AND (p.assigned_hotel IN (v_ticket.hotel,v_hotel_id,v_hotel_name)
                 OR p.hotel_id IN (v_ticket.hotel,v_hotel_id,v_hotel_name)
                 OR (p.role::text='top_management'))));
 IF pg_catalog.array_length(v_recipients,1)>0 THEN
  PERFORM public.hotelcare_dispatch_push(v_recipients,
   'Maintenance room corrected',
   pg_catalog.left(coalesce(v_ticket.ticket_number,'Maintenance ticket')||
      ' · Room '||coalesce(nullif(v_old_number,''),'?')||' → '||v_new_number||
      ' · '||coalesce(v_ticket.hotel,'Hotel'),180),
   '/'||v_ticket.organization_slug||'?tab=tickets&maintenanceIssue='||v_ticket.id::text,
   'maintenance-room-'||v_ticket.id::text,'maintenance_room_changed',
   pg_catalog.jsonb_build_object('ticketId',v_ticket.id,'hotel',v_ticket.hotel,
              'oldRoom',v_old_number,'newRoom',v_new_number));
 END IF;
END;
$function$
