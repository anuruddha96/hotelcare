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

    // Calculate total size before deletion
    let totalSize = 0;
    for (const filePath of files) {
      try {
        const pathParts = filePath.split('/');
        const fileName = pathParts.pop();
        const folderPath = pathParts.join('/');

        const { data: fileData } = await supabaseClient.storage
          .from(bucket)
          .list(folderPath || undefined, {
            search: fileName
          });

        if (fileData && fileData.length > 0) {
          totalSize += fileData[0].metadata?.size || 0;
        }
      } catch (error) {
        console.error(`Error getting file size for ${filePath}:`, error);
      }
    }

    // Delete files from storage
    const { data, error } = await supabaseClient.storage
      .from(bucket)
      .remove(files);

    if (error) {
      console.error('Delete error:', error);
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

    console.log(`Successfully deleted ${files.length} files, freed ~${(totalSize / (1024 * 1024)).toFixed(2)} MB`);

    return new Response(
      JSON.stringify({
        success: true,
        deletedCount: files.length,
        freedMB: totalSize / (1024 * 1024),
        message: `Successfully deleted ${files.length} files (~${(totalSize / (1024 * 1024)).toFixed(2)} MB freed)`
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
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
