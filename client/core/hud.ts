// HUD view model as plain data. A place is told as its latitude and longitude and drawn at its share of the map's picture
// (shared/world/coords.ts). The model is one object, and each widget of the HUD owns a slice of its fields (hud/widgets.ts).

import { CUE_DEAD, CUE_MATING_SHIFT } from "../../shared/anim/pose.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { handleIndex } from "../../shared/ids.ts";
import { MAX_VIEW } from "../../shared/net/view.ts";
import { STAGES, growthStep, maturity, stageOf, youngScale } from "../../shared/sim/breeding.ts";
import { sortU32 } from "../../shared/sort.ts";
import { HIT_NONE, castWorld, lookDirection, rayBox, rayHit } from "../../shared/world/ray.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import type { Camera } from "./render/camera.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { CombatModel } from "./feedback.ts";
import type { ActionModel } from "./hud/action.ts";
import type { BuffsModel } from "./hud/buffs.ts";
import type { CompassModel } from "./hud/compass.ts";
import type { CrosshairModel } from "./hud/crosshair.ts";
import type { DotsModel } from "./hud/dots.ts";
import type { FallenModel } from "./hud/fallen.ts";
import type { HotbarModel } from "./hud/hotbar.ts";
import type { JetModel } from "./hud/jet.ts";
import type { MarksModel } from "./hud/marks.ts";
import type { MinimapModel } from "./hud/minimap.ts";
import type { PromptModel } from "./hud/prompt.ts";
import { formatReadout, type ReadoutModel } from "./hud/readout.ts";
import type { RestartModel } from "./hud/restart.ts";
import type { SightModel } from "./hud/sight.ts";
import type { StateModel } from "./hud/state.ts";
import type { VehicleModel } from "./hud/vehicle.ts";
import type { VitalsModel } from "./hud/vitals.ts";
import type { VoiceModel } from "./hud/voice.ts";
import { HudFill } from "./hud/widget.ts";
import { HUD_WIDGETS } from "./hud/widgets.ts";
import type { ClientSession, RemoteSample } from "./session.ts";
import { paintRelief } from "./tactical.ts";

export { ACTION_DRAW, ACTION_NONE, ACTION_RELOAD, fillAction } from "./hud/action.ts";
export { fillBuffs } from "./hud/buffs.ts";
export { fillHotbar, type HotbarCell } from "./hud/hotbar.ts";
export { MAX_MARKERS, MINIMAP_SIZE, type Marker, type MarkerKind } from "./hud/minimap.ts";
export { headingOf } from "./hud/state.ts";
export { VehicleTelemetry } from "./hud/vehicle.ts";
export type { Vital } from "./hud/vitals.ts";

/** Metres from the eye that a look reaches, as on the server (server/overhead.ts LOOK_RANGE), and from the camera to a heart shown. Chosen. */
export const OVER_RANGE = 30;
/** The most hearts drawn. The nearest are kept. */
export const MAX_HEARTS = 24;
/** Rays a frame casts to find whether a heart is behind the world. The nearest hearts are tried first. */
export const HEART_RAYS = 40;

/** What a bar over a creature shows. */
export const BAR_HEALTH = 0;
export const BAR_FOOD = 1;
export const BAR_TORPOR = 2;
export const BAR_TAMING = 3;

/** How the creature looked at stands to the viewer. */
export const OWNER_WILD = 0;
export const OWNER_TRIBE = 1;
export const OWNER_OTHER = 2;

