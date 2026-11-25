export type SourceRect = { x: number; y: number; width: number; height: number };

/** Map the centered object-cover preview and its guide, including a small
 * margin measured in preview-box coordinates, back to intrinsic video pixels. */
export function guideCrop(videoWidth: number, videoHeight: number, boxWidth: number, boxHeight: number,
  inset = 0.07, margin = 0.04): SourceRect {
  if (![videoWidth, videoHeight, boxWidth, boxHeight].every(n => Number.isFinite(n) && n > 0)
      || !Number.isFinite(inset) || !Number.isFinite(margin) || inset < 0 || inset >= 0.5 || margin < 0) {
    throw new Error('Invalid document guide dimensions');
  }
  const scale = Math.max(boxWidth / videoWidth, boxHeight / videoHeight);
  const pad = Math.max(0, inset - margin);
  const x = Math.max(0, (videoWidth - boxWidth / scale) / 2 + boxWidth * pad / scale);
  const y = Math.max(0, (videoHeight - boxHeight / scale) / 2 + boxHeight * pad / scale);
  const right = Math.min(videoWidth, x + boxWidth * (1 - 2 * pad) / scale);
  const bottom = Math.min(videoHeight, y + boxHeight * (1 - 2 * pad) / scale);
  return { x, y, width: right - x, height: bottom - y };
}

/** Copy pixels before stopping the MediaStream; never retain a video reference
 * for asynchronous OCR. The caller owns and wipes this in-memory canvas. */
export function snapshotFrame(source: CanvasImageSource, width: number, height: number,
  rect: SourceRect = { x: 0, y: 0, width, height }): HTMLCanvasElement {
  if (![width, height, rect.width, rect.height].every(n => Number.isFinite(n) && n > 0)
      || ![rect.x, rect.y].every(n => Number.isFinite(n) && n >= 0)
      || rect.x + rect.width > width + 0.001 || rect.y + rect.height > height + 0.001) {
    throw new Error('Invalid document frame dimensions');
  }
  const scale = Math.min(1, 2400 / Math.max(rect.width, rect.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');
  context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}
