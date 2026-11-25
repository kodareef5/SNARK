// The Screens page's stage: the Vegas ball as its players see it, drawn by the game's own shader (render/orb.ts), and
// the tiles of what it can show. The page draws it with WebGL (client/admin/screens-stage.ts); this is what needs no
// browser: the cameras, the frame's lanes, what is live at a moment, the tiles and the edit that takes one live.

import { tierOf, type Tier } from "../assets/tiers.ts";
import { ORB_FRAGMENT, SCREEN_AT, groundLine, newOrbMemory, writeOrb, type OrbScreen } from "../render/orb.ts";
import { FRAME_FLOATS, ORB_AT } from "../render/packet.ts";
import { postFrame } from "../render/post.ts";
import { withDefines } from "../render/programs.ts";
import { base64Bytes } from "../video/player.ts";
import { skyFrame, theSky } from "../render/sky.ts";
import { SCENE_SHOW, heldSceneOf, type Channel } from "../../../shared/video/clip.ts";
import { channelAt, screenAt } from "../../../shared/video/programme.ts";
import { ORB_HOLD, ORB_SCENES, type OrbSite } from "../../../shared/world/orb.ts";
import { timedOf, type ScreensState, type StateClip, type StateScreen } from "./screens.ts";

/** The Sphere as Las Vegas has it, at the origin. Where it stands does not change what it shows. */
export const STAGE_SITE: OrbSite = { name: "Sphere", x: 0, y: 0, z: 0, yaw: 0, radius: 78, centre: 34 };
/** The tier the stage draws at: the one most players have. */
export const STAGE_TIER: Tier = tierOf("medium");
const RATE = 30;

/** A place to see the ball from: metres from its axis, metres over the ground, and the camera's angle of view up and down. */
export interface StageView {
  readonly key: string;
  readonly label: string;
  readonly distance: number;
  readonly lift: number;
  readonly fov: number;
}
export const STAGE_VIEWS: readonly StageView[] = [
  { key: "street", label: "From the street", distance: 420, lift: 2, fov: (40 * Math.PI) / 180 },
  { key: "foot", label: "At its foot", distance: 150, lift: 2, fov: (72 * Math.PI) / 180 },
  { key: "air", label: "From the air", distance: 420, lift: 320, fov: (40 * Math.PI) / 180 },
];

/** A camera: the eye in the world, its up, and the matrix that takes a point from the eye to the screen. */
export interface StageCamera {
  readonly eye: Float64Array;
  readonly up: Float64Array;
  readonly viewProj: Float32Array;
}
export const newStageCamera = (): StageCamera => ({ eye: new Float64Array(3), up: new Float64Array(3), viewProj: new Float32Array(16) });

/** The camera of `view` from `bearing` (radians round the ball), aimed at its middle, for a picture `aspect` wide to its height. */
export function stageCamera(view: StageView, bearing: number, aspect: number, out: StageCamera): StageCamera {
  const s = STAGE_SITE, ex = view.distance * Math.sin(bearing), ey = view.lift, ez = view.distance * Math.cos(bearing);
  // Aimed a little over the middle from the street, where the ground hides the bottom.
  const ty = s.centre + (view.lift < s.centre ? s.radius * 0.15 : 0);
  let fx = -ex, fy = ty - ey, fz = -ez;
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // Right is forward across world up; up is right across forward.
  let rx = -fz, rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const t = 1 / Math.tan(view.fov / 2), near = 1, far = 6000, m = out.viewProj;
  // Column-major: the view's rows (right, up, back) scaled by the projection.
  const px = t / aspect, py = t, pz = (far + near) / (near - far), pw = (2 * far * near) / (near - far);
  m[0] = px * rx; m[4] = 0; m[8] = px * rz; m[12] = 0;
  m[1] = py * ux; m[5] = py * uy; m[9] = py * uz; m[13] = 0;
  m[2] = -pz * fx; m[6] = -pz * fy; m[10] = -pz * fz; m[14] = pw;
  m[3] = fx; m[7] = fy; m[11] = fz; m[15] = 0;
  out.eye[0] = ex;
  out.eye[1] = ey;
  out.eye[2] = ez;
  out.up[0] = ux;
  out.up[1] = uy;
  out.up[2] = uz;
  return out;
}

/** What the ball shows: a scene held (or -1 for the scenes in turn, `programme` being the world's own choice), or a clip at a time. */
export interface StageLook {
  readonly only: number;
  readonly clip: StateClip | null;
  readonly clipSeconds: number;
  readonly facing: boolean;
  readonly fill: boolean;
}

/** Something the ball can be told to show, as the tiles offer it. */
export type Target =
  | { readonly kind: "scenes" }
  | { readonly kind: "scene"; readonly scene: number }
  | { readonly kind: "clip"; readonly clip: string }
  | { readonly kind: "channel"; readonly name: string };

