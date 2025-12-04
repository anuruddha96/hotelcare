-- Add unique constraint on nickname within organization to prevent duplicate usernames
-- Using a partial unique index since nickname can be NULL
CREATE UNIQUE INDEX IF NOT EXISTS profiles_nickname_org_unique 
ON profiles (LOWER(nickname), organization_slug) 
WHERE nickname IS NOT NULL;