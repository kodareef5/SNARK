// A clip's way into the library: the MP4 streamed to disk under a running cap and hashed as it comes, checked, moved to
// play while it downloads, and held until the admin page sends its title, rights line, poster and colour track.
import { closeSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { CLIP_MAX_BYTES, COLOUR_PARTS, COLOUR_RATE, clipId, isClipId, type Clip } from "../../shared/video/clip.ts";
import { faststartParts, probeMp4 } from "../../shared/video/mp4.ts";
import { entryReply, readEntryJson } from "../survivor-access.ts";
import { slugOf, type VideoLibrary } from "./library.ts";

export const POSTER_BYTES_MAX = 64 * 1024;
const TITLE_MAX = 80;
const RIGHTS_MAX = 240;

let uploads = 0;

/** Writes `parts` to `file` whole, through a file beside it in `tmp`. */
function writeParts(tmp: string, file: string, parts: readonly Uint8Array[]): void {
  const part = join(tmp, `clip-${process.pid}-${++uploads}`);
  const fd = openSync(part, "w");
  try {
    for (const p of parts) for (let at = 0; at < p.length; ) at += writeSync(fd, p, at);
  } finally {
    closeSync(fd);
  }
  renameSync(part, file);
}

/** POST /admin/screens/upload?name=<title>: the raw MP4. Answers what its boxes say, and the id to publish it by. */
export async function takeUpload(req: Request, lib: VideoLibrary): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  // The length comes first, so a body over the cap is not read: a browser sending a File always says it.
  const length = Number(req.headers.get("content-length") ?? Number.NaN);
  if (!(length > 0)) return entryReply({ error: "An upload says its length." }, 411);
  if (length > CLIP_MAX_BYTES) return entryReply({ error: `A clip is ${CLIP_MAX_BYTES / 1048576} MB at most.` }, 413);
  const reader = req.body?.getReader();
  if (!reader) return entryReply({ error: "The upload was empty." }, 400);
  const slug = slugOf(new URL(req.url).searchParams.get("name") ?? "");
  const tmp = join(lib.tmp, `upload-${process.pid}-${++uploads}`), hash = new Bun.CryptoHasher("sha256");
  const fd = openSync(tmp, "w");
  let size = 0, over = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > CLIP_MAX_BYTES) {
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
  try {
    if (over) return entryReply({ error: `A clip is ${CLIP_MAX_BYTES / 1048576} MB at most.` }, 413);
    if (size === 0) return entryReply({ error: "The upload was empty." }, 400);
    const id = clipId(hash.digest("hex"));
    if (lib.view().all.has(id)) return entryReply({ error: "That clip is in the library already.", id }, 409);
    const bytes = new Uint8Array(readFileSync(tmp));
    const info = probeMp4(bytes);
    if (typeof info === "string") return entryReply({ error: info }, 422);
    const parts = faststartParts(bytes);
    if (typeof parts === "string") return entryReply({ error: parts }, 422);
    const name = `${slug}.${id}.mp4`, file = join(lib.media, name);
    if (info.faststart) renameSync(tmp, file);
    else writeParts(lib.tmp, file, parts);
    lib.addPending({ id, file: `/media/${name}`, width: info.width, height: info.height, seconds: info.seconds, kbps: info.kbps, bytes: statSync(file).size, audio: info.audio, at: Date.now() });
    return entryReply({ id, width: info.width, height: info.height, seconds: info.seconds, kbps: info.kbps, audio: info.audio });
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

/** POST /admin/screens/clip {id, title, rights, poster, colours}: publishes an upload. Answers the clip. */
export async function publishClip(req: Request, lib: VideoLibrary): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await readEntryJson(req, 4 * POSTER_BYTES_MAX + 256 * 1024);
  } catch {
    return entryReply({ error: "Expected a JSON clip." }, 400);
  }
  const id = typeof body.id === "string" && isClipId(body.id) ? body.id : "";
  const pending = id ? lib.pending(id) : null;
  if (!pending) return entryReply({ error: "That upload is not waiting: send the clip again." }, 404);
  const title = line(body.title, TITLE_MAX), rights = line(body.rights, RIGHTS_MAX);
  if (!title) return entryReply({ error: `Give the clip a title of ${TITLE_MAX} letters at most.` }, 400);
  if (!rights) return entryReply({ error: "Say where the clip is from and why it may be shown." }, 400);
  const poster = base64(body.poster);
  if (!poster || !isJpeg(poster) || poster.length > POSTER_BYTES_MAX) return entryReply({ error: `The poster is a JPEG of ${POSTER_BYTES_MAX / 1024} KB at most.` }, 400);
  const colours = base64(body.colours), sample = COLOUR_PARTS * 3;
  const samples = colours ? colours.length / sample : 0;
  if (!colours || !Number.isInteger(samples) || Math.abs(samples - pending.seconds * COLOUR_RATE) > 1) {
    return entryReply({ error: `The colour track holds ${COLOUR_RATE} samples a second of ${sample} bytes, about ${Math.round(pending.seconds * COLOUR_RATE)} in all.` }, 400);
  }
  const posterName = pending.file.slice("/media/".length).replace(/\.mp4$/, ".jpg");
  writeFileSync(join(lib.media, posterName), poster);
  const clip: Clip = {
    id, title, file: pending.file, poster: `/media/${posterName}`, width: pending.width, height: pending.height,
    seconds: pending.seconds, bytes: pending.bytes, audio: pending.audio, rights, starter: false, colours: body.colours as string,
  };
  const done = lib.edit(null, (doc) => (doc.clips.some((c) => c.id === id) ? null : (doc.clips.push(clip), null)));
  if ("error" in done) return entryReply({ error: done.error }, done.status);
  lib.dropPending(id);
  return entryReply(clip);
}