/** A target's key, unique among the tiles. */
export function targetKey(t: Target): string {
  if (t.kind === "scenes") return "scenes";
  if (t.kind === "scene") return SCENE_SHOW + ORB_SCENES[t.scene];
  return t.kind === "clip" ? `clip:${t.clip}` : `channel:${t.name}`;
}

/** The ball's screen in a state. */
export const orbOf = (st: ScreensState): StateScreen | undefined => st.screens.find((s) => s.screen === "orb");

/** The scene the world's own setting holds, else -1, for a show of "scenes". */
const sceneOfShow = (show: string, st: ScreensState): number => (show === "scenes" ? st.world.only : heldSceneOf(show));

/** What the ball shows at `wall` (ms on the server's clock), as its players see it. */
export function liveLook(st: ScreensState, wall: number): StageLook {
  const orb = orbOf(st);
  if (!orb) return { only: st.world.only, clip: null, clipSeconds: 0, facing: true, fill: true };
  const channels = new Map(st.channels.map((c) => [c.name, c] as const));
  const playing = screenAt(orb, channels, timedOf(st.clips), wall, st.night);
  const clip = playing ? (st.clips.find((c) => c.id === playing.clip) ?? null) : null;
  return { only: sceneOfShow(orb.show, st), clip, clipSeconds: playing ? (wall - playing.start) / 1000 : 0, facing: orb.mode === "facing", fill: orb.fill };
}

/** What the ball would show of `target`, `since` ms after it was picked: a clip from its start, a channel as it plays now. */
export function targetLook(st: ScreensState, target: Target, since: number, wall: number): StageLook {
  const orb = orbOf(st), facing = orb ? orb.mode === "facing" : true, fill = orb ? orb.fill : true;
  if (target.kind === "scenes") return { only: st.world.only, clip: null, clipSeconds: 0, facing, fill };
  if (target.kind === "scene") return { only: target.scene, clip: null, clipSeconds: 0, facing, fill };
  if (target.kind === "clip") {
    const clip = st.clips.find((c) => c.id === target.clip) ?? null;
    return { only: -1, clip, clipSeconds: clip && clip.seconds > 0 ? (since / 1000) % clip.seconds : 0, facing, fill };
  }
  const channel = st.channels.find((c) => c.name === target.name);
  const playing = channel ? channelAt(channel, timedOf(st.clips), wall) : null;
  const clip = playing ? (st.clips.find((c) => c.id === playing.clip) ?? null) : null;
  return { only: -1, clip, clipSeconds: playing ? (wall - playing.start) / 1000 : 0, facing, fill };
}

/** The key of the tile that is live at `wall`: the clip playing once, else what the ball is set to show. */
export function liveKey(st: ScreensState, wall: number): string {
  const orb = orbOf(st);
  if (!orb) return "scenes";
  const once = orb.once ? st.clips.find((c) => c.id === orb.once!.clip) : undefined;
  if (orb.once && once && wall >= orb.once.from && wall < orb.once.from + once.seconds * 1000) return `clip:${once.id}`;
  if (orb.show === "scenes" || heldSceneOf(orb.show) >= 0) return orb.show;
  return `channel:${orb.show}`;
}

/** The edit that takes `target` live on the ball (server/video/routes.ts op "take"). */
export function takeBody(target: Target): Record<string, unknown> {
  if (target.kind === "clip") return { op: "take", screen: "orb", clip: target.clip };
  return { op: "take", screen: "orb", show: target.kind === "scenes" ? "scenes" : target.kind === "scene" ? SCENE_SHOW + ORB_SCENES[target.scene] : target.name };
}

/** The scenes as the tiles name them, in ORB_SCENES order. */
export const SCENE_TILES: readonly { readonly title: string; readonly note: string }[] = [
  { title: "Watcher", note: "A reptile's eye as big as the ball, looking round at the sky and the drops." },
  { title: "Moon", note: "A moon by night, lit from where the sun is." },
  { title: "Core", note: "Magma under cracked plates, beating up the ball." },
  { title: "Storm", note: "A thunderhead in glass, with rain and lightning." },
  { title: "Tide", note: "A glass of water that fills and drains with the blue eye." },
];

/** A tile: what it takes live, its words, the clip it shows (for its poster), and which group it is in. */
export interface Tile {
  readonly key: string;
  readonly target: Target;
  readonly group: "scenes" | "clips" | "channels";
  readonly title: string;
  readonly note: string;
  /** The clip the tile pictures, if any. */
  readonly clip: StateClip | null;
}

