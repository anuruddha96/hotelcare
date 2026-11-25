import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHrPersonnelHandler } from './handler.ts';
Deno.serve(createHrPersonnelHandler(createClient, key => Deno.env.get(key)));
