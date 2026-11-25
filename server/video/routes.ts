// The admin page's API for the cluster's screens, under /admin/screens/: what the library holds and plays, uploads, and
// edits. The caller has checked the admin password and, for a POST, the page's origin (server/admin/site.ts).
import { rmSync } from "node:fs";
import { CLIP_MAX_BYTES, CLIP_MAX_HIGH, CLIP_MAX_KBPS, CLIP_MAX_SECONDS, CLIP_MAX_WIDE, COLOUR_PARTS, COLOUR_RATE, SCREENS, type Channel, type Screen } from "../../shared/video/clip.ts";
import { screenAt } from "../../shared/video/programme.ts";
import { manifestPath } from "../../shared/video/screen.ts";
import { entryReply, readEntryJson } from "../survivor-access.ts";
import { type LibraryDoc, type LibraryView, type Refusal, type VideoLibrary } from "./library.ts";
import { publishClip, takeUpload } from "./upload.ts";

const CHANNELS_MAX = 32;
const ITEMS_MAX = 200;
const NAME_MAX = 40;

export const SCREEN_PATHS = ["/admin/screens/state", "/admin/screens/upload", "/admin/screens/clip", "/admin/screens/edit"] as const;
/** The paths that take a POST, which the front passes on (server/front.ts). */
export const SCREEN_POSTS: readonly string[] = SCREEN_PATHS.slice(1);

/** What the admin page is shown: every clip with its rates, the channels, the screens and what each plays now. */
export function screensState(lib: VideoLibrary, night: boolean, now = Date.now()): Record<string, unknown> {
  const view = lib.view();
  const hidden = new Set(view.doc.hidden);
  return {
    revision: view.revision,
    now,
    night,
    manifest: { id: view.manifestId, path: manifestPath(view.manifestId) },
    caps: { wide: CLIP_MAX_WIDE, high: CLIP_MAX_HIGH, kbps: CLIP_MAX_KBPS, seconds: CLIP_MAX_SECONDS, bytes: CLIP_MAX_BYTES, colourRate: COLOUR_RATE, colourParts: COLOUR_PARTS },
    clips: [...view.all.values()].map((c) => ({
      ...c,
      hidden: c.starter && hidden.has(c.id),
      kbps: Math.round((c.bytes * 8) / c.seconds / 1000),
      // What each player watching it downloads a second.
      kBps: Math.round(c.bytes / c.seconds / 100) / 10,
    })),
    channels: view.doc.channels,
    screens: view.doc.screens.map((s) => ({ ...s, playing: screenAt(s, view.channels, view.timed, now, night) })),
    pending: lib.allPending(),
  };
}

const bad = (error: string): Refusal => ({ status: 400, error });
const isName = (n: unknown): n is string => typeof n === "string" && n.trim() === n && n.length > 0 && n.length <= NAME_MAX && n !== "scenes";

/** The channels a page sent, as the library keeps them: each epoch kept by name unless it is reset. */
function setChannels(doc: LibraryDoc, view: LibraryView, sent: unknown, now: number): Refusal | null {
  if (!Array.isArray(sent) || sent.length > CHANNELS_MAX) return bad(`Send up to ${CHANNELS_MAX} channels.`);
  const out: Channel[] = [];
  for (const c of sent as Record<string, unknown>[]) {
    if (!c || !isName(c.name)) return bad(`A channel's name is 1 to ${NAME_MAX} letters, and not "scenes".`);
    if (out.some((o) => o.name === c.name)) return bad(`Two channels are named ${c.name}.`);
    if (!Array.isArray(c.items) || c.items.length > ITEMS_MAX || !c.items.every((i) => typeof i === "string" && view.all.has(i))) return bad(`Channel ${c.name} lists a clip the library does not hold.`);
    const was = view.channels.get(c.name);
    out.push({ name: c.name, items: c.items as string[], shuffle: c.shuffle === true, epoch: was && c.reset !== true ? was.epoch : now });
  }
  doc.channels = out;
  // A screen showing a channel that is gone goes back to the scenes.
  doc.screens = doc.screens.map((s) => (s.show === "scenes" || out.some((c) => c.name === s.show) ? s : { ...s, show: "scenes" }));
  return null;
}

/** One screen's fields changed: show, mode, fill, sound, night. */
function setScreen(doc: LibraryDoc, body: Record<string, unknown>): Refusal | null {
  const at = doc.screens.findIndex((s) => s.screen === body.screen);
  if (at < 0) return bad(`There are screens ${SCREENS.join(", ")}.`);
  const was = doc.screens[at]!, next: { -readonly [K in keyof Screen]: Screen[K] } = { ...was };
  if (body.show !== undefined) {
    if (body.show !== "scenes" && !doc.channels.some((c) => c.name === body.show)) return bad("Show the scenes or a channel there is.");
    next.show = body.show as string;
  }
  if (body.mode !== undefined) {
    if (body.mode !== "theatre" && body.mode !== "band") return bad("The mode is theatre or band.");
    next.mode = body.mode;
  }
  for (const flag of ["fill", "sound", "night"] as const) {
    if (body[flag] === undefined) continue;
    if (typeof body[flag] !== "boolean") return bad(`${flag} is true or false.`);
    next[flag] = body[flag];
  }
  doc.screens[at] = next;
  return null;
}

