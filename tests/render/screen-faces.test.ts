// What each screen on a prop shows (client/core/video/faces.ts): its own place in its type's channel, a clip on every
// screen while one plays once, dark with neither; the pictures' layers given up least lately used first; and the clips
// played for the nearest screens, two at the most, none on stills, their frames put on the card only when new.
import { expect, test } from "bun:test";
import { heapStats } from "bun:jsc";
import { SCREENS_DECODING, SCREENS_DRAWN, SCREENS_MANY, SCREENS_UPLOADING } from "../../client/core/governor.ts";
import { FACE, FramePacket, MAX_FACE_UPLOADS } from "../../client/core/render/packet.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { pictureCrop } from "../../client/core/render/picture-crop.ts";
import { FaceList, writeFace } from "../../client/core/render/screens.ts";
import { FAILED_WAIT, FaceLayers, FaceScreens, LOAD_GIVES_UP, MANIFEST_RETRY_MOST, MAX_LOADS, Programme, WIPE_MS, channelWall, readLibrary, refShare, type FaceHost, type FaceView, type Shown } from "../../client/core/video/faces.ts";
import { WAIT_FOR_ART } from "../../client/core/video/sync.ts";
import type { VideoLike } from "../../client/core/video/player.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { SCREENS } from "../../shared/video/clip.ts";
import type { ScreenFace } from "../../shared/video/face.ts";
import { channelAtOffset } from "../../shared/video/programme.ts";
import { NO_CHANNEL, NO_CLIP, SCREEN_FACING, SCREEN_FILL, SCREEN_ONCE, SHOW_VIDEO, manifestPath, newScreenState, type ScreenState } from "../../shared/video/screen.ts";

const ID = "0123456789abcdef";
const EPOCH = 1_000_000;
// One sample of a colour track: a mean of (200, 100, 50) and four edges.
const TRACK = Buffer.from(Uint8Array.from([200, 100, 50, ...Array(12).fill(0)])).toString("base64");
const image = (id: string) => ({ id, title: id, file: `/media/${id}.png`, poster: `/media/${id}.png`, width: 1280, height: 420, seconds: 0, bytes: 1, audio: false, rights: "", starter: true, colours: TRACK, kind: "image" });
const clip = (id: string) => ({ id, title: id, file: `/media/${id}.mp4`, poster: `/media/${id}.jpg`, width: 640, height: 360, seconds: 10, bytes: 1, audio: false, rights: "", starter: true, colours: TRACK });
const MANIFEST = {
  clips: [image("a"), image("b"), image("c"), clip("v")],
  channels: [
    { name: "ads", items: ["a", "b", "c"], shuffle: false, epoch: EPOCH, type: "billboard", still: 8 },
    { name: "spots", items: ["v"], shuffle: false, epoch: EPOCH, type: "tv" },
  ],
};
const BILLBOARD = SCREENS.indexOf("billboard"), TV = SCREENS.indexOf("tv");
const FACES: (ScreenFace | null)[] = [null, { type: "billboard", face: [-7.4, 7.4, 9.55, 14.4, 1.55], led: true }, { type: "tv", face: [-0.5, 0.5, 0.6, 1.2, 0.05] }];

/** Every type's state: the billboards on "ads" and the TVs on "spots", each channel's epoch at tick 300, filling their faces. */
function states(): ScreenState[] {
  return SCREENS.map((_, i) => ({ ...newScreenState(), manifest: ID, show: i > 0 ? SHOW_VIDEO : 0, flags: SCREEN_FACING | SCREEN_FILL, channel: i === BILLBOARD ? 0 : i === TV ? 1 : NO_CHANNEL, epoch: 300 }));
}

class Video implements VideoLike {
  /** How many times a file was put in it, and how many times it was told to load. */
  sets = 0;
  loads = 0;
  private file = "";
  get src(): string {
    return this.file;
  }
  set src(v: string) {
    this.file = v;
    if (v) this.sets++;
  }
  preload = "none";
  currentTime = 0;
  playbackRate = 1;
  muted = true;
  paused = true;
  seeking = false;
  readyState = 0;
  videoWidth = 0;
  videoHeight = 0;
  error = null;
  frame: (() => void) | null = null;
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  load(): void {
    this.loads++;
  }
  removeAttribute(name: string): void {
    if (name === "src") this.file = "";
  }
  requestVideoFrameCallback(call: () => void): number {
    this.frame = call;
    return 1;
  }
  /** A new frame comes. */
  tick(): void {
    const f = this.frame;
    this.frame = null;
    f?.();
  }
}

