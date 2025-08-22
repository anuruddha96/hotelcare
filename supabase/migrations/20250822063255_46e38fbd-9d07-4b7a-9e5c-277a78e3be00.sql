-- Add new user roles to the enum (must be done first and committed)
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'marketing';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'control_finance';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'hr';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'front_office';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'top_management';