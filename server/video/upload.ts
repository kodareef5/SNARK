// A clip's or a still's way into the library: the file streamed to disk under a running cap and hashed as it comes,
// checked (an MP4 moved to play while it downloads), and held until the admin page sends its title, rights line,
// poster and colour track.
import { closeSync, openSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { CLIP_MAX_BYTES, COLOUR_PARTS, COLOUR_RATE, IMAGE_MAX_BYTES, SCREENS, clipId, isClipId, isScreenType, type Clip, type ScreenType } from "../../shared/video/clip.ts";
import { IMAGE_EXT, probeImage } from "../../shared/video/image.ts";
import type { Mp4Info } from "../../shared/video/mp4.ts";
import { entryReply, readEntryJson } from "../survivor-access.ts";
import { slugOf, type VideoLibrary } from "./library.ts";

export const POSTER_BYTES_MAX = 64 * 1024;
const TITLE_MAX = 80;
const RIGHTS_MAX = 240;

let uploads = 0;
/** The most ms an upload's receiving runs before it lets the event loop turn. */
const YIELD_MS = 2;

/** What the MP4 thread is asked: the received file, and where to write it moved to faststart if it is not. */
export interface ToMp4 {
  readonly src: string;
  readonly part: string;
}
/** What it answers: the boxes' info, a sentence saying why the clip may not be shown, or a fault of its own. */
export type FromMp4 = { readonly info: Mp4Info } | { readonly error: string } | { readonly fault: string };

/**
 * Checks a received MP4 on a thread of its own, and writes it to `part` moved to faststart where it is not already so.
 * One thread to an upload, so the file's bytes go when it ends.
 */
export function inspectMp4(src: string, part: string): Promise<FromMp4> {
  const worker = new Worker(new URL("./mp4-worker.ts", import.meta.url).href);
  return new Promise<FromMp4>((resolve) => {
    worker.onmessage = (e: MessageEvent<FromMp4>) => resolve(e.data);
    worker.onerror = (e) => resolve({ fault: e.message || "the clip's thread failed" });
    worker.postMessage({ src, part } satisfies ToMp4);
  }).finally(() => worker.terminate());
}

/** A body streamed to a file in `tmp` under a running cap and hashed as it came: its file, its size and its id. */
export interface Received {
  readonly tmp: string;
  readonly size: number;
  readonly id: string;
}

/** Reads an upload's raw body to disk, or answers why not. `what` names it in the answers ("A clip"). */
export async function receive(req: Request, lib: VideoLibrary, cap: number, what: string): Promise<Received | Response> {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  // The length comes first, so a body over the cap is not read: a browser sending a File always says it.
  const length = Number(req.headers.get("content-length") ?? Number.NaN);
  const tooBig = (): Response => entryReply({ error: `${what} is ${cap / 1048576} MB at most.` }, 413);
  if (!(length > 0)) return entryReply({ error: "An upload says its length." }, 411);
  if (length > cap) return tooBig();
  const reader = req.body?.getReader();
  if (!reader) return entryReply({ error: "The upload was empty." }, 400);
  const tmp = join(lib.tmp, `upload-${process.pid}-${++uploads}`), hash = new Bun.CryptoHasher("sha256");
  const fd = openSync(tmp, "w");
  let size = 0, over = false, ran = performance.now();
  try {
    for (;;) {
      // A body already buffered resolves read after read without a turn of the loop, so the tick's timer is let in.
      if (performance.now() - ran > YIELD_MS) (await new Promise<void>((r) => setTimeout(r, 0)), (ran = performance.now()));
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > cap) {
        over = true;
        await reader.cancel();
        break;
      }
      hash.update(value);
      for (let at = 0; at < value.length; ) at += writeSync(fd, value, at);
    }
  } catch {
    closeSync(fd);
    rmSync(tmp, { force: true });
    return entryReply({ error: "The upload broke off." }, 400);
  }
  closeSync(fd);
  if (over || size === 0) {
    rmSync(tmp, { force: true });
    return over ? tooBig() : entryReply({ error: "The upload was empty." }, 400);
  }
  return { tmp, size, id: clipId(hash.digest("hex")) };
}

/** POST /admin/screens/upload?name=<title>: the raw MP4. Answers what its boxes say, and the id to publish it by. */
export async function takeUpload(req: Request, lib: VideoLibrary): Promise<Response> {
  const got = await receive(req, lib, CLIP_MAX_BYTES, "A clip");
  if (got instanceof Response) return got;
  const { tmp, id } = got;
  try {
    if (lib.view().all.has(id)) return entryReply({ error: "That clip is in the library already.", id }, 409);
    const part = join(lib.tmp, `clip-${process.pid}-${++uploads}`);
    const checked = await inspectMp4(tmp, part);
    if ("fault" in checked) {
      await rm(part, { force: true });
      return entryReply({ error: "The clip could not be checked. Try again." }, 500);
    }
    if ("error" in checked) return entryReply({ error: checked.error }, 422);
    const { info } = checked;
    const name = `${slugOf(new URL(req.url).searchParams.get("name") ?? "")}.${id}.mp4`, file = join(lib.media, name);
    // A large file's unlink, here or where it replaces one, waits on the disk, so it is done off the loop.
    await rename(info.faststart ? tmp : part, file);
    lib.addPending({ id, file: `/media/${name}`, width: info.width, height: info.height, seconds: info.seconds, kbps: info.kbps, bytes: statSync(file).size, audio: info.audio, at: Date.now() });
    return entryReply({ id, width: info.width, height: info.height, seconds: info.seconds, kbps: info.kbps, audio: info.audio });
  } finally {
    await rm(tmp, { force: true });
  }
}