class Host implements FaceHost {
  readonly fetched: string[] = [];
  readonly images: string[] = [];
  readonly dropped: string[] = [];
  readonly videos: Video[] = [];
  /** Each manifest by its path; the first by default. */
  readonly manifests = new Map<string, unknown>();
  /** Whether pictures never come, and how many more manifests fail. */
  stall = false;
  fails = 0;
  json(path: string): Promise<unknown> {
    this.fetched.push(path);
    if (this.fails > 0) {
      this.fails--;
      return Promise.reject(new Error("offline"));
    }
    return Promise.resolve(this.manifests.get(path) ?? MANIFEST);
  }
  image(path: string, width: number, height: number): Promise<unknown> {
    this.images.push(path);
    return this.stall ? new Promise(() => {}) : Promise.resolve({ path, width, height });
  }
  drop(path: string): void {
    this.dropped.push(path);
  }
  video(): VideoLike {
    const v = new Video();
    this.videos.push(v);
    return v;
  }
  visible(): boolean {
    return true;
  }
}

/** A list of `n` faces of `kind`, the nearest first `from` metres off and half a metre apart, refs 1 to n. */
function faces(n: number, kind: number, seen = n, from = 10): FaceList {
  const list = new FaceList();
  for (let i = 0; i < n; i++) {
    list.ref[i] = i + 1;
    list.kind[i] = kind;
    list.type[i] = kind === 1 ? BILLBOARD : TV;
    list.distance[i] = from + i / 2;
    list.fade[i] = 1;
  }
  list.count = n;
  list.seen = seen;
  return list;
}
/** A list of TVs, each `[ref, metres off]`, nearest first. */
function tvs(...at: [number, number][]): FaceList {
  const list = faces(at.length, 2);
  at.forEach(([ref, d], i) => {
    list.ref[i] = ref;
    list.distance[i] = d;
  });
  return list;
}
const view = (o: Partial<FaceView> = {}): FaceView => ({ states: states(), tick: 3000, now: 0, option: true, pixel: 1.2217 / 1080, count: 32, layers: 12, video: 2, fps: 30, artIdle: true, ...o });
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

test("each screen finds its own place in its type's channel, by its ref, from the world's ticks", () => {
  const lib = readLibrary(MANIFEST)!, programme = new Programme(), out: Shown = { item: -1, seconds: 0, before: -1, wipe: 1 };
  expect(lib.rounds).toEqual([24000, 10000]);
  expect(channelWall(EPOCH, 300, 330)).toBe(EPOCH + 1000);
  const s = states(), tick = 300 + 31 * TICK_RATE;
  programme.begin(s, lib);
  const seen = new Set<number>();
  for (let ref = 1; ref <= 40; ref++) {
    programme.at(ref, BILLBOARD, s, tick, 0, out);
    const p = channelAtOffset(lib.channels[0]!, lib.timed, EPOCH + 31000, refShare(ref) * 24000)!;
    expect(lib.items[out.item]!.id).toBe(p.clip);
    expect(out.seconds).toBeCloseTo((EPOCH + 31000 - p.start) / 1000, 6);
    seen.add(out.item);
  }
  // Side by side, screens show different items, and every client finds the same for a ref.
  expect(seen.size).toBe(3);
  expect(refShare(65536 * 7 + 3)).toBe(refShare(65536 * 7 + 3));
});

test("an item played once shows on every screen of its type from its start, and a type with no channel is dark", () => {
  const lib = readLibrary(MANIFEST)!, programme = new Programme(), out: Shown = { item: -1, seconds: 0, before: -1, wipe: 1 };
  const s = states();
  Object.assign(s[BILLBOARD]!, { flags: SCREEN_ONCE, clip: 3, start: 600 });
  s[TV]!.channel = NO_CHANNEL;
  programme.begin(s, lib);
  for (const ref of [1, 2, 99]) {
    expect(programme.at(ref, BILLBOARD, s, 660, 0, out).item).toBe(3);
    expect(out.seconds).toBe(2);
    expect(programme.at(ref, TV, s, 660, 0, out).item).toBe(-1);
  }
  // Once it is over the type goes back to its channel.
  Object.assign(s[BILLBOARD]!, { flags: 0, clip: NO_CLIP });
  programme.begin(s, lib);
  expect(programme.at(1, BILLBOARD, s, 660, 0, out).item).toBeLessThan(3);
  // And with no manifest yet, nothing.
  programme.begin(s, null);
  expect(programme.at(1, BILLBOARD, s, 660, 0, out).item).toBe(-1);
});

