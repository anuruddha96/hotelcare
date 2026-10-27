/**
 * Compress housekeeping camera/gallery evidence before transmitting to Storage.
 * Keeps enough detail for room checks while avoiding multi-megabyte phone photos.
 * Never processes the SVG markers used for permitted skipped room sections.
 */
export function fitHousekeepingImage(width: number, height: number, maxEdge = 1600) {
  if (width <= 0 || height <= 0) throw new Error('Invalid image dimensions');
  const factor = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) };
}

type DecodedImage = ImageBitmap | HTMLImageElement;

async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Older iPhones/HEIC support may use the HTML image decoder instead.
    }
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This photo cannot be decoded. Please capture a new image.'));
    };
    image.src = url;
  });
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to compress image')), 'image/jpeg', quality);
  });
}

/**
 * Output: JPEG, normally <= 500 KiB. Longest edge <= 1600 px, with bounded
 * retries for detailed photos. Never silently uploads an uncompressible file.
 */
export async function compressHousekeepingPhoto(file: Blob): Promise<Blob> {
  if (file.type === 'image/svg+xml') return file; // Only guided skip markers.
  if (!file.type.startsWith('image/')) throw new Error('Only image files can be uploaded');
  if (file.type === 'image/jpeg' && file.size <= 500 * 1024) return file;

  const image = await decodeImage(file);
  const width = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const height = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  const passes = [
    { edge: 1600, quality: 0.76 },
    { edge: 1440, quality: 0.65 },
    { edge: 1280, quality: 0.55 },
  ];
  const canvas = document.createElement('canvas');
  try {
    let result: Blob | null = null;
    for (const pass of passes) {
      const fitted = fitHousekeepingImage(width, height, pass.edge);
      canvas.width = fitted.width;
      canvas.height = fitted.height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Photo compression is unavailable on this device');
      context.fillStyle = '#fff'; // Avoid black backgrounds on transparent PNGs.
      context.fillRect(0, 0, fitted.width, fitted.height);
      context.drawImage(image, 0, 0, fitted.width, fitted.height);
      const encoded = await encodeJpeg(canvas, pass.quality);
      if (!result || encoded.size < result.size) result = encoded;
      if (encoded.size <= 500 * 1024) break;
    }
    if (!result) throw new Error('Photo compression failed');
    return result;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    if ('close' in image && typeof image.close === 'function') image.close();
  }
}