const minutes = (seconds: number): string => (seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`);

/** Every tile: the scenes in turn, each scene, each clip a screen may play, and each channel with something to play. */
export function stageTiles(st: ScreensState): Tile[] {
  const held = st.world.only;
  const tiles: Tile[] = [{
    key: "scenes", target: { kind: "scenes" }, group: "scenes", title: "Scenes in turn",
    note: held >= 0 ? `This world's setting holds it on ${SCENE_TILES[held]!.title}.` : `Each scene for ${minutes(ORB_HOLD)}, one wiped into the next.`, clip: null,
  }];
  SCENE_TILES.forEach((s, scene) => tiles.push({ key: targetKey({ kind: "scene", scene }), target: { kind: "scene", scene }, group: "scenes", title: s.title, note: s.note, clip: null }));
  const timed = timedOf(st.clips);
  for (const c of st.clips) if (timed.has(c.id)) tiles.push({ key: `clip:${c.id}`, target: { kind: "clip", clip: c.id }, group: "clips", title: c.title, note: `${minutes(c.seconds)}, once, then back`, clip: c });
  for (const ch of st.channels) {
    const items = ch.items.filter((id) => timed.has(id));
    if (!items.length) continue;
    tiles.push({ key: `channel:${ch.name}`, target: { kind: "channel", name: ch.name }, group: "channels", title: ch.name, note: `${items.length} clip${items.length === 1 ? "" : "s"}, ${ch.shuffle ? "shuffled" : "in order"}, round and round`, clip: st.clips.find((c) => c.id === items[0]) ?? null });
  }
  return tiles;
}

/** What a tile shows when taken: words for the line under the monitors. */
export function lookWords(st: ScreensState, look: StageLook): string {
  if (look.clip) return look.clip.title;
  if (look.only >= 0) return SCENE_TILES[look.only]!.title;
  return "The scenes in turn";
}

/** The clip after the one playing on the ball, its title, or "" where the scenes follow or nothing plays. */
export function nextWords(st: ScreensState, wall: number): string {
  const orb = orbOf(st);
  if (!orb) return "";
  const playing = screenAt(orb, new Map<string, Channel>(st.channels.map((c) => [c.name, c])), timedOf(st.clips), wall, st.night);
  if (!playing) return "";
  if (playing.next) return st.clips.find((c) => c.id === playing.next)?.title ?? "";
  const back = heldSceneOf(orb.show);
  return back >= 0 ? SCENE_TILES[back]!.title : orb.show === "scenes" ? "The scenes in turn" : "";
}

/** The sky and the ground behind the ball at `hour`, linear-ish sRGB from 0 to 1: the sky's top, its foot and the ground. */
export function stageSky(hour: number): { top: number[]; foot: number[]; ground: number[] } {
  // The sun's height as the day's sine: 1 at noon, -1 at midnight.
  const sun = Math.sin(((hour - 6) / 24) * 2 * Math.PI), day = smooth(-0.08, 0.25, sun), dusk = 1 - smooth(0, 0.3, Math.abs(sun));
  const mix = (a: number[], b: number[], t: number): number[] => a.map((x, i) => x + (b[i]! - x) * t);
  const top = mix([0.012, 0.018, 0.05], [0.24, 0.45, 0.78], day);
  const foot = mix(mix([0.04, 0.05, 0.11], [0.62, 0.74, 0.88], day), [0.86, 0.48, 0.24], dusk * 0.7);
  const ground = mix([0.03, 0.03, 0.035], [0.42, 0.38, 0.32], day);
  return { top, foot, ground };
}
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A clip's colour track from the state's base64. */
export const trackOf = (clip: StateClip): Uint8Array => base64Bytes(clip.colours);

/** The picture the texture holds: its size and its highest mip level. */
export interface StagePicture {
  readonly width: number;
  readonly height: number;
  readonly levels: number;
}

/**
 * One view of the ball's frame lanes, as the game writes them for a player there. Each keeps what it showed, so a
 * change is the game's own wipe; a still one, for a tile, shows what it shows with no wipe.
 */
export class StageFrame {
  readonly frame = new Float32Array(FRAME_FLOATS);
  private readonly memory = newOrbMemory();
  private readonly screen: OrbScreen = { shows: -1, width: 0, height: 0, texWidth: 0, texHeight: 0, levels: 0, facing: true, fill: true, track: null, seconds: 0, upX: 0, upY: 1, upZ: 0 };
  private readonly tracks = new Map<string, Uint8Array>();
  private readonly numbers = new Map<string, number>();
  private started = false;