/** Marks over creatures, from the view and from what the server says of the one looked at. Places are fractions of the screen. */
export class OverheadModel {
  /** The entity looked at, its index and generation, or -1: what N marks through a sight (D1082). */
  lookedId = -1;
  lookedGen = 0;
  /** Metres to it. */
  lookedFar = 0;
  /** A creature is looked at, and its mark stands at (u, v). `heart` is the heart drawn over it, or -1. */
  look = false;
  u = 0;
  v = 0;
  heart = -1;
  /** An OWNER_ value. */
  owner = OWNER_WILD;
  /** Its name, or its species where it has none. Then its level, age and state, and the tribe that owns another tribe's. */
  title = "";
  line = "";
  tribe = "";
  /** The first barCount are shown, each a BAR_ kind and its share. */
  readonly bars: { kind: number; fraction: number }[] = [];
  barCount = 0;
  /** Below the bars: how well a taming goes, how far a mating is. */
  note = "";
  /** The first heartCount are shown, nearest first. `step` is the pair's mating step, or 0 for a heart that shows no progress. */
  readonly hearts: { u: number; v: number; far: number; step: number }[] = [];
  heartCount = 0;
  /** Hearts in range and on screen left out this frame, past MAX_HEARTS or past the rays a frame casts. */
  dropped = 0;
  /** Rays cast this frame, for measurement. */
  rays = 0;
}

/** Where the renderer posed each creature's marks this frame (client/core/render/characters.ts). */
export interface Heads {
  overhead(id: number, out: number[]): boolean;
}

/**
 * Every widget's slice of the model, on one object: `hud.prompt` is the prompt widget's field. A widget added to the
 * list has its fields here once the model is made; to have them typed here too, add its model to this line.
 */
export interface HudModel extends ActionModel, BuffsModel, CompassModel, CrosshairModel, DotsModel, FallenModel, HotbarModel, JetModel, MarksModel, MinimapModel, PromptModel, ReadoutModel, RestartModel, SightModel, StateModel, VehicleModel, VitalsModel, VoiceModel {}

export class HudModel {
  /** Hit marks and marks over creatures have models and builds of their own (feedback.ts, ui/tame.ts). */
  readonly combat = new CombatModel();
  readonly overhead = new OverheadModel();

  constructor() {
    const fields = this as unknown as Record<string, unknown>;
    for (const widget of HUD_WIDGETS) {
      const slice = widget.make?.() as Record<string, unknown> | undefined;
      for (const name in slice) {
        if (name in fields) throw new Error(`two HUD widgets have a field named ${name}: ${widget.name} is the second`);
        fields[name] = slice[name];
      }
    }
  }

  formatReadout(): void {
    formatReadout(this);
  }
}

const VIEW_FLAG_PLAYER = 4;
const VIEW_FLAG_PROP = 8;

/** Runs every widget's fill, in the list's order. Nothing is filled before the world has come. */
export function fillHud(model: HudModel, c: HudFill): void {
  if (!c.session.world) return;
  for (let i = 0; i < HUD_WIDGETS.length; i++) HUD_WIDGETS[i]!.fill?.(model, c);
}

const alone = new HudFill();

/** Fills the model from a session alone, as a test or a tool does. `scale` is screen pixels to a unit of the interface. */
export function updateHud(model: HudModel, session: ClientSession, remote: RemoteSample, fps: number, scale = 1, nowMs?: number): void {
  alone.session = session;
  alone.remote = remote;
  alone.fps = fps;
  alone.scale = scale;
  alone.nowMs = nowMs;
  fillHud(model, alone);
}

const over = { at: [0, 0, 0], screen: [0, 0, 0], dir: [0, 0, 0], keys: new Uint32Array(MAX_VIEW) };
const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** Scale of remote body `i` relative to its kind. Below 1 for a young one. */
function sizeOf(reg: Registry, remote: RemoteSample, i: number): number {
  return remote.grown[i] !== 0 && (remote.flags[i]! & VIEW_FLAG_PROP) === 0 ? youngScale(reg.birthScale[remote.kind[i]!]!, remote.span[i]!, remote.grown[i]!, remote.tick) : 1;
}

