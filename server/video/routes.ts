// The admin page's API for the cluster's screens, under /admin/screens/: what the library holds and plays, uploads, and
// edits. The caller has checked the admin password and, for a POST, the page's origin (server/admin/site.ts).
import { rmSync } from "node:fs";
import {
  CLIP_MAX_BYTES, CLIP_MAX_HIGH, CLIP_MAX_KBPS, CLIP_MAX_SECONDS, CLIP_MAX_WIDE, COLOUR_PARTS, COLOUR_RATE, IMAGE_MAX_BYTES, IMAGE_MAX_LONG, IMAGE_TYPES, SCENE_SHOW, SCREENS, STILL_MAX, STILL_MIN, STILL_SECONDS,
  channelType, heldSceneOf, isImage, isScreenType, offeredOn, type Channel, type Clip, type Screen, type ScreenType,
} from "../../shared/video/clip.ts";
import { screenAt } from "../../shared/video/programme.ts";
import { manifestPath } from "../../shared/video/screen.ts";
import type { Acts } from "../acts.ts";
import { actorOf, onlyRead, stillHolds, type Recheck } from "../admin/gate.ts";
import { entryReply, readEntryJson } from "../survivor-access.ts";
import { CHANNELS_MAX, NAME_MAX, type LibraryDoc, type LibraryView, type Refusal, type VideoLibrary } from "./library.ts";
import { publishClip, takeImage, takeUpload, typesOf } from "./upload.ts";

const ITEMS_MAX = 200;
/** Channels an act names one by one at the most. */
const CHANNELS_SHOWN = 6;

const SCREEN_GETS: readonly string[] = ["/admin/screens/state", "/admin/screens/live"];
/** The paths that take a POST, which the front passes on (server/front.ts). */
export const SCREEN_POSTS: readonly string[] = ["/admin/screens/upload", "/admin/screens/image", "/admin/screens/clip", "/admin/screens/edit"];
export const SCREEN_PATHS = [...SCREEN_GETS, ...SCREEN_POSTS];

/**
 * The world that answers, as its players see the ball: night or day, its clock's seconds (the orb's programme runs on
 * them) and hour, the scene its own setting holds (-1 for the programme) and the ball's brightness.
 */
export interface ScreenWorld {
  readonly night: boolean;
  readonly seconds: number;
  readonly hour: number;
  readonly only: number;
  readonly gain: number;
}

/** What the admin page is shown: every clip with its rates, the channels, the screens and what each plays now, and the world's clock. */
export function screensState(lib: VideoLibrary, world: ScreenWorld, now = Date.now()): Record<string, unknown> {
  const view = lib.view(), night = world.night;
  const hidden = new Set(view.doc.hidden);
  return {
    revision: view.revision,
    now,
    night,
    world,
    manifest: { id: view.manifestId, path: manifestPath(view.manifestId) },
    caps: {
      wide: CLIP_MAX_WIDE, high: CLIP_MAX_HIGH, kbps: CLIP_MAX_KBPS, seconds: CLIP_MAX_SECONDS, bytes: CLIP_MAX_BYTES, colourRate: COLOUR_RATE, colourParts: COLOUR_PARTS,
      imageLong: IMAGE_MAX_LONG, imageBytes: IMAGE_MAX_BYTES, imageTypes: IMAGE_TYPES, still: STILL_SECONDS, stillMin: STILL_MIN, stillMax: STILL_MAX,
    },
    clips: [...view.all.values()].map((c) => ({
      ...c,
      kind: isImage(c) ? "image" : "clip",
      types: SCREENS.filter((s) => offeredOn(c, s)),
      hidden: c.starter && hidden.has(c.id),
      kbps: isImage(c) ? 0 : Math.round((c.bytes * 8) / c.seconds / 1000),
      // What each player watching it downloads a second; an image is fetched once.
      kBps: isImage(c) ? 0 : Math.round(c.bytes / c.seconds / 100) / 10,
    })),
    channels: view.doc.channels,
    screens: playing(view, now, night),
    pending: lib.allPending(),
  };
}

/** Each screen's record with what it plays at `now`. */
const playing = (view: LibraryView, now: number, night: boolean): Record<string, unknown>[] =>
  view.doc.screens.map((s) => ({ ...s, playing: screenAt(s, view.channels, view.timed, now, night) }));

/**
 * What the page polls between full reads: the revision, the manifest's id and the waiting uploads' ids (so it knows to
 * read the state again), the clocks, and each screen with what it plays now. No items, so no colour tracks.
 */
