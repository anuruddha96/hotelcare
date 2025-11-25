import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Get storage buckets
    const { data: buckets, error: bucketsError } = await supabaseClient.storage.listBuckets();

    if (bucketsError) {
      throw bucketsError;
    }

    let totalSize = 0;
    let totalFiles = 0;
    const bucketDetails: Array<{ name: string; fileCount: number; sizeMB: number }> = [];

    // Calculate storage for each bucket
    const filesList: Array<{ bucket: string; path: string; name: string; size: number; createdAt: string }> = [];
    
    for (const bucket of buckets || []) {
      try {
        let bucketSize = 0;
        let bucketFiles = 0;

        // Recursively count and list files in all folders
        const listFilesRecursively = async (path: string = '') => {
          const { data } = await supabaseClient.storage
            .from(bucket.name)
            .list(path, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } });

          if (data) {
            for (const item of data) {
              if (item.id) { // it's a file
                const fileSize = item.metadata?.size || 0;
                bucketSize += fileSize;
                bucketFiles++;
                
                // Add to files list for browsing
                filesList.push({
                  bucket: bucket.name,
                  path: path ? `${path}/${item.name}` : item.name,
                  name: item.name,
                  size: fileSize,
                  createdAt: item.created_at || ''
                });
              } else { // it's a folder
                await listFilesRecursively(path ? `${path}/${item.name}` : item.name);
              }
            }
          }
        };

        await listFilesRecursively();

        totalSize += bucketSize;
        totalFiles += bucketFiles;

        bucketDetails.push({
          name: bucket.name,
          fileCount: bucketFiles,
          sizeMB: bucketSize / (1024 * 1024)
        });
      } catch (error) {
        console.error(`Error processing bucket ${bucket.name}:`, error);
      }
    }

    // Get count of photos that will be cleaned up next run
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const cutoffDate = threeDaysAgo.toISOString();

    const { count: dndCount } = await supabaseClient
      .from('dnd_photos')
      .select('*', { count: 'exact', head: true })
      .lt('marked_at', cutoffDate);

    const { data: oldAssignments } = await supabaseClient
      .from('room_assignments')
      .select('completion_photos')
      .lt('completed_at', cutoffDate)
      .not('completion_photos', 'is', null);

    let completionPhotosCount = 0;
    if (oldAssignments) {
      for (const assignment of oldAssignments) {
        if (assignment.completion_photos && Array.isArray(assignment.completion_photos)) {
          completionPhotosCount += assignment.completion_photos.length;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        totalSizeMB: totalSize / (1024 * 1024),
        totalSizeGB: totalSize / (1024 * 1024 * 1024),
        totalFiles,
        buckets: bucketDetails,
        files: filesList,
        pendingCleanup: {
          dndPhotos: dndCount || 0,
          completionPhotos: completionPhotosCount,
          total: (dndCount || 0) + completionPhotosCount
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Storage status error:', error);
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
