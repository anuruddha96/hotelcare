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