export function screensLive(lib: VideoLibrary, world: ScreenWorld, now = Date.now()): Record<string, unknown> {
  const view = lib.view();
  return { revision: view.revision, now, night: world.night, world, manifest: view.manifestId, pending: lib.allPending().map((p) => p.id), screens: playing(view, now, world.night) };
}

const bad = (error: string): Refusal => ({ status: 400, error });
const isName = (n: unknown): n is string => typeof n === "string" && n.trim() === n && n.length > 0 && n.length <= NAME_MAX && n !== "scenes" && !n.startsWith(SCENE_SHOW);
const noScreen = (): Refusal => bad(`There are screens ${SCREENS.join(", ")}.`);

/** Whether `show` is something a screen of `type` can show: the scenes, a channel of its type, or for the ball a scene held. */
const canShow = (channels: readonly Channel[], type: ScreenType, show: unknown): show is string =>
  typeof show === "string" && (show === "scenes" || (type === "orb" && heldSceneOf(show) >= 0) || channels.some((c) => c.name === show && channelType(c) === type));
const cannotShow = (type: ScreenType): Refusal => bad(type === "orb" ? "Show the scenes, a scene, or a channel there is." : `Show nothing, or a channel for ${type} screens.`);

/** A screen showing what it can no longer show goes back to the scenes, or dark; a once of an item it is not offered stops. */
function settle(doc: LibraryDoc, all: ReadonlyMap<string, Clip>): void {
  doc.screens = doc.screens.map((s) => {
    let next = canShow(doc.channels, s.screen, s.show) ? s : { ...s, show: "scenes" };
    const once = next.once ? all.get(next.once.clip) : undefined;
    if (next.once && !(once && offeredOn(once, s.screen))) next = { ...next, once: null };
    return next;
  });
}

/** The channels a page sent, every type's, as the library keeps them: each epoch kept by name unless it is reset. */
function setChannels(doc: LibraryDoc, view: LibraryView, sent: unknown, now: number): Refusal | null {
  if (!Array.isArray(sent) || sent.length > CHANNELS_MAX) return bad(`Send up to ${CHANNELS_MAX} channels.`);
  const out: Channel[] = [];
  for (const c of sent as Record<string, unknown>[]) {
    if (!c || !isName(c.name)) return bad(`A channel's name is 1 to ${NAME_MAX} letters, and not "scenes" or "${SCENE_SHOW}…".`);
    // One list holds every type's channels, so a name is unique across them all.
    if (out.some((o) => o.name === c.name)) return bad(`Two channels are named ${c.name}.`);
    if (c.type !== undefined && !isScreenType(c.type)) return bad(`Channel ${c.name} is for ${SCREENS.join(", ")} screens.`);
    const type: ScreenType = c.type ?? "orb";
    if (c.still !== undefined && !(typeof c.still === "number" && c.still >= STILL_MIN && c.still <= STILL_MAX)) return bad(`Channel ${c.name} holds an image ${STILL_MIN} to ${STILL_MAX} seconds.`);
    if (!Array.isArray(c.items) || c.items.length > ITEMS_MAX || !c.items.every((i) => typeof i === "string" && view.all.has(i))) return bad(`Channel ${c.name} lists a clip the library does not hold.`);
    const off = (c.items as string[]).find((i) => !offeredOn(view.all.get(i)!, type));
    if (off) return bad(`Channel ${c.name} lists ${view.all.get(off)!.title}, which is not offered on ${type} screens.`);
    const was = view.channels.get(c.name);
    out.push({
      name: c.name, items: c.items as string[], shuffle: c.shuffle === true, epoch: was && channelType(was) === type && c.reset !== true ? was.epoch : now,
      ...(type !== "orb" ? { type } : {}), ...(c.still !== undefined ? { still: c.still as number } : {}),
    });
  }
  doc.channels = out;
  settle(doc, view.all);
  return null;
}