test("a screen first seen shows its item at once; one whose item changes wipes from the one before", () => {
  const lib = readLibrary(MANIFEST)!, programme = new Programme(), out: Shown = { item: -1, seconds: 0, before: -1, wipe: 1 };
  const s = states(), ref = 5;
  programme.begin(s, lib);
  // Where the screen is in its item, and the tick its item ends on.
  programme.at(ref, BILLBOARD, s, 300, 0, out);
  expect(out.wipe).toBe(1);
  const first = out.item, end = 300 + Math.ceil((8 - out.seconds) * TICK_RATE);
  programme.at(ref, BILLBOARD, s, end - 1, 1000, out);
  expect([out.item, out.wipe]).toEqual([first, 1]);
  programme.at(ref, BILLBOARD, s, end + 1, 2000, out);
  expect(out.item).not.toBe(first);
  expect([out.before, out.wipe]).toEqual([first, 0]);
  programme.at(ref, BILLBOARD, s, end + 2, 2000 + WIPE_MS / 2, out);
  expect(out.wipe).toBeCloseTo(0.5, 6);
});

test("the layers are given up least lately used first, never one used this frame or waiting for its picture", () => {
  const layers = new FaceLayers();
  layers.resize(3);
  expect([layers.take("a", 1, 0), layers.take("b", 1, 0), layers.take("c", 1, 0)]).toEqual([0, 1, 2]);
  // Every one is used this frame or waits.
  expect(layers.take("d", 1, 0)).toBe(-1);
  layers.filled(0, 5);
  layers.filled(1, 5);
  layers.filled(2, 5);
  expect(layers.find("b", 2)).toBe(1);
  expect(layers.find("c", 3)).toBe(2);
  // "a" was last used on frame 1.
  expect(layers.take("d", 4, 1000)).toBe(0);
  expect([layers.find("a", 4), layers.find("d", 4), layers.holds(0)]).toEqual([-1, 0, false]);
  // A picture that never comes is given up after a while.
  expect(layers.take("e", 5, 1000)).toBe(1);
  expect(layers.take("f", 6, 1000 + LOAD_GIVES_UP * 1000 - 1)).toBe(2);
  expect(layers.take("g", 7, 1000 + LOAD_GIVES_UP * 1000 - 1)).toBe(-1);
  expect(layers.take("g", 8, 1000 + LOAD_GIVES_UP * 1000 + 1)).toBe(0);
});

test("nothing is fetched until a screen is in reach; then the manifest once and its pictures a few at a time", async () => {
  const host = new Host(), screens = new FaceScreens(), p = new FramePacket();
  screens.attach(host);
  for (let n = 0; n < 5; n++) screens.step(faces(0, 1), FACES, view({ now: n * 16 }), p);
  expect([host.fetched, host.images, p.faceLayers]).toEqual([[], [], 0]);
  expect(screens.wanted).toBe(false);
  const list = faces(12, 1);
  screens.step(list, FACES, view({ now: 100 }), p);
  expect(host.fetched).toEqual([manifestPath(ID)]);
  expect([p.faceLayers, screens.wanted]).toEqual([12, true]);
  await settle();
  p.beginFrame();
  screens.step(list, FACES, view({ now: 116 }), p);
  // Three pictures in all, fetched no more than MAX_LOADS at once.
  expect(host.images.length).toBeLessThanOrEqual(MAX_LOADS);
  for (let n = 0; n < 6; n++) {
    await settle();
    p.beginFrame();
    screens.step(list, FACES, view({ now: 132 + n * 16 }), p);
    expect(p.faceUploads).toBeLessThanOrEqual(MAX_FACE_UPLOADS);
  }
  expect(host.fetched.length).toBe(1);
  expect(new Set(host.images)).toEqual(new Set(["/media/a.png", "/media/b.png", "/media/c.png"]));
  // Each shows its own item's layer, cropped to its face, with its mean colour.
  for (let i = 0; i < 12; i++) {
    const show = screens.shows[i]!;
    expect(show.layer).toBeGreaterThanOrEqual(0);
    expect(show.mean).toBe((200 | (100 << 8) | (50 << 16) | (255 << 24)) >>> 0);
    expect(show.crop[0]).toBe(1);
  }
  expect(screens.mask).toBe(SCREENS_DRAWN | SCREENS_MANY);
});

