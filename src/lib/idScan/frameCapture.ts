/**
 * Copy the current camera frame / loaded image before unmounting its element.
 * An async OCR worker must never read directly from a stopped MediaStream:
 * Safari may replace that frame with black as soon as its tracks stop.
 *
 * This image stays in an in-memory canvas on the same device. The caller is
 * responsible for wiping it when OCR finishes.
 */
export function snapshotFrame(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid document frame dimensions');
  }
  const scale = Math.min(1, 2400 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');
  context.drawImage(source, 0, 0, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}
