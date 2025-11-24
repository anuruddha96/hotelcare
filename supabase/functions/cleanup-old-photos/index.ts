import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeleteResult {
  deletedDndPhotos: number;
  deletedCompletionPhotos: number;
  deletedStorageFiles: number;
  errors: string[];
  storageFreedMB: number;
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

    // Calculate date 3 days ago
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const cutoffDate = threeDaysAgo.toISOString();

    console.log(`Cleaning up photos older than ${cutoffDate}`);

    const result: DeleteResult = {
      deletedDndPhotos: 0,
      deletedCompletionPhotos: 0,
      deletedStorageFiles: 0,
      errors: [],
      storageFreedMB: 0,
    };

    // 1. Clean up DND photos older than 3 days
    const { data: oldDndPhotos, error: dndError } = await supabaseClient
      .from('dnd_photos')
      .select('id, photo_url')
      .lt('marked_at', cutoffDate);

    if (dndError) {
      result.errors.push(`Error fetching DND photos: ${dndError.message}`);
      console.error('DND fetch error:', dndError);
    } else if (oldDndPhotos && oldDndPhotos.length > 0) {
      console.log(`Found ${oldDndPhotos.length} DND photos to delete`);
      
      // Delete from storage
      for (const photo of oldDndPhotos) {
        if (photo.photo_url) {
          const deleted = await deleteFromStorage(supabaseClient, photo.photo_url, result);
          if (deleted) result.deletedStorageFiles++;
        }
      }

      // Delete records from database
      const { error: deleteError } = await supabaseClient
        .from('dnd_photos')
        .delete()
        .lt('marked_at', cutoffDate);

      if (deleteError) {
        result.errors.push(`Error deleting DND photos from DB: ${deleteError.message}`);
      } else {
        result.deletedDndPhotos = oldDndPhotos.length;
      }
    }

    // 2. Clean up completion photos from room_assignments older than 3 days
    const { data: oldAssignments, error: assignmentError } = await supabaseClient
      .from('room_assignments')
      .select('id, completion_photos')
      .lt('completed_at', cutoffDate)
      .not('completion_photos', 'is', null);

    if (assignmentError) {
      result.errors.push(`Error fetching assignments: ${assignmentError.message}`);
      console.error('Assignment fetch error:', assignmentError);
    } else if (oldAssignments && oldAssignments.length > 0) {
      console.log(`Found ${oldAssignments.length} assignments with completion photos to clean`);
      
      let photoCount = 0;
      // Delete completion photos from storage
      for (const assignment of oldAssignments) {
        if (assignment.completion_photos && Array.isArray(assignment.completion_photos)) {
          for (const photoUrl of assignment.completion_photos) {
            if (photoUrl) {
              const deleted = await deleteFromStorage(supabaseClient, photoUrl, result);
              if (deleted) {
                result.deletedStorageFiles++;
                photoCount++;
              }
            }
          }
        }
      }

      // Clear completion_photos array in database
      const { error: updateError } = await supabaseClient
        .from('room_assignments')
        .update({ completion_photos: [] })
        .lt('completed_at', cutoffDate);

      if (updateError) {
        result.errors.push(`Error clearing completion photos: ${updateError.message}`);
      } else {
        result.deletedCompletionPhotos = photoCount;
      }
    }

    console.log('Cleanup complete:', result);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Cleanup completed. Deleted ${result.deletedDndPhotos} DND photos, ${result.deletedCompletionPhotos} completion photos, and ${result.deletedStorageFiles} storage files (~${result.storageFreedMB.toFixed(2)} MB freed)`,
        details: result,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Cleanup function error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        details: 'An unexpected error occurred during cleanup'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

async function deleteFromStorage(
  supabaseClient: any,
  photoUrl: string,
  result: DeleteResult
): Promise<boolean> {
  try {
    // Extract bucket and path from URL
    const urlParts = photoUrl.split('/storage/v1/object/public/');
    if (urlParts.length >= 2) {
      // Full URL format with /storage/v1/object/public/
      const [bucket, ...pathParts] = urlParts[1].split('/');
      return await deleteFile(supabaseClient, bucket, pathParts.join('/'), result);
    }
    
    // Try alternative format /object/public/
    const altParts = photoUrl.split('/object/public/');
    if (altParts.length >= 2) {
      const [bucket, ...pathParts] = altParts[1].split('/');
      return await deleteFile(supabaseClient, bucket, pathParts.join('/'), result);
    }
    
    // Handle relative path format (old format): hotel-id/assignment-id/filename
    // These are typically from room-photos bucket
    if (!photoUrl.startsWith('http') && photoUrl.includes('/')) {
      console.log(`Processing relative path: ${photoUrl}`);
      return await deleteFile(supabaseClient, 'room-photos', photoUrl, result);
    }
    
    result.errors.push(`Invalid photo URL format: ${photoUrl}`);
    return false;
  } catch (error) {
    result.errors.push(`Error parsing photo URL ${photoUrl}: ${error.message}`);
    return false;
  }
}

async function deleteFile(
  supabaseClient: any,
  bucket: string,
  filePath: string,
  result: DeleteResult
): Promise<boolean> {
  try {
    // Get file size before deletion
    const { data: fileData } = await supabaseClient.storage
      .from(bucket)
      .list(filePath.split('/').slice(0, -1).join('/'), {
        search: filePath.split('/').pop()
      });

    if (fileData && fileData.length > 0) {
      const fileSize = fileData[0].metadata?.size || 0;
      result.storageFreedMB += fileSize / (1024 * 1024);
    }

    const { error } = await supabaseClient.storage
      .from(bucket)
      .remove([filePath]);

    if (error) {
      result.errors.push(`Storage deletion error for ${filePath}: ${error.message}`);
      return false;
    }
    
    console.log(`Deleted file: ${bucket}/${filePath}`);
    return true;
  } catch (error) {
    result.errors.push(`File deletion error: ${error.message}`);
    return false;
  }
}