test("the nearest screens showing a clip get two elements at most, none on stills, and a frame goes up only when new", async () => {
  const host = new Host(), screens = new FaceScreens(), p = new FramePacket(), list = faces(6, 2, 6, 2);
  screens.attach(host);
  const step = async (now: number, o: Partial<FaceView> = {}): Promise<void> => {
    await settle();
    p.beginFrame();
    screens.step(list, FACES, view({ now, ...o }), p);
  };
  await step(0);
  await step(16);
  expect(host.videos.length).toBe(2);
  expect(screens.decoding).toBe(2);
  expect(screens.mask & (SCREENS_DECODING | SCREENS_UPLOADING)).toBe(SCREENS_DECODING | SCREENS_UPLOADING);
  expect(host.videos.map((v) => [v.src, v.paused])).toEqual([["/media/v.mp4", false], ["/media/v.mp4", false]]);
  for (const v of host.videos) Object.assign(v, { readyState: 2, videoWidth: 640, videoHeight: 360 });
  // No new frame, no upload; a new frame, one each, held to ten a second.
  let clips = 0;
  const uploads = (): number => Array.from(p.faceVideo.subarray(0, p.faceUploads)).filter((v) => v === 1).length;
  await step(32, { fps: 10 });
  expect(uploads()).toBe(0);
  for (let n = 0; n < 60; n++) {
    for (const v of host.videos) v.tick();
    await step(48 + n * 16, { fps: 10 });
    clips += uploads();
  }
  expect(clips).toBeGreaterThan(2 * 8);
  expect(clips).toBeLessThanOrEqual(2 * 10);
  // The two nearest show their clip's frames, put on the card with the levels they read; the rest their poster, with all.
  const layers = screens.shows.slice(0, 6).map((s) => s.layer);
  expect(layers[0]).not.toBe(layers[1]);
  expect(new Set(layers.slice(2)).size).toBe(1);
  expect(screens.shows.slice(0, 3).map((s) => s.top)).toEqual([1, 1, 5]);
  // On stills, every stream is let go at once.
  await step(2000, { video: 0 });
  expect(screens.decoding).toBe(0);
  expect(host.videos.map((v) => [v.src, v.paused])).toEqual([["", true], ["", true]]);
  expect(host.videos.length).toBe(2);
});

test("a screen too small in view for its clip's frames to be read shows its poster", async () => {
  const host = new Host(), screens = new FaceScreens(), p = new FramePacket();
  screens.attach(host);
  for (const now of [0, 16, 32]) {
    await settle();
    p.beginFrame();
    screens.step(faces(2, 2, 2, 12), FACES, view({ now }), p);
  }
  expect([host.videos.length, screens.decoding]).toEqual([0, 0]);
  // Its being there is still what the governor's clip steps would take.
  expect(screens.mask & SCREENS_DECODING).toBe(SCREENS_DECODING);
});

test("deciding what the screens show frame after frame makes nothing", async () => {
  const host = new Host(), screens = new FaceScreens(), p = new FramePacket(), list = faces(32, 1, 40), v = view();
  screens.attach(host);
  for (let n = 0; n < 20; n++) {
    await settle();
    p.beginFrame();
    screens.step(list, FACES, v, p);
  }
  const frames = (from: number, to: number): void => {
    for (let n = from; n < to; n++) {
      p.beginFrame();
      (v as { now: number; tick: number }).now = n * 16;
      (v as { now: number; tick: number }).tick = 3000 + n / 2;
      screens.step(list, FACES, v, p);
    }
  };
  frames(20, 300);
  Bun.gc(true);
  const before = heapStats().objectCount;
  frames(300, 900);
  Bun.gc(true);
  // A handful is the engine's own noise; a frame's worth of anything would be hundreds.
  expect(heapStats().objectCount - before).toBeLessThan(40);
});

/** Steps `screens` once at `now`, after letting what the host promised come. */
async function frame(screens: FaceScreens, list: FaceList, now: number, o: Partial<FaceView> = {}, p = new FramePacket()): Promise<void> {
  await settle();
  p.beginFrame();
  screens.step(list, FACES, view({ now, ...o }), p);
}

