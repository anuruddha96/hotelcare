UPDATE public.rooms
SET
  bed_configuration = NULL,
  pms_metadata = pms_metadata - 'inferredBedConfig',
  updated_at = now()
WHERE pms_metadata ? 'inferredBedConfig'
  AND pms_metadata->'inferredBedConfig'->>'keyword' IN (
    'extra bed','extra cot','cot','crib','twin','twin bed','twin beds',
    'double','double bed','king','queen','king bed','queen bed',
    'single bed','single beds','baby bed','baby cot'
  );