/** Writes where remote body `i` shows its marks: where it was drawn, or over its body's height where it was not posed. */
function headOf(reg: Registry, remote: RemoteSample, i: number, heads: Heads, out: number[]): void {
  if (heads.overhead(remote.id[i]!, out)) return;
  out[0] = remote.x[i]!;
  out[1] = remote.y[i]! + reg.bodyHeight[remote.kind[i]!]! * sizeOf(reg, remote, i) + 0.15;
  out[2] = remote.z[i]!;
}

function addBar(m: OverheadModel, kind: number, fraction: number): void {
  if (fraction < 0) return;
  const b = (m.bars[m.barCount++] ??= { kind, fraction });
  b.kind = kind;
  b.fraction = Math.max(0, Math.min(1, fraction));
}

/** What the mark over remote body `i` says to this viewer. */
function describe(m: OverheadModel, session: ClientSession, remote: RemoteSample, i: number): void {
  const reg = session.registry;
  const id = reg.ids[remote.kind[i]!] ?? "";
  const species = id.slice(id.indexOf(":") + 1).replace(/_/g, " ");
  const named = remote.name[i] !== "";
  const team = session.tribe.team;
  m.owner = remote.team[i] === 0 ? OWNER_WILD : team !== 0 && remote.team[i] === team ? OWNER_TRIBE : OWNER_OTHER;
  m.title = named ? remote.name[i]! : species.charAt(0).toUpperCase() + species.slice(1);
  const vehicle = reg.vehicle[remote.kind[i]!];
  m.line = vehicle ? `vehicle  ${vehicle.seats.length} seats` : `${named ? `${species}  ` : ""}level ${remote.level[i]}`;
  // How far a young one has grown shows to its tribe, and on one nobody has claimed.
  if (remote.grown[i] !== 0 && m.owner !== OWNER_OTHER) {
    const tick = Math.floor(remote.tick);
    m.line += `  ${STAGES[stageOf(growthStep(remote.span[i]!, remote.grown[i]!, tick))]} ${pct(maturity(remote.span[i]!, remote.grown[i]!, tick))}`;
  }
  m.tribe = "";
  m.note = "";
  m.barCount = 0;
  const told = session.looked;
  if (!told || told.id !== remote.id[i]) return;
  if (m.owner === OWNER_OTHER && told.tribe !== "") m.tribe = `of ${told.tribe}`;
  addBar(m, BAR_HEALTH, told.health);
  if (vehicle) return;
  addBar(m, BAR_FOOD, told.food);
  addBar(m, BAR_TORPOR, told.torpor);
  addBar(m, BAR_TAMING, told.taming);
  if (told.te >= 0) m.note = `${pct(told.te)} effective`;
  else if (told.mating >= 0) m.note = `mating ${pct(told.mating)}`;
}

/**
 * Fills the marks over creatures. `eye` is the height of the eye over the body, or -1 for a viewer that looks at nothing:
 * dead, unconscious or spectating. `yaw` and `pitch` are the aim in radians. The look is the ray the server casts for it, so
 * it stops at the world and at the first body. A heart shows over each creature of a mating pair in range, unless the
 * world is between it and the camera, with its progress only over the viewer's own tribe's.
 */
