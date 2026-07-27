
UPDATE public.profiles
   SET deleted_at = COALESCE(deleted_at, now())
 WHERE id = '0df00192-2518-4adb-9527-e01b60b19b55';