/** One screen's fields changed: show, mode, fill, sound, night. */
function setScreen(doc: LibraryDoc, body: Record<string, unknown>): Refusal | null {
  const at = doc.screens.findIndex((s) => s.screen === body.screen);
  if (at < 0) return noScreen();
  const was = doc.screens[at]!, next: { -readonly [K in keyof Screen]: Screen[K] } = { ...was };
  if (body.show !== undefined) {
    if (!canShow(doc.channels, was.screen, body.show)) return cannotShow(was.screen);
    next.show = body.show;
  }
  if (body.mode !== undefined) {
    if (body.mode !== "facing" && body.mode !== "fixed") return bad("The mode is facing or fixed.");
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

/** The types an item is offered on, changed: an upload's own, a starter's kept apart. It leaves channels of types it is taken from. */
function setTypes(doc: LibraryDoc, view: LibraryView, clip: Clip | undefined, sent: unknown): Refusal | null {
  if (!clip) return bad("Offer an item the library holds.");
  const types = typesOf(sent, undefined);
  if (typeof types === "string" || !types) return bad(typeof types === "string" ? types : "Send the types it is offered on.");
  const at = doc.clips.findIndex((c) => c.id === clip.id);
  if (at >= 0) doc.clips[at] = { ...doc.clips[at]!, types };
  else doc.types = { ...doc.types, [clip.id]: types };
  doc.channels = doc.channels.map((c) => (types.includes(channelType(c)) ? c : { ...c, items: c.items.filter((i) => i !== clip.id) }));
  settle(doc, new Map([...view.all, [clip.id, { ...clip, types }]]));
  return null;
}

/** The change an edit names, made to `doc`. */
function change(doc: LibraryDoc, view: LibraryView, body: Record<string, unknown>, now: number): Refusal | null {
  const screen = doc.screens.findIndex((s) => s.screen === body.screen);
  const type = screen >= 0 ? doc.screens[screen]!.screen : null;
  const clip = typeof body.clip === "string" ? view.all.get(body.clip) : undefined;
  /** Plays `clip` once on the screen, if the library shows it and it is offered there. */
  const once = (): Refusal | null => {
    if (screen < 0) return noScreen();
    if (!clip || !view.timed.has(clip.id)) return bad("Play a clip the library shows.");
    if (!offeredOn(clip, type!)) return bad(`${clip.title} is not offered on ${type} screens.`);
    doc.screens[screen] = { ...doc.screens[screen]!, once: { clip: clip.id, from: now } };
    return null;
  };
  switch (body.op) {
    case "channels":
      return setChannels(doc, view, body.channels, now);
    case "screen":
      return setScreen(doc, body);
    case "once":
      return once();
    case "take":
      // What goes live now: an item plays once over what the screen shows; anything else becomes what it shows.
      if (screen < 0) return noScreen();
      if (body.clip !== undefined) return once();
      if (!canShow(doc.channels, type!, body.show)) return cannotShow(type!);
      doc.screens[screen] = { ...doc.screens[screen]!, show: body.show, once: null };
      return null;
    case "stop":
      if (screen < 0) return noScreen();
      doc.screens[screen] = { ...doc.screens[screen]!, once: null };
      return null;
    case "types":
      return setTypes(doc, view, clip, body.types);
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
      return bad("The op is channels, screen, take, once, stop, types, rename, delete, hide or unhide.");
  }
}

/** What a screen shows, in words. */
const showWords = (show: string): string => (show === "" ? "nothing" : show === "scenes" ? "the scenes" : heldSceneOf(show) >= 0 ? `the scene ${show.slice(SCENE_SHOW.length)}` : `the channel ${show}`);

/** What an edit did, in words for the admin log: a clip by its title, a screen and a channel by name. */
function editWords(before: LibraryView, after: LibraryView, body: Record<string, unknown>): string {
  const item = before.all.get(String(body.clip));
  const noun = item && isImage(item) ? "image" : "clip";
  const title = `"${item?.title ?? String(body.clip)}"`, clip = `the ${noun} ${title}`;
  const screen = `screen ${String(body.screen)}`;
  switch (body.op) {
    case "channels": {
      const all = [...after.channels.values()].map((c) => `${c.name} (${c.items.length} ${c.items.length === 1 ? "clip" : "clips"}${c.shuffle ? ", shuffled" : ""})`);
      const shown = all.length > CHANNELS_SHOWN ? [...all.slice(0, CHANNELS_SHOWN), `${all.length - CHANNELS_SHOWN} more`] : all;
      const back = [...after.screens.values()].filter((s) => s.show === "scenes" && before.screens.get(s.screen)?.show !== "scenes").map((s) => `screen ${s.screen}`);
      return `set the channels: ${shown.join(", ") || "none"}${back.length > 0 ? `; ${back.join(", ")} back to the scenes` : ""}`;
    }
    case "screen": {
      const now = after.screens.get(body.screen as ScreenType)!;
      const said = [
        body.show !== undefined ? `shows ${showWords(now.show)}` : "",
        body.mode !== undefined ? `mode ${now.mode}` : "",
        body.fill !== undefined ? (now.fill ? "fills the face" : "fits whole") : "",
        body.sound !== undefined ? (now.sound ? "with sound" : "without sound") : "",
        body.night !== undefined ? (now.night ? "by night only" : "by day and night") : "",
      ].filter((w) => w !== "");
      return `set ${screen}${said.length > 0 ? `: ${said.join(", ")}` : ""}`;
    }
    case "once":
      return `played ${clip} once on ${screen}`;
    case "take":
      return body.clip !== undefined ? `played ${clip} once on ${screen}` : `set ${screen} to show ${showWords(String(body.show))}`;
    case "stop": {
      const playing = before.screens.get(body.screen as ScreenType)?.once;
      const stopped = playing && before.all.get(playing.clip);
      return `stopped the ${stopped && isImage(stopped) ? "image" : "clip"} playing once on ${screen}`;
    }
    case "types": {
      const changed = after.all.get(String(body.clip))!;
      return `offered ${clip} on ${SCREENS.filter((type) => offeredOn(changed, type)).join(", ")}`;
    }
    case "rename": {
      const was = before.all.get(String(body.clip))!, now = after.all.get(String(body.clip))!;
      return [was.title !== now.title ? `renamed ${clip} to "${now.title}"` : "", was.rights !== now.rights ? `changed the rights line of "${now.title}"` : ""].filter((w) => w !== "").join(" and ");
    }
    case "delete":
      return `deleted ${clip}`;
    default:
      return body.op === "hide" ? `hid the starter ${noun} ${title}` : `showed the starter ${noun} ${title} again`;
  }
}

/** POST /admin/screens/edit {revision, op, ...}: one change, refused with 409 if the library moved on. Answers the state. */
async function edit(req: Request, lib: VideoLibrary, world: ScreenWorld, did: (what: string) => void, holds: () => Response | null): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await readEntryJson(req, 128 * 1024);
  } catch {
    return entryReply({ error: "Expected a small JSON edit." }, 400);
  }
  const lost = holds();
  if (lost) return lost;
  if (!Number.isSafeInteger(body.revision)) return entryReply({ error: "Send the revision the page was showing." }, 400);
  const now = Date.now(), before = lib.view(), was = typeof body.clip === "string" ? before.all.get(body.clip) : undefined;
  const done = lib.edit(body.revision as number, (doc, view) => change(doc, view, body, now));
  if ("error" in done) return entryReply({ error: done.error }, done.status);
  // An edit that left the library as it was, such as a stop with nothing playing once, is not a change.
  if (JSON.stringify(done.doc) === JSON.stringify(before.doc)) onlyRead(req);
  else did(editWords(before, done, body));
  // A deleted clip's files go with it.
  if (body.op === "delete" && was && !was.starter) for (const f of [lib.fileOf(was.file), lib.fileOf(was.poster)]) if (f) rmSync(f, { force: true });
  return entryReply(screensState(lib, world, now));
}

