// Encodes the pictures of the debug bar's port (port.ts) off the game's thread: each a bitmap of the canvas, drawn at its
// size on a canvas of this worker's own and written as JPEG. Bug report mode's port (client/notes/port.ts) loads this
// worker too, and asks a thumbnail with its first picture.

interface Asked { id: number; bitmap: ImageBitmap; w: number; h: number; quality: number; thumb?: [number, number] | null }

const answer = (message: unknown): void => (self as unknown as { postMessage(m: unknown): void }).postMessage(message);

async function encode(bitmap: ImageBitmap, w: number, h: number, quality: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type: "image/jpeg", quality });
}

self.onmessage = async (e: MessageEvent<Asked>) => {
  const { id, bitmap, w, h, quality, thumb } = e.data;
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
