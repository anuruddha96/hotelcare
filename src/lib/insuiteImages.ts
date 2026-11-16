/** Compress guest-facing property images before sending them to HotelCare.
 * Reduces storage/egress; original files are never uploaded.
 */
export async function prepareInSuiteImage(file: File, kind: "logo" | "hero"): Promise<string> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    throw new Error("Choose a JPG, PNG, HEIC-compatible or WebP photo (SVG is not accepted).");
  }
  if (file.size > 25 * 1024 * 1024) throw new Error("Choose an image smaller than 25 MB.");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const limit = kind === "logo" ? 960 : 1600;
    const aspect = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
    let scale = aspect;
    for (let pass = 0; pass < 5; pass++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Browser image compression is unavailable.");
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", pass < 2 ? 0.82 : 0.68));
      if (!blob || blob.type !== "image/webp") throw new Error("Please use a browser with WebP image support.");
      if (blob.size <= 550 * 1024) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Could not read compressed image."));
          reader.readAsDataURL(blob);
        });
        return dataUrl;
      }
      scale *= 0.75;
    }
    throw new Error("Image could not be compressed below 550 KB. Try another photo.");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
