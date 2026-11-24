// Encodes the debug bar's pictures off the game's thread (debug-port.ts): each a bitmap of the canvas, drawn at its size
// on a canvas of this worker's own and written as JPEG.

interface Asked { id: number; bitmap: ImageBitmap; w: number; h: number; quality: number }

const answer = (message: unknown): void => (self as unknown as { postMessage(m: unknown): void }).postMessage(message);

self.onmessage = async (e: MessageEvent<Asked>) => {
  const { id, bitmap, w, h, quality } = e.data;
  try {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    answer({ id, jpeg: await canvas.convertToBlob({ type: "image/jpeg", quality }), why: "" });
  } catch (err) {
    answer({ id, jpeg: null, why: err instanceof Error ? err.message : String(err) });
  } finally {
    bitmap.close();
  }
};
