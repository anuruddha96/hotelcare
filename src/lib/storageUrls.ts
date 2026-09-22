import { supabase } from '@/integrations/supabase/client';

/**
 * Generate signed URLs for ticket attachment photos.
 * Handles both storage paths and existing public/signed URLs.
 *
 * @param photos - Array of photo paths or URLs
 * @param bucketName - Storage bucket name (default: 'ticket-attachments')
 * @param expiresIn - Expiration in seconds (default: 300 = five minutes).
 * A signed URL cannot be revoked merely by ending a duty session; keep its
 * validity short and allow the photo viewer to re-sign when needed.
 */
export async function getSignedPhotoUrls(
  photos: string[] | null | undefined,
  bucketName: string = 'ticket-attachments',
  expiresIn: number = 300
): Promise<string[]> {
  if (!photos || photos.length === 0) return [];

  const signedUrls: string[] = [];

  for (const photo of photos) {
    try {
      if (photo.startsWith('http')) {
        const publicPattern = /\/storage\/v1\/object\/public\/([^/]+)\/(.+?)(?:\?|$)/;
        const signedPattern = /\/storage\/v1\/object\/sign\/([^/]+)\/(.+?)(?:\?|$)/;

        const match = photo.match(publicPattern) || photo.match(signedPattern);
        if (match) {
          const [, bucket, encodedPath] = match;
          const path = decodeURIComponent(encodedPath);
          const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
          if (data?.signedUrl && !error) {
            signedUrls.push(data.signedUrl);
          } else {
            console.warn('Failed to create signed URL for:', path, error);
          }
        } else {
          // Do not render an unverified external URL as ticket evidence.
          console.warn('Unrecognized URL format:', photo);
        }
      } else {
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

/** Extract storage path from a full URL or return the original storage path. */
export function extractStoragePath(url: string): string {
  if (!url.startsWith('http')) return url;

  const pattern = /\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/;
  const match = url.match(pattern);
  return match ? decodeURIComponent(match[1]) : url;
}