export function fillOverhead(m: OverheadModel, session: ClientSession, remote: RemoteSample, cam: Camera, heads: Heads, eye: number, yaw: number, pitch: number, reach = OVER_RANGE): void {
  m.look = false;
  m.lookedId = -1;
  m.heart = -1;
  m.heartCount = 0;
  m.dropped = 0;
  m.rays = 0;
  const world: CollisionWorld | null = session.world;
  if (!world) return;
  const reg = session.registry;
  const at = over.at;
  const screen = over.screen;
  const d = over.dir;
  const own = handleIndex(session.ownHandle);
  let looked = -1;
  if (eye >= 0) {
    lookDirection(Math.round((yaw / (2 * Math.PI)) * 65536) & 0xffff, Math.round((pitch / (Math.PI / 2)) * 16384), d);
    const ox = session.own.x;
    const oy = session.own.y + eye;
    const oz = session.own.z;
    // Through a sight a look reaches as far as its gaze, as the server's does (server/overhead.ts, D1082).
    let best = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, reach) === HIT_NONE ? reach : rayHit.t;
    for (let i = 0; i < remote.count; i++) {
      if ((remote.flags[i]! & VIEW_FLAG_PROP) !== 0 || remote.id[i] === own || remote.id[i] === session.driving) continue;
      const kind = remote.kind[i]!;
      const size = sizeOf(reg, remote, i);
      const r = reg.bodyRadius[kind]! * size;
      const t = rayBox(ox, oy, oz, d[0]!, d[1]!, d[2]!, remote.x[i]! - r, remote.y[i]!, remote.z[i]! - r, remote.x[i]! + r, remote.y[i]! + reg.bodyHeight[kind]! * size, remote.z[i]! + r);
      if (t < best) {
        best = t;
        looked = i;
      }
    }
    if (looked >= 0 && ((remote.flags[looked]! & VIEW_FLAG_PLAYER) !== 0 || (remote.cue[looked]! & CUE_DEAD) !== 0)) looked = -1;
    if (looked >= 0) {
      m.lookedId = remote.id[looked]!;
      m.lookedGen = remote.gen[looked]!;
      m.lookedFar = best;
      describe(m, session, remote, looked);
      headOf(reg, remote, looked, heads, at);
      const front = cam.project(at[0]!, at[1]!, at[2]!, screen);
      m.look = true;
      m.u = front ? screen[0]! : 0.5;
      m.v = front ? screen[1]! : 0.5;
    }
  }

  // Hearts, nearest first.
  const keys = over.keys;
  let n = 0;
  for (let i = 0; i < remote.count; i++) {
    if (((remote.cue[i]! >>> CUE_MATING_SHIFT) & 7) === 0 || (remote.flags[i]! & VIEW_FLAG_PROP) !== 0 || (remote.cue[i]! & CUE_DEAD) !== 0) continue;
    const dx = remote.x[i]! - cam.x;
    const dy = remote.y[i]! - cam.y;
    const dz = remote.z[i]! - cam.z;
    const far = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (far <= OVER_RANGE + 2) keys[n++] = Math.min(Math.floor(far * 256), 0xffff) * MAX_VIEW + i;
  }
  sortU32(keys, n);
  const team = session.tribe.team;
  for (let k = 0; k < n; k++) {
    const i = keys[k]! % MAX_VIEW;
    headOf(reg, remote, i, heads, at);
    const dx = at[0]! - cam.x;
    const dy = at[1]! - cam.y;
    const dz = at[2]! - cam.z;
    const far = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (far > OVER_RANGE || !cam.project(at[0]!, at[1]!, at[2]!, screen) || screen[0]! < 0 || screen[0]! > 1 || screen[1]! < 0 || screen[1]! > 1) continue;
    if (m.heartCount >= MAX_HEARTS || m.rays >= HEART_RAYS) {
      m.dropped++;
      continue;
    }
    m.rays++;
    if (far > 0.05 && castWorld(world, cam.x, cam.y, cam.z, dx / far, dy / far, dz / far, far - 0.05) !== HIT_NONE) continue;
    if (i === looked) m.heart = m.heartCount;
    const h = (m.hearts[m.heartCount++] ??= { u: 0, v: 0, far: 0, step: 0 });
    h.u = screen[0]!;
    h.v = screen[1]!;
    h.far = far;
    h.step = team !== 0 && remote.team[i] === team ? (remote.cue[i]! >>> CUE_MATING_SHIFT) & 7 : 0;
  }
}

/** A top-down RGBA picture of the whole terrain, north up, with relief shading: the one tile of the map's far zoom, the map at its middle. */
export function minimapImage(hf: Heightfield, palette: Uint8Array, size: number): Uint8ClampedArray {
  const out = new Uint32Array(size * size);
  paintRelief(hf, palette, 0, 0, 0, size, out);
  return new Uint8ClampedArray(out.buffer);
}
