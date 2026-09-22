export const MAX_COMPLETION_PHOTOS = 10;
export const MAX_COMPLETION_PHOTO_BYTES = 15 * 1024 * 1024;

/** Always append unique paths; resubmission must never erase earlier evidence. */
export function mergeCompletionPhotos(existing: string[] | null | undefined, uploaded: string[]): string[] {
  return [...new Set([...(existing || []), ...uploaded].filter(Boolean))];
}

export function validateCompletionFiles(files: Pick<File, 'type' | 'size'>[]): string | null {
  if (!files.length) return 'At least one after-repair photo is required.';
  if (files.length > MAX_COMPLETION_PHOTOS) return `Maximum ${MAX_COMPLETION_PHOTOS} photos per submission.`;
  if (files.some(file => !file.type.startsWith('image/'))) return 'Only image files are supported.';
  if (files.some(file => file.size <= 0 || file.size > MAX_COMPLETION_PHOTO_BYTES)) {
    return 'Each photo must be smaller than 15 MB and must not be empty.';
  }
  return null;
}
