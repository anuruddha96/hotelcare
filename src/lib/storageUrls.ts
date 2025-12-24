import { supabase } from '@/integrations/supabase/client';

/**
 * Generate signed URLs for ticket attachment photos
 * Handles both storage paths and existing public/signed URLs
 * 
 * @param photos - Array of photo paths or URLs
 * @param bucketName - Storage bucket name (default: 'ticket-attachments')
 * @param expiresIn - Expiration time in seconds (default: 3600 = 1 hour)
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
      // If it's already a full URL (starts with http), extract the path and create signed URL
      if (photo.startsWith('http')) {
        // Check if it's a Supabase storage URL (public or signed)
        const publicPattern = /\/storage\/v1\/object\/public\/([^/]+)\/(.+?)(?:\?|$)/;
        const signedPattern = /\/storage\/v1\/object\/sign\/([^/]+)\/(.+?)(?:\?|$)/;
        
        let match = photo.match(publicPattern) || photo.match(signedPattern);
        
        if (match) {
          // Extract bucket and path, create fresh signed URL
          const [, bucket, encodedPath] = match;
          const path = decodeURIComponent(encodedPath);
          const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
          if (data?.signedUrl && !error) {
            signedUrls.push(data.signedUrl);
          } else {
            console.warn('Failed to create signed URL for:', path, error);
          }
        } else {
          // Not a recognizable storage URL, skip or use as-is if it's an external URL
          console.warn('Unrecognized URL format:', photo);
        }
      } else {
        // It's a storage path (e.g., "ticketId/completion-123.jpg"), create signed URL
        const { data, error } = await supabase.storage.from(bucketName).createSignedUrl(photo, expiresIn);
        if (data?.signedUrl && !error) {
          signedUrls.push(data.signedUrl);
        } else {
          console.warn('Failed to create signed URL for path:', photo, error);
        }
      }
    } catch (error) {
      console.error('Error generating signed URL for:', photo, error);
    }
  }
  
  return signedUrls;
}

/**
 * Extract storage path from a full URL or return the path if already a path
 */
export function extractStoragePath(url: string): string {
  if (!url.startsWith('http')) return url;
  
  // Match Supabase storage URL pattern (both public and signed)
  const pattern = /\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/;
  const match = url.match(pattern);
  
  return match ? decodeURIComponent(match[1]) : url;
}