/** POST /admin/screens/image?name=<title>: the raw PNG, JPEG or WebP. Answers its type and size, and the id to publish it by. */
export async function takeImage(req: Request, lib: VideoLibrary): Promise<Response> {
  const got = await receive(req, lib, IMAGE_MAX_BYTES, "An image");
  if (got instanceof Response) return got;
  const { tmp, id, size } = got;
  try {
    if (lib.view().all.has(id)) return entryReply({ error: "That image is in the library already.", id }, 409);
    const info = probeImage(await Bun.file(tmp).bytes());
    if (typeof info === "string") return entryReply({ error: info }, 422);
    const name = `${slugOf(new URL(req.url).searchParams.get("name") ?? "", "image")}.${id}.${IMAGE_EXT[info.type]}`;
    renameSync(tmp, join(lib.media, name));
    lib.addPending({ id, file: `/media/${name}`, width: info.width, height: info.height, seconds: 0, kbps: 0, bytes: size, audio: false, at: Date.now(), kind: "image" });
    return entryReply({ id, kind: "image", type: info.type, width: info.width, height: info.height, bytes: size });
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Base64 to bytes, or null for what is not base64. */
function base64(text: unknown): Uint8Array | null {
  if (typeof text !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) return null;
  return new Uint8Array(Buffer.from(text, "base64"));
}

const isJpeg = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;

/** A one-line text field: trimmed, within `most` letters, or null. */
function line(text: unknown, most: number): string | null {
  if (typeof text !== "string") return null;
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 0 && t.length <= most ? t : null;
}

/** The types an item is offered on, as a page sent them, or a sentence saying what they may be. Absent is `fallback`. */
export function typesOf(sent: unknown, fallback: readonly ScreenType[] | undefined): ScreenType[] | undefined | string {
  if (sent === undefined) return fallback && [...fallback];
  if (!Array.isArray(sent) || sent.length === 0 || !sent.every(isScreenType) || new Set(sent).size !== sent.length) return `Offer it on one or more of ${SCREENS.join(", ")}, each once.`;
  return SCREENS.filter((s) => sent.includes(s));
}

/** The types an image is offered on where its page says none: every type but the ball. */
export const IMAGE_TYPES_DEFAULT: readonly ScreenType[] = SCREENS.filter((s) => s !== "orb");

/**
 * POST /admin/screens/clip {id, title, rights, poster, colours, types?}: publishes an upload, a clip's or an image's.
 * An image's colour track is one sample. Answers the item.
 */
export async function publishClip(req: Request, lib: VideoLibrary): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await readEntryJson(req, 4 * POSTER_BYTES_MAX + 256 * 1024);
  } catch {
    return entryReply({ error: "Expected a JSON clip." }, 400);
  }
  const id = typeof body.id === "string" && isClipId(body.id) ? body.id : "";
  const pending = id ? lib.pending(id) : null;
  if (!pending) return entryReply({ error: "That upload is not waiting: send the file again." }, 404);
  const image = pending.kind === "image", noun = image ? "image" : "clip";
  const title = line(body.title, TITLE_MAX), rights = line(body.rights, RIGHTS_MAX);
  if (!title) return entryReply({ error: `Give the ${noun} a title of ${TITLE_MAX} letters at most.` }, 400);
  if (!rights) return entryReply({ error: `Say where the ${noun} is from and why it may be shown.` }, 400);
  const poster = base64(body.poster);
  if (!poster || !isJpeg(poster) || poster.length > POSTER_BYTES_MAX) return entryReply({ error: `The poster is a JPEG of ${POSTER_BYTES_MAX / 1024} KB at most.` }, 400);
  const colours = base64(body.colours), sample = COLOUR_PARTS * 3;
  const samples = colours ? colours.length / sample : 0;
  if (image && samples !== 1) return entryReply({ error: `An image's colour track is one sample of ${sample} bytes.` }, 400);
  if (!colours || !Number.isInteger(samples) || Math.abs(samples - pending.seconds * COLOUR_RATE) > 1) {
    return entryReply({ error: `The colour track holds ${COLOUR_RATE} samples a second of ${sample} bytes, about ${Math.round(pending.seconds * COLOUR_RATE)} in all.` }, 400);
  }
  const types = typesOf(body.types, image ? IMAGE_TYPES_DEFAULT : undefined);
  if (typeof types === "string") return entryReply({ error: types }, 400);
  const served = pending.file.slice("/media/".length);
  // A clip's poster takes its file's name as a JPEG; an image's, which may be a JPEG itself, is named apart.
  const posterName = image ? served.replace(/^([a-z0-9-]+)\.([0-9a-f]{16})\.[a-z]+$/, "$1-poster.$2.jpg") : served.replace(/\.mp4$/, ".jpg");
  writeFileSync(join(lib.media, posterName), poster);
  const clip: Clip = {
    id, title, file: pending.file, poster: `/media/${posterName}`, width: pending.width, height: pending.height,
    seconds: pending.seconds, bytes: pending.bytes, audio: pending.audio, rights, starter: false, colours: body.colours as string,
    ...(image ? { kind: "image" as const } : {}), ...(types ? { types } : {}),
  };
  const done = lib.edit(null, (doc) => (doc.clips.some((c) => c.id === id) ? null : (doc.clips.push(clip), null)));
  if ("error" in done) return entryReply({ error: done.error }, done.status);
  lib.dropPending(id);
  return entryReply(clip);
}
