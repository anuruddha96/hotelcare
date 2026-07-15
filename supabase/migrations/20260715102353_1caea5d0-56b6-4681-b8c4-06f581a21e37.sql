ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS acts_as_housekeeper boolean NOT NULL DEFAULT false;
UPDATE public.profiles SET acts_as_housekeeper = true WHERE nickname = 'Nykipanchuk_073';