/**
 * Answers a request under /admin/screens/, or null for any other path. `world` is this world as its players see the ball,
 * and each change is written in `acts` as the request's actor's. With `recheck`, the actor's rank is judged again once
 * a change's body is in (gate.ts stillHolds).
 */
export function screensAdmin(req: Request, path: string, lib: VideoLibrary, world: () => ScreenWorld, acts: Pick<Acts, "write"> | null = null, recheck: Recheck | null = null): Promise<Response> | Response | null {
  if (!SCREEN_PATHS.includes(path)) return null;
  const did = (what: string): void => void acts?.write(actorOf(req), what);
  const holds = (): Response | null => (recheck ? stillHolds(req, recheck) : null);
  const read = req.method === "GET" || req.method === "HEAD";
  if (SCREEN_GETS.includes(path)) {
    if (!read) return new Response(null, { status: 405, headers: { allow: "GET" } });
    return path === "/admin/screens/live" ? entryReply(screensLive(lib, world())) : (lib.sweep(), entryReply(screensState(lib, world())));
  }
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  if (path === "/admin/screens/upload") return takeUpload(req, lib, did, holds);
  if (path === "/admin/screens/image") return takeImage(req, lib, did, holds);
  if (path === "/admin/screens/clip") return publishClip(req, lib, did, holds);
  return edit(req, lib, world(), did, holds);
}
