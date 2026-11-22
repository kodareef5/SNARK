// Encodes bug report mode's pictures off the game's thread (port.ts): each a bitmap of the canvas, scaled to its size
// and to its thumbnail's on a canvas of this worker's own and written as JPEG.

interface Asked { id: number; bitmap: ImageBitmap; w: number; h: number; thumb: [number, number] | null; quality: number }

const answer = (message: unknown): void => (self as unknown as { postMessage(m: unknown): void }).postMessage(message);

async function encode(bitmap: ImageBitmap, w: number, h: number, quality: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: "image/jpeg", quality });
}

self.onmessage = async (e: MessageEvent<Asked>) => {
  const { id, bitmap, w, h, thumb, quality } = e.data;
  try {
    const jpeg = await encode(bitmap, w, h, quality);
    const small = thumb ? await encode(bitmap, thumb[0], thumb[1], quality) : null;
    answer({ id, jpeg, thumb: small, why: "" });
  } catch (err) {
    answer({ id, jpeg: null, thumb: null, why: err instanceof Error ? err.message : String(err) });
  } finally {
    bitmap.close();
  }
};
