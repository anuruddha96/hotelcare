import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeleteRequest {
  bucket: string;
  files: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { bucket, files }: DeleteRequest = await req.json();

    if (!bucket || !files || files.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Bucket and files array are required' 
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    console.log(`Deleting ${files.length} files from bucket: ${bucket}`);

    // Process files in batches of 100 to avoid timeouts
    const BATCH_SIZE = 100;
    let totalDeleted = 0;
    const errors = [];

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(files.length / BATCH_SIZE)}: ${batch.length} files`);
      
      const { error } = await supabaseClient.storage
        .from(bucket)
        .remove(batch);

      if (error) {
        console.error(`Batch delete error:`, error);
        errors.push({ batch: Math.floor(i / BATCH_SIZE) + 1, error: error.message });
      } else {
        totalDeleted += batch.length;
      }
    }

    const hasErrors = errors.length > 0;
    console.log(`Completed: ${totalDeleted}/${files.length} files deleted${hasErrors ? ` (${errors.length} batches failed)` : ''}`);

    return new Response(
      JSON.stringify({
        success: !hasErrors || totalDeleted > 0,
        deletedCount: totalDeleted,
        totalRequested: files.length,
        errors: hasErrors ? errors : undefined,
        message: `Successfully deleted ${totalDeleted} of ${files.length} files${hasErrors ? ` (${errors.length} batches had errors)` : ''}`
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: hasErrors && totalDeleted === 0 ? 500 : 200,
      }
    );
  } catch (error) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