test("a missed manifest is asked for again after 2 s, twice as long each time up to a minute", async () => {
  const host = new Host(), screens = new FaceScreens(), list = faces(4, 1), times: number[] = [];
  host.fails = Infinity;
  screens.attach(host);
  for (let now = 0; now <= 250_000; now += 500) {
    const asked = host.fetched.length;
    await frame(screens, list, now);
    if (host.fetched.length > asked) times.push(now);
  }
  expect(times).toEqual([0, 2000, 6000, 14000, 30000, 62000, 122000, 182000, 242000]);
  expect(MANIFEST_RETRY_MOST).toBe(60);
  // Once it comes, the screens have their library.
  host.fails = 0;
  for (let now = 250_000; now <= 303_000; now += 500) await frame(screens, list, now);
  expect(screens.held).not.toBeNull();
  // OWN_SCREEN naming a new manifest has it asked for at once.
  const s = states();
  for (const st of s) st.manifest = "fedcba9876543210";
  await frame(screens, list, 303_500, { states: s });
  expect(host.fetched.at(-1)).toBe(manifestPath("fedcba9876543210"));
});

test("a picture that never comes frees its place after LOAD_GIVES_UP, and one no screen wants at once", async () => {
  const host = new Host(), screens = new FaceScreens(), boards = faces(32, 1);
  host.stall = true;
  screens.attach(host);
  await frame(screens, boards, 0);
  await frame(screens, boards, 16);
  await frame(screens, boards, 1000);
  expect(host.images.length).toBe(MAX_LOADS);
  expect(host.dropped).toEqual([]);
  // Stalled past the deadline, each is given up and asked for again.
  await frame(screens, boards, LOAD_GIVES_UP * 1000 + 100);
  await frame(screens, boards, LOAD_GIVES_UP * 1000 + 116);
  expect(new Set(host.dropped)).toEqual(new Set(["/media/a.png", "/media/b.png", "/media/c.png"]));
  expect(host.images.length).toBe(2 * MAX_LOADS);
  // The viewer turns to the TVs: the billboards' pictures are dropped and the TVs' poster asked for.
  host.dropped.length = 0;
  const far = faces(3, 2, 3, 30);
  for (let i = 0; i < 3; i++) far.ref[i] = 101 + i;
  await frame(screens, far, 20_000);
  await frame(screens, far, 20_016);
  expect(host.dropped.length).toBe(MAX_LOADS);
  expect(host.images.at(-1)).toBe("/media/v.jpg");
});

test("a picture that failed is asked for again after FAILED_WAIT", async () => {
  const host = new Host(), screens = new FaceScreens(), far = faces(1, 2, 1, 30);
  const image = host.image.bind(host);
  let down = true;
  host.image = (path, w, h) => (down ? (host.images.push(path), Promise.reject(new Error("offline"))) : image(path, w, h));
  screens.attach(host);
  for (let now = 0; now < FAILED_WAIT * 1000; now += 1000) await frame(screens, far, now);
  expect(host.images).toEqual(["/media/v.jpg"]);
  down = false;
  for (let now = FAILED_WAIT * 1000; now < FAILED_WAIT * 1000 + 2100; now += 16) await frame(screens, far, now);
  expect(host.images).toEqual(["/media/v.jpg", "/media/v.jpg"]);
  expect(screens.shows[0]!.layer).toBeGreaterThanOrEqual(0);
});

test("a library edit that puts another clip in a clip's number loads the new file; one that moves it does not", async () => {
  const host = new Host(), screens = new FaceScreens(), list = tvs([1, 2], [2, 2.5]), s = states();
  const NEW = "1111111111111111", MOVED = "2222222222222222";
  host.manifests.set(manifestPath(NEW), { clips: [image("a"), image("b"), image("c"), clip("w")], channels: [MANIFEST.channels[0], { ...MANIFEST.channels[1], items: ["w"] }] });
  host.manifests.set(manifestPath(MOVED), { clips: [image("z"), ...MANIFEST.clips], channels: MANIFEST.channels });
  screens.attach(host);
  for (const now of [0, 16, 32]) await frame(screens, list, now, { states: s });
  expect(host.videos.map((v) => v.src)).toEqual(["/media/v.mp4", "/media/v.mp4"]);
  for (const st of s) st.manifest = MOVED;
  for (const now of [48, 64, 80]) await frame(screens, list, now, { states: s });
  expect(host.videos.map((v) => [v.src, v.sets])).toEqual([["/media/v.mp4", 1], ["/media/v.mp4", 1]]);
  for (const st of s) st.manifest = NEW;
  for (const now of [96, 112, 128]) await frame(screens, list, now, { states: s });
  expect(host.videos.map((v) => [v.src, v.sets])).toEqual([["/media/w.mp4", 2], ["/media/w.mp4", 2]]);
});

