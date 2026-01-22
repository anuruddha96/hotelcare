-- Restore ricsi.007's role back to manager (was incorrectly reset due to upsert bug)
UPDATE profiles 
SET role = 'manager', updated_at = NOW() 
WHERE nickname = 'ricsi.007';