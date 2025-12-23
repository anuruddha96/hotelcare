import { supabase } from '@/integrations/supabase/client';

/**
 * Generate signed URLs for ticket attachment photos
 * Handles both storage paths and existing public URLs
 */
export async function getSignedPhotoUrls(
  photos: string[] | null | undefined,
  bucketName: string = 'ticket-attachments',
  expiresIn: number = 3600
): Promise<string[]> {
  if (!photos || photos.length === 0) return [];
  
  const signedUrls: string[] = [];
  
  for (const photo of photos) {
    try {
      // If it's already a full URL (starts with http), check if it's a supabase storage URL
      if (photo.startsWith('http')) {
        // Check if it's a Supabase storage URL that might need signing
        const storageUrlPattern = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)/;
        const match = photo.match(storageUrlPattern);
        
        if (match) {
          // Extract bucket and path, create signed URL
          const [, bucket, path] = match;
          const { data } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
          if (data?.signedUrl) {
            signedUrls.push(data.signedUrl);
          } else {
            signedUrls.push(photo); // Fallback to original
          }
        } else {
          signedUrls.push(photo); // Not a storage URL, use as-is
        }
      } else {
        // It's a storage path, create signed URL
        const { data } = await supabase.storage.from(bucketName).createSignedUrl(photo, expiresIn);
        if (data?.signedUrl) {
          signedUrls.push(data.signedUrl);
        }
      }
    } catch (error) {
      console.error('Error generating signed URL for:', photo, error);
      // Try using the path directly if it fails
      if (!photo.startsWith('http')) {
        const { data: publicUrl } = supabase.storage.from(bucketName).getPublicUrl(photo);
        if (publicUrl?.publicUrl) {
          signedUrls.push(publicUrl.publicUrl);
        }
      }
    }
  }
  
  return signedUrls;
}

/**
 * Extract storage path from a full URL or return the path if already a path
 */
export function extractStoragePath(url: string): string {
  if (!url.startsWith('http')) return url;
  
  // Match Supabase storage URL pattern
  const pattern = /\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/;
  const match = url.match(pattern);
  
  return match ? match[1] : url;
}