/** The change an edit names, made to `doc`. */
function change(doc: LibraryDoc, view: LibraryView, body: Record<string, unknown>, now: number): Refusal | null {
  const screen = doc.screens.findIndex((s) => s.screen === body.screen);
  const clip = typeof body.clip === "string" ? view.all.get(body.clip) : undefined;
  switch (body.op) {
    case "channels":
      return setChannels(doc, view, body.channels, now);
    case "screen":
      return setScreen(doc, body);
    case "once":
      if (screen < 0) return bad(`There are screens ${SCREENS.join(", ")}.`);
      if (!clip || !view.timed.has(clip.id)) return bad("Play a clip the library shows.");
      doc.screens[screen] = { ...doc.screens[screen]!, once: { clip: clip.id, from: now } };
      return null;
    case "stop":
      if (screen < 0) return bad(`There are screens ${SCREENS.join(", ")}.`);
      doc.screens[screen] = { ...doc.screens[screen]!, once: null };
      return null;
    case "rename": {
      const at = doc.clips.findIndex((c) => c.id === body.clip);
      const title = typeof body.title === "string" ? body.title.replace(/\s+/g, " ").trim() : "";
      if (at < 0) return bad("Only an uploaded clip is renamed.");
      if (!title || title.length > 80) return bad("A title is 1 to 80 letters.");
      const rights = typeof body.rights === "string" ? body.rights.replace(/\s+/g, " ").trim() : doc.clips[at]!.rights;
      if (!rights || rights.length > 240) return bad("A rights line is 1 to 240 letters.");
      doc.clips[at] = { ...doc.clips[at]!, title, rights };
      return null;
    }
    case "delete": {
      if (!doc.clips.some((c) => c.id === body.clip)) return bad("Only an uploaded clip is deleted; a starter is hidden.");
      doc.clips = doc.clips.filter((c) => c.id !== body.clip);
      doc.channels = doc.channels.map((c) => ({ ...c, items: c.items.filter((i) => i !== body.clip) }));
      doc.screens = doc.screens.map((s) => (s.once?.clip === body.clip ? { ...s, once: null } : s));
      return null;
    }
    case "hide":
    case "unhide":
      if (!clip?.starter) return bad("Only a starter clip is hidden.");
      doc.hidden = doc.hidden.filter((i) => i !== clip.id);
      if (body.op === "hide") doc.hidden.push(clip.id);
      return null;
    default:
      return bad("The op is channels, screen, once, stop, rename, delete, hide or unhide.");
  }
}

/** POST /admin/screens/edit {revision, op, ...}: one change, refused with 409 if the library moved on. Answers the state. */
async function edit(req: Request, lib: VideoLibrary, night: boolean): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await readEntryJson(req, 128 * 1024);
  } catch {
    return entryReply({ error: "Expected a small JSON edit." }, 400);
  }
  if (!Number.isSafeInteger(body.revision)) return entryReply({ error: "Send the revision the page was showing." }, 400);
  const now = Date.now(), was = typeof body.clip === "string" ? lib.view().all.get(body.clip) : undefined;
  const done = lib.edit(body.revision as number, (doc, view) => change(doc, view, body, now));
  if ("error" in done) return entryReply({ error: done.error }, done.status);
  // A deleted clip's files go with it.
  if (body.op === "delete" && was && !was.starter) for (const f of [lib.fileOf(was.file), lib.fileOf(was.poster)]) if (f) rmSync(f, { force: true });
  return entryReply(screensState(lib, night, now));
}

/** Answers a request under /admin/screens/, or null for any other path. `night` is whether it is night in this world. */
export function screensAdmin(req: Request, path: string, lib: VideoLibrary, night: () => boolean): Promise<Response> | Response | null {
  if (!(SCREEN_PATHS as readonly string[]).includes(path)) return null;
  const read = req.method === "GET" || req.method === "HEAD";
  if (path === "/admin/screens/state") return read ? (lib.sweep(), entryReply(screensState(lib, night()))) : new Response(null, { status: 405, headers: { allow: "GET" } });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  if (path === "/admin/screens/upload") return (lib.sweep(), takeUpload(req, lib));
  if (path === "/admin/screens/clip") return publishClip(req, lib);
  return edit(req, lib, night());
}
