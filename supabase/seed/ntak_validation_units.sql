-- NTAK validation data ONLY. Run manually in the designated test project.
-- NOT A MIGRATION; not called by CI. Safe to rerun. Does not touch T101-T110/D201-D205
-- or their channel-manager bookings. No production property may run this script.
DO $$
DECLARE
  v_hotel constant text := 'channex-test-property';
  v_org constant text := 'channex';
  v_room record;
  v_type_id uuid;
  v_room_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.hotel_configurations WHERE hotel_id = v_hotel
  ) THEN
    RAISE EXCEPTION 'Refusing NTAK validation seed: expected test hotel does not exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rooms
    WHERE hotel = v_hotel AND room_number IN ('101','102','103','104')
      AND COALESCE(pms_metadata->>'ntak_validation', '') <> 'true'
  ) THEN
    RAISE EXCEPTION 'Refusing seed: one of rooms 101-104 already exists outside the NTAK fixture';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.room_types
    WHERE hotel_id = v_hotel AND name IN ('Standard','Superior','Economy','Apartman')
      AND (is_sellable OR counts_toward_inventory)
  ) THEN
    RAISE EXCEPTION 'Refusing seed: a fixture room type is already used for sale/inventory';
  END IF;

  FOR v_room IN
    SELECT * FROM (VALUES
      ('101','Standard','STANDARD',1,1,0,20000),
      ('102','Superior','SUPERIOR',0,1,0,25000),
      ('103','Economy','ECONOMY',1,1,0,28000),
      ('104','Apartman','APARTMAN',0,1,1,34500)
    ) AS fixture(room_no,type_name,ntak_type,single_beds,double_beds,extra_beds,nightly_huf)
  LOOP
    -- The room-type's EUR price is deliberately zero: test inventory MUST NOT
    -- become sellable. The authoritative NTAK fixture price is stored in HUF
    -- in the room's pms_metadata, without inventing an exchange rate.
    SELECT id INTO v_type_id FROM public.room_types
      WHERE hotel_id = v_hotel AND name = v_room.type_name
        AND is_sellable = false AND counts_toward_inventory = false
      ORDER BY created_at LIMIT 1;
    IF v_type_id IS NULL THEN
      INSERT INTO public.room_types (
        hotel_id, organization_slug, name, base_price_eur,
        is_sellable, counts_toward_inventory, num_rooms
      ) VALUES (
        v_hotel, v_org, v_room.type_name, 0,
        false, false, 0
      ) RETURNING id INTO v_type_id;
    END IF;
    INSERT INTO public.ntak_room_type_units (
      room_type_id, hotel_id, unit_type, capacity, active
    ) VALUES (
      v_type_id, v_hotel, v_room.ntak_type,
      v_room.single_beds + 2 * v_room.double_beds, true
    ) ON CONFLICT (room_type_id) DO UPDATE SET
      unit_type = EXCLUDED.unit_type, capacity = EXCLUDED.capacity,
      active = true, updated_at = now();

    SELECT id INTO v_room_id FROM public.rooms
      WHERE hotel = v_hotel AND room_number = v_room.room_no
        AND pms_metadata->>'ntak_validation' = 'true'
      LIMIT 1;
    IF v_room_id IS NULL THEN
      INSERT INTO public.rooms (
        hotel, organization_slug, room_number, room_name, room_capacity,
        room_type, pms_metadata
      ) VALUES (
        v_hotel, v_org, v_room.room_no, 'NTAK ' || v_room.room_no,
        v_room.single_beds + 2 * v_room.double_beds,
        v_room.type_name,
        jsonb_build_object('ntak_validation',true,'nightly_rate_huf',v_room.nightly_huf)
      ) RETURNING id INTO v_room_id;
    END IF;
    INSERT INTO public.ntak_unit_profiles (
      room_id, hotel_id, building, room_number, unit_type,
      single_beds, double_beds, extra_beds, active
    ) VALUES (
      v_room_id, v_hotel, '1', v_room.room_no, v_room.ntak_type,
      v_room.single_beds, v_room.double_beds, v_room.extra_beds, true
    ) ON CONFLICT (room_id) DO UPDATE SET
      unit_type = EXCLUDED.unit_type,
      single_beds = EXCLUDED.single_beds,
      double_beds = EXCLUDED.double_beds,
      extra_beds = EXCLUDED.extra_beds,
      active = true, updated_at = now();
  END LOOP;
  -- Scope should only be switched on after the feature migration was applied.
  UPDATE public.ntak_settings SET unit_scope = 'profiled_only', updated_at = now()
    WHERE hotel_id = v_hotel AND environment = 'test' AND NOT enabled;
END $$;

-- Review before starting NTAK: 4 active units, total capacity 10. Extra
-- beds (room 104: 1) are reported separately, not included in capacity.
SELECT p.room_number, p.unit_type, p.single_beds, p.double_beds,
       p.extra_beds, p.single_beds + 2*p.double_beds AS capacity
FROM public.ntak_unit_profiles p
WHERE p.hotel_id = 'channex-test-property' AND p.active
ORDER BY p.room_number;