test("when one of the two nearest screens changes, the other keeps its element", async () => {
  const host = new Host(), screens = new FaceScreens();
  screens.attach(host);
  for (const now of [0, 16, 32]) await frame(screens, tvs([1, 2], [2, 2.5]), now);
  expect(host.videos.map((v) => v.sets)).toEqual([1, 1]);
  // A third comes nearest: the second's element goes to it, the first's stays as it was.
  await frame(screens, tvs([3, 1.5], [1, 2], [2, 2.5]), 48);
  expect(host.videos.map((v) => v.sets)).toEqual([1, 2]);
  expect(screens.decoding).toBe(2);
  // One only a little nearer than those playing takes no element from them.
  for (const now of [64, 80, 96]) await frame(screens, tvs([2, 1.9], [1, 2], [3, 2.1]), now);
  expect(host.videos.map((v) => v.sets)).toEqual([1, 2]);
});

test("no prop clip starts until the map's art has stopped coming, or WAIT_FOR_ART after one was wanted", async () => {
  for (const idleAt of [5000, Infinity]) {
    const host = new Host(), screens = new FaceScreens(), list = tvs([1, 2], [2, 2.5]);
    screens.attach(host);
    let started = -1;
    for (let now = 1000; now <= 30_000 && started < 0; now += 500) {
      await frame(screens, list, now, { artIdle: now >= idleAt });
      if (screens.decoding > 0) started = now;
      // The posters come meanwhile.
      if (now > 2000 && started < 0) expect(screens.shows[0]!.layer).toBeGreaterThanOrEqual(0);
    }
    // A clip is first wanted the frame after its manifest comes.
    expect(started).toBe(Math.min(idleAt, 1500 + WAIT_FOR_ART));
    // Once started, art coming again does not stop it.
    await frame(screens, list, 31_000, { artIdle: false });
    expect(screens.decoding).toBe(2);
  }
});

test("a prop clip fetches only its size until it plays, and lets its stream go the frame it loses its screen", async () => {
  const host = new Host(), screens = new FaceScreens(), list = tvs([1, 2]), s = states();
  Object.assign(s[TV]!, { flags: SCREEN_FACING | SCREEN_FILL | SCREEN_ONCE, clip: 3, start: 3000 + 2 * TICK_RATE });
  screens.attach(host);
  for (const now of [0, 16]) await frame(screens, list, now, { states: s });
  const el = host.videos[0]!;
  expect([el.src, el.preload, el.paused]).toEqual(["/media/v.mp4", "metadata", true]);
  await frame(screens, list, 32, { states: s, tick: 3000 + 3 * TICK_RATE });
  expect([el.preload, el.paused]).toEqual(["auto", false]);
  await frame(screens, faces(0, 2), 48, { states: s, tick: 3000 + 3 * TICK_RATE });
  expect([el.src, el.preload, el.paused, el.loads, screens.decoding]).toEqual(["", "none", true, 1, 0]);
});

test("a type set to fit shows its picture whole, and the crop reaches the face's instance", async () => {
  const host = new Host(), screens = new FaceScreens(), p = new FramePacket(), list = faces(1, 2, 1, 30), s = states();
  screens.attach(host);
  for (const now of [0, 16, 32]) await frame(screens, list, now, { states: s }, p);
  // The TVs' 16:9 poster on a 5:3 face: filled, its sides are cut.
  expect(Array.from(screens.shows[0]!.crop)).toEqual(Array.from(pictureCrop(16 / 9, 1 / 0.6, true, new Float64Array(4))));
  expect(screens.shows[0]!.crop[0]).toBeLessThan(1);
  s[TV]!.flags = SCREEN_FACING;
  await frame(screens, list, 48, { states: s }, p);
  const fit = pictureCrop(16 / 9, 1 / 0.6, false, new Float64Array(4));
  expect(Array.from(screens.shows[0]!.crop)).toEqual(Array.from(fit));
  expect(fit[1]).toBeGreaterThan(1);
  p.faceCount = 0;
  writeFace(p, list, 0, FACES[2]!, new Camera(), screens.shows[0]!, 1);
  expect(Array.from(p.faces.subarray(FACE.crop, FACE.crop + 4))).toEqual(Array.from(Float32Array.from(fit)));
});
