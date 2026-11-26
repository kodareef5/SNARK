// An uploaded print checked without decoding it. Only the chunks' frames, their CRCs and the header are read; the picture
// data is never inflated, so a zip bomb in it costs nothing here, and the browser that draws it inflates no more than the
// header's size allows. The check, the hash and the file's writing run on a thread of their own (png-worker.ts), so an
// upload costs the world's thread a copy of the body and a rename.
import { PRINT_BYTES_MAX, PRINT_SIDE_MAX } from "../../shared/people/doc.ts";

/** What a print's file is, once checked. */
export interface PrintInfo {
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  /** The first 16 hex digits of its SHA-256. */
  readonly hash: string;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** The bit depths each colour type may have: 8-bit samples, or fewer for grey and a palette. 16-bit is refused. */
const DEPTHS: Readonly<Record<number, readonly number[]>> = { 0: [1, 2, 4, 8], 2: [8], 3: [1, 2, 4, 8], 4: [8], 6: [8] };
/** Chunks of an animated PNG: a print is one still picture. */
const ANIMATED = new Set(["acTL", "fcTL", "fdAT"]);

const typeOf = (b: Uint8Array, at: number): string => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
const letter = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

/** The width and height a PNG's header gives, or null where the bytes do not begin as a PNG does. */
export function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 24 || !SIGNATURE.every((x, i) => b[i] === x) || typeOf(b, 12) !== "IHDR") return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

/** What `b` is as a print, without its hash, or a sentence saying why it may not be one. */
export function checkPng(b: Uint8Array): { width: number; height: number } | string {
  if (b.length > PRINT_BYTES_MAX) return `A print is ${Math.round(PRINT_BYTES_MAX / 1024)} KB at most.`;
  if (b.length < 8 || !SIGNATURE.every((x, i) => b[i] === x)) return "This is not a PNG.";
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let width = 0, height = 0, colour = -1, depth = 0, palette = false, idat = 0, idatEnded = false;
  for (let at = 8, n = 0; ; n++) {
    if (at === b.length) return "This PNG stops before its end chunk.";
    if (at + 12 > b.length) return "This PNG stops inside a chunk.";
    const length = v.getUint32(at);
    if (length > b.length - at - 12) return "A chunk of this PNG runs past its end.";
    const type = typeOf(b, at + 4);
    if (![...type].every((c) => letter(c.charCodeAt(0))) || (b[at + 6]! & 0x20) !== 0) return "This PNG has a chunk with a broken name.";
    if ((Bun.hash.crc32(b.subarray(at + 4, at + 8 + length)) >>> 0) !== v.getUint32(at + 8 + length)) return `The ${type} chunk of this PNG fails its CRC.`;
    const data = at + 8;
    if (n === 0 && type !== "IHDR") return "This PNG does not begin with its header.";
    if (idat > 0 && type !== "IDAT") idatEnded = true;
    switch (type) {
      case "IHDR": {
        if (n !== 0) return "This PNG has a second header.";
        if (length !== 13) return "This PNG's header is the wrong length.";
        width = v.getUint32(data);
        height = v.getUint32(data + 4);
        depth = b[data + 8]!;
        colour = b[data + 9]!;
        if (width === 0 || height === 0 || width > PRINT_SIDE_MAX || height > PRINT_SIDE_MAX) return `A print is 1 to ${PRINT_SIDE_MAX} pixels a side; this one is ${width} x ${height}.`;
        if (width !== height && width !== 2 * height) return `A print is square or twice as wide as high; this one is ${width} x ${height}.`;
        if (!DEPTHS[colour]?.includes(depth)) return "A print's PNG is 8 bits a sample, or a palette or grey picture of fewer.";
        if (b[data + 10] !== 0 || b[data + 11] !== 0 || b[data + 12]! > 1) return "This PNG's header names a method there is not.";
        break;
      }
      case "PLTE":
        if (palette) return "This PNG has two palettes.";
        if (idat > 0) return "This PNG's palette comes after its picture.";
        if (colour === 0 || colour === 4) return "A grey PNG has no palette.";
        if (length === 0 || length % 3 !== 0 || length / 3 > 256 || (colour === 3 && length / 3 > 1 << depth)) return "This PNG's palette is the wrong length.";
        palette = true;
        break;
      case "IDAT":
        if (idatEnded) return "This PNG's picture is split by other chunks.";
        if (colour === 3 && !palette) return "This palette PNG has no palette.";
        idat++;
        break;
      case "IEND":
        if (length !== 0) return "This PNG's end chunk is not empty.";
        if (idat === 0) return "This PNG has no picture.";
        if (data + 4 !== b.length) return "This PNG has bytes after its end.";
        return { width, height };
      default:
        if (ANIMATED.has(type)) return "A print is one still picture, not an animated PNG.";
        // A chunk a reader must understand, which no PNG reader knows.
        if ((b[at + 4]! & 0x20) === 0) return `This PNG has a chunk ${type} no reader knows.`;
    }
    at = data + length + 4;
  }
}

/** The 16 hex digits a file is named by. */
export const hashOf = (b: Uint8Array): string => new Bun.CryptoHasher("sha256").update(b).digest("hex").slice(0, 16);

/** What a print's thread is asked: the body's bytes, given over, and the file to write them to once they pass. */
export interface ToPrint {
  readonly seq: number;
  readonly bytes: ArrayBuffer;
  readonly part: string;
}
/** What it answers: the print, why it may not be one, or a fault of its own. */
export type FromPrint = { readonly seq: number } & ({ readonly info: PrintInfo } | { readonly error: string } | { readonly fault: string });

/** One thread for every upload of a store, made at the first and let go when the store closes. */
export class PrintThread {
  private worker: Worker | null = null;
  private seq = 0;
  private readonly waiting = new Map<number, (answer: FromPrint) => void>();

  /** Checks and hashes `bytes` on the thread, which writes them to `part` if they pass. The buffer is given over. */
  check(bytes: ArrayBuffer, part: string): Promise<FromPrint> {
    const worker = this.thread(), seq = ++this.seq;
    return new Promise<FromPrint>((resolve) => {
      this.waiting.set(seq, resolve);
      worker.postMessage({ seq, bytes, part } satisfies ToPrint, [bytes]);
    });
  }

  private thread(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./png-worker.ts", import.meta.url).href);
    worker.onmessage = (e: MessageEvent<FromPrint>) => {
      const done = this.waiting.get(e.data.seq);
      this.waiting.delete(e.data.seq);
      done?.(e.data);
    };
    worker.onerror = (e) => this.fail(e.message || "the print's thread failed");
    // It does not hold a stopping server open.
    worker.unref();
    return (this.worker = worker);
  }

  /** Answers everything waiting with a fault, and lets the thread go: the next upload makes another. */
  private fail(why: string): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [seq, done] of this.waiting) done({ seq, fault: why });
    this.waiting.clear();
  }

  close(): void {
    this.fail("the store closed");
  }
}