  /**
   * The lanes for `look` seen by `cam`, at the world's clock `seconds` and `hour`, the ball's brightness `gain` and the
   * picture the texture holds of its clip (null while none is ready: the scenes show). `height` is the picture's in pixels.
   */
  write(look: StageLook, cam: StageCamera, seconds: number, hour: number, gain: number, picture: StagePicture | null, height: number, still = false): void {
    const f = this.frame, s = this.screen, clip = look.clip && picture ? look.clip : null;
    f.fill(0);
    skyFrame(hour, theSky(), f);
    postFrame(f, STAGE_TIER, hour, height);
    if (clip) {
      let track = this.tracks.get(clip.id);
      if (!track) this.tracks.set(clip.id, (track = trackOf(clip)));
      let n = this.numbers.get(clip.id);
      if (n === undefined) this.numbers.set(clip.id, (n = this.numbers.size));
      s.shows = n;
      s.width = s.texWidth = picture!.width;
      s.height = s.texHeight = picture!.height;
      s.levels = picture!.levels;
      s.facing = look.facing;
      s.fill = look.fill;
      s.track = track;
      s.seconds = Math.max(0, look.clipSeconds);
      s.upX = cam.up[0]!;
      s.upY = cam.up[1]!;
      s.upZ = cam.up[2]!;
    }
    const ex = cam.eye[0]!, ey = cam.eye[1]!, ez = cam.eye[2]!;
    // The first frame starts as though it had shown this for a while: the page opening is no change.
    if (!this.started || still) writeOrb(f, [STAGE_SITE], [], seconds - 60, hour, ex, ey, ez, null, 0, RATE, look.only, gain, clip ? s : null, this.memory);
    this.started = true;
    writeOrb(f, [STAGE_SITE], [], seconds, hour, ex, ey, ez, null, Math.round(seconds * RATE), RATE, look.only, gain, clip ? s : null, this.memory);
    if (still) {
      f[ORB_AT + 9] = f[ORB_AT + 8]!;
      f[ORB_AT + 10] = 1;
      f[SCREEN_AT + 31] = 0;
    }
  }
}

// ---- What the page's WebGL draws with.

/** The ball's shell: a unit sphere from where the ground cuts it to the top, as positions and triangles. */
export function stageSphere(rings = 48, round = 96): { positions: Float32Array; indices: Uint16Array } {
  const low = Math.asin(groundLine(STAGE_SITE)), positions = new Float32Array((rings + 1) * (round + 1) * 3), indices = new Uint16Array(rings * round * 6);
  let p = 0, i = 0;
  for (let r = 0; r <= rings; r++) {
    const lat = low + ((Math.PI / 2 - low) * r) / rings, c = Math.cos(lat), y = Math.sin(lat);
    for (let k = 0; k <= round; k++) {
      const lon = (k / round) * 2 * Math.PI;
      positions[p++] = c * Math.sin(lon);
      positions[p++] = y;
      positions[p++] = c * Math.cos(lon);
    }
  }
  for (let r = 0; r < rings; r++) for (let k = 0; k < round; k++) {
    const a = r * (round + 1) + k, b = a + round + 1;
    indices[i++] = a; indices[i++] = a + 1; indices[i++] = b;
    indices[i++] = a + 1; indices[i++] = b + 1; indices[i++] = b;
  }
  return { positions, indices };
}

/** The ground round the ball: a disc `radius` metres across at the ball's foot, as a fan of positions in metres from the ball's middle. */
export function stageGround(radius = 5000, round = 64): Float32Array {
  const out = new Float32Array((round + 2) * 3), y = -STAGE_SITE.centre;
  out[1] = y;
  for (let k = 0; k <= round; k++) {
    const a = (k / round) * 2 * Math.PI;
    out[(k + 1) * 3] = radius * Math.sin(a);
    out[(k + 1) * 3 + 1] = y;
    out[(k + 1) * 3 + 2] = radius * Math.cos(a);
  }
  return out;
}

/** The vertex text for the ball and the ground: a point from the ball's middle, scaled, moved to the eye and projected. */
export const STAGE_VERTEX = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform vec4 uBall;
uniform float uClip;
out vec3 vRel;
void main() {
  vRel = uBall.xyz + aPos * uBall.w;
  gl_Position = uClip > .5 ? vec4(aPos.xy, .9999, 1.) : uViewProj * vec4(vRel, 1.);
}`;

/** The fragment text for the sky (a gradient up the picture) and the ground (one colour fading into the haze). */
export const STAGE_FLAT_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vRel;
uniform vec3 uTop, uFoot;
uniform float uHeight, uClip;
out vec4 o;
void main() {
  if (uClip > .5) { o = vec4(mix(uFoot, uTop, smoothstep(.2, 1., gl_FragCoord.y / uHeight)), 1.); return; }
  o = vec4(mix(uTop, uFoot, smoothstep(600., 4000., length(vRel.xz))), 1.);
}`;

/** The game's own orb fragment text for the stage's tier, with no light target: its colour is as a player's screen shows it. */
export const stageOrbFragment = (tier: Tier = STAGE_TIER): string =>
  withDefines(ORB_FRAGMENT, `#define ORB_OCTAVES ${tier.orb.octaves}\n` + (tier.orb.pucks ? "#define ORB_PUCKS\n" : ""));
