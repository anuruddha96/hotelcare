/** Validation for manager evidence. No image is mandatory when a written reason exists. */
export const MAX_RECHECK_PHOTOS = 10;
export const MAX_RECHECK_PHOTO_BYTES = 8 * 1024 * 1024;

export const RECHECK_PHOTO_BUCKET = 'manager-recheck-evidence';

export type RecheckPhotoSelection = { accepted: File[]; error?: string };

export function addRecheckPhotos(current: File[], incoming: File[]): RecheckPhotoSelection {
  const accepted = [...current];
  for (const file of incoming) {
    const type = file.type.toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(type)) {
      return { accepted, error: 'Use JPG, PNG, WebP or HEIC photos.' };
    }
    if (file.size > MAX_RECHECK_PHOTO_BYTES) {
      return { accepted, error: 'Each photo must be 8 MB or smaller.' };
    }
    if (accepted.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) continue;
    if (accepted.length === MAX_RECHECK_PHOTOS) {
      return { accepted, error: 'You can attach up to 10 photos.' };
    }
    accepted.push(file);
  }
  return { accepted };
}

export function recheckEvidencePath(userId: string, assignmentId: string, file: File, index: number): string {
  const ext = file.type.toLowerCase() === 'image/png' ? 'png'
    : file.type.toLowerCase() === 'image/webp' ? 'webp'
    : ['image/heic', 'image/heif'].includes(file.type.toLowerCase()) ? 'heic'
    : 'jpg';
  return `${userId}/${assignmentId}/${Date.now()}-${index}-${crypto.randomUUID()}.${ext}`;
}

export function canSubmitRecheck(assignee: string, reason: string, photos: File[]): boolean {
  return Boolean(assignee) && (Boolean(reason.trim()) || photos.length > 0);
}

/** Shrink large camera photos before upload for faster mobile submission.
 * The untouched original is used if the browser cannot decode or convert it.
 * Drawing onto canvas also avoids retaining camera location EXIF metadata.
 */
export async function optimizeRecheckPhoto(file: File): Promise<File> {
  if (file.size < 750_000 || typeof document === 'undefined' || typeof createImageBitmap !== 'function') return file;
  let image: ImageBitmap | null = null;
  try {
    image = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.84));
    if (!blob || blob.size >= file.size) return file;
    const filename = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], filename, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    image?.close();
  }
}
