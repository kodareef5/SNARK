// HUD view model as plain data. Places are in ARK's latitude and longitude (shared/world/coords.ts).

import { CUE_DEAD, CUE_MATING_SHIFT } from "../../shared/anim/pose.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { handleIndex } from "../../shared/ids.ts";
import { MAX_VIEW } from "../../shared/net/view.ts";
import { STAGES, growthStep, maturity, stageOf, youngScale } from "../../shared/sim/breeding.ts";
import { sortU32 } from "../../shared/sort.ts";
import { HOTBAR_SLOTS, type Inventory } from "../../shared/sim/items.ts";
import { CHOOSE_DIED, CMD_MAP_ZOOM, SESSION_ALIVE, SESSION_DEAD, SESSION_SPECTATING } from "../../shared/net/protocol.ts";
import { MF_OUT, STAMINA_UNITS, type Body } from "../../shared/sim/character.ts";
import type { VehicleSpec } from "../../shared/sim/vehicle.ts";
import { DEFAULT_DRIVETRAIN, drivetrainShifting } from "../../shared/sim/vehicle-drivetrain.ts";
import { HIT_NONE, castWorld, lookDirection, rayBox, rayHit } from "../../shared/world/ray.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import type { Camera } from "./render/camera.ts";
import { ACT_DRAW, ACT_HOLD, ACT_RELOAD } from "../../shared/sim/weapon.ts";
import { formatHour, hourOfDay } from "../../shared/sim/clock.ts";
import { V_FOOD, V_HEALTH, V_OXYGEN, V_TORPOR, V_WATER } from "../../shared/sim/vitals.ts";
import { latLonText, latOf, lonOf } from "../../shared/world/coords.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { MARK_MATE, MARK_OTHER, MARK_TAME, MAX_MARKS, PLAYERS_OFF, type Marks } from "../../shared/world/tactical.ts";
import { CombatModel } from "./feedback.ts";
import type { ClientSession, RemoteSample } from "./session.ts";
import { paintRelief, type Chart } from "./tactical.ts";

/** One of the reader's tribe is a mate and one of its creatures a tame. A player is a survivor of another tribe, and a creature is not the tribe's. */
export type MarkerKind = "self" | "mate" | "tame" | "death" | "spawn" | "player" | "creature";

export interface Marker {
  kind: MarkerKind;
  /** Where on the map, 0..1 from its north-west corner: longitude and latitude over 100. */
  u: number;
  v: number;
}

/** The most markers a map shows. The model lists the most important first, and what is past this is left out. */
export const MAX_MARKERS = 256;
/** The minimap's side, in units of the interface. */
export const MINIMAP_SIZE = 160;
/** Metres. A mark this near a body of its kind in view is that body, which is drawn from the view. */
const SAME_BODY = 16;

export interface Vital {
  id: string;
  label: string;
  /** 0..1. */
  fraction: number;
}

/** label is the first letters of the item's name. number is a count, or the rounds loaded. */
export interface HotbarCell {
  label: string;
  /** 0xRRGGBB, or -1 for an empty slot. */
  tint: number;
  number: string;
  /** The item's content id, which its picture is found by (ui/hud.ts). */
  id?: string;
}

export function fillHotbar(m: HudModel, inv: Inventory | null, held: number, reg: Registry, palette: Uint8Array): void {
  const first = inv ? inv.hotbar : -1;
  m.held = held;
  if (first < 0) {
    m.hotbar.length = 0;
    return;
  }
  for (let i = 0; i < HOTBAR_SLOTS; i++) {
    const cell = (m.hotbar[i] ??= { label: "", tint: -1, number: "" });
    const item = inv!.item[first + i]!;
    const def = item === 0 ? null : (reg.defs[item] as ItemDef | null);
    if (!def) {
      cell.label = "";
      cell.tint = -1;
      cell.number = "";
      cell.id = "";
      continue;
    }
    cell.id = def.id;
    const name = def.label ?? def.id.slice(def.id.indexOf(":") + 1);
    const c = (def.color ?? 15) * 4;
    cell.label = name.slice(0, 4);
    cell.tint = (palette[c]! << 16) | (palette[c + 1]! << 8) | palette[c + 2]!;
    cell.number = inv!.count[first + i]! > 1 ? String(inv!.count[first + i]) : def.weapon?.ammo ? String(inv!.loaded[first + i]) : "";
  }
}

export function fillBuffs(m: HudModel, session: ClientSession | null, reg: Registry, palette: Uint8Array): void {
  m.buffs.length = 0;
  if (!session) return;
  for (const b of session.buffs) {
    const def = reg.defs[b.buff];
    if (def?.type !== "buff") continue;
    const c = def.color * 4;
    m.buffs.push({ label: def.label, tint: (palette[c]! << 16) | (palette[c + 1]! << 8) | palette[c + 2]!, seconds: b.until === 0 ? -1 : Math.max(0, Math.ceil((b.until - session.serverTick) / TICK_RATE)) });
  }
}

/** Values of HudModel.actionKind. */
export const ACTION_NONE = 0;
export const ACTION_DRAW = 1;
export const ACTION_RELOAD = 2;

export function fillAction(m: HudModel, session: ClientSession | null, reg: Registry): void {
  m.actionKind = ACTION_NONE;
  m.actionFraction = 0;
  m.ammo = "";
  if (!session) return;
  const b = session.own;
  const w = reg.weapon[b.held];
  if (!w || w.clip === 0) return;
  if (b.act === ACT_DRAW || b.act === ACT_HOLD) {
    m.actionKind = ACTION_DRAW;
    m.actionFraction = b.act === ACT_HOLD || w.drawTicks === 0 ? 1 : b.actTicks / w.drawTicks;
  } else if (b.act === ACT_RELOAD) {
    m.actionKind = ACTION_RELOAD;
    m.actionFraction = w.reloadTicks === 0 ? 1 : b.actTicks / w.reloadTicks;
  }
  const inv = session.inventory;
  const slot = inv && inv.hotbar >= 0 && session.held >= 0 ? inv.hotbar + session.held : -1;
  const kind = slot >= 0 ? inv!.ammo[slot]! : 0;
  const def = kind !== 0 ? (reg.defs[kind] as ItemDef | null) : null;
  m.ammo = def ? `${def.label ?? def.id.slice(def.id.indexOf(":") + 1)}  ${b.rounds} / ${inv!.total(kind)}` : "not loaded";
}

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

/** Instruments read the predicted mechanical state; audio load and tire slip remain presentation only. */
export class VehicleTelemetry {
  active = false;
  id = -1;
  speed = 0;
  forward = 0;
  lateral = 0;
  throttle = 0;
  brake = 0;
  handbrake = false;
  grounded = true;
  fuel = 0;
  gear = 1;
  rpm = 0;
  redline = DEFAULT_DRIVETRAIN.redlineRpm;
  load = 0;
  slip = 0;

  stop(): void { this.active = false; this.id = -1; this.rpm = this.load = this.slip = 0; }

  update(id: number, body: Body, throttle: number, handbrake: boolean, spec: VehicleSpec, _dt: number): void {
    this.active = true; this.id = id;
    this.forward = body.vx * Math.sin(body.vehicleYaw) + body.vz * Math.cos(body.vehicleYaw);
    this.lateral = body.vx * Math.cos(body.vehicleYaw) - body.vz * Math.sin(body.vehicleYaw);
    this.speed = Math.hypot(body.vx, body.vz);
    this.throttle = Math.max(-1, Math.min(1, throttle));
    this.handbrake = handbrake;
    this.brake = handbrake ? 1 : this.forward * this.throttle < -.2 ? Math.abs(this.throttle) : 0;
    this.grounded = body.grounded;
    this.fuel = Math.max(0, Math.min(1, body.fuel / spec.fuelCapacity));
    this.gear = body.vehicleGear;
    this.rpm = body.vehicleRpm;
    const drivetrain = spec.drivetrain ?? DEFAULT_DRIVETRAIN;
    this.redline = drivetrain.redlineRpm;
    const shift = drivetrainShifting(body.vehicleShiftTime, drivetrain) ? .35 : 1;
    this.load = this.fuel > 0 ? Math.abs(this.throttle) * (this.brake > 0 ? .25 : 1) * shift : 0;
    this.slip = body.grounded && this.speed > 2 ? Math.max(0, Math.min(1, (Math.abs(this.lateral) - .4) / 4 + (handbrake ? this.speed / 28 : 0))) : 0;
  }
}

export class HudModel {
  vehicle: VehicleTelemetry | null = null;
  /** The microphone's state, or why it is off. "" for nothing. */
  voice = "";
  readonly talkers: string[] = [];
  /** 0 to 1, for the settings screen. */
  micLevel = 0;
  lat = 50;
  lon = 50;
  x = 0;
  y = 0;
  z = 0;
  /** Degrees clockwise from north. */
  heading = 0;
  compass = "N";
  speed = 0;
  pingMs = 0;
  fps = 0;
  /** What the governor has done, after the frame rate, or "" (client/core/governor.ts). */
  steady = "";
  corrections = 0;
  nearby = 0;
  /** Stamina comes from the predicted body, the others from vitals evaluated at the server's tick. */
  readonly vitals: Vital[] = [
    { id: "health", label: "Health", fraction: 1 },
    { id: "stamina", label: "Stamina", fraction: 1 },
    { id: "food", label: "Food", fraction: 1 },
    { id: "water", label: "Water", fraction: 1 },
    { id: "oxygen", label: "Oxygen", fraction: 1 },
    { id: "torpor", label: "Torpor", fraction: 0 },
  ];
  /** tint is 0xRRGGBB. seconds is -1 for no end. */
  readonly buffs: { label: string; tint: number; seconds: number }[] = [];
  /** The body is unconscious. */
  out = false;
  /** The most important first: the reader, mates, tames, deaths, other survivors, then creatures in view. */
  readonly markers: Marker[] = [];
  /** How many more the last update had than a map shows. They were the least important. */
  unmarked = 0;
  private readonly pool: Marker[] = [];
  /** The map's pictures and where they look. Null until the app has the world, and then both screens show the whole map. */
  chart: Chart | null = null;
  /** Screen pixels to a unit of the interface, so the map's pictures are made at the size they are shown. */
  scale = 1;
  /** Counts updates. `mapSeen` is the update during which the map screen was last built. */
  frames = 0;
  mapSeen = -2;
  /** The map screen's picture on the canvas, and the place last pointed at on it as fractions of the map, or -1. */
  readonly mapBox = { x: 0, y: 0, size: 1 };
  pointedU = -1;
  pointedV = -1;
  /** The tick at which the server was last told the zoom, the marks last compared with the view, and which of them are bodies in view. */
  zoomAsked = -1000;
  private marksSeen = -1;
  private readonly inView = new Uint8Array(MAX_MARKS);
  /** Lines at the top left, rewritten a few times a second. */
  readonly readout: string[] = ["", "", ""];
  /** Time of day, "06:30". */
  clock = "";
  /** Connection state, or "". */
  status = "";
  /** A word across the top such as "SPECTATING" or "DEAD", or "". */
  banner = "";
  crosshair = true;
  /**
   * The held weapon's cone about the crosshair, as a share of half the view's height (the tangent of the cone over that of
   * half the field of view), or -1 for nothing held that has one.
   */
  cone = -1;
  /**
   * Looking through a scope: its reticle in place of the crosshair (Scope Attachment: "based on the German Post design").
   * The view of a holo-scope fitted: its crosshair shows even unaimed and even where the rules hide the crosshair
   * (`holo`), coloured by what it is on (`crossTint`, 0xRRGGBB, or -1 for the crosshair's own colour), and aimed through it
   * the view takes a green night tint of opacity `tint` (Holo-Scope Attachment).
   */
  scope = false;
  holo = false;
  crossTint = -1;
  tint = 0;
  /** Laser dots on the screen (client/core/render/laser.ts), as fractions of it. Only the first `dotCount` are current. */
  readonly dots: { u: number; v: number; alpha: number }[] = [];
  dotCount = 0;
  prompt = "";
  /** Empty for a body that has no hotbar. `held` is the slot in hand, or -1. */
  readonly hotbar: HotbarCell[] = [];
  held = -1;
  /** The bar under the crosshair: an ACTION_ kind, and how far along it is, 0 to 1. */
  actionKind = ACTION_NONE;
  actionFraction = 0;
  /** The loaded ammunition, the rounds in the weapon, and those carried. "" for a weapon that takes none. */
  ammo = "";
  readonly combat = new CombatModel();
  readonly overhead = new OverheadModel();
  private readoutAge = 0;

  /** Adds a marker at (x, z), unless the map has all it shows. */
  mark(kind: MarkerKind, hf: Heightfield, x: number, z: number): void {
    const n = this.markers.length;
    if (n >= MAX_MARKERS) {
      this.unmarked++;
      return;
    }
    const m = (this.pool[n] ??= { kind, u: 0, v: 0 });
    m.kind = kind;
    m.u = lonOf(hf, x) / 100;
    m.v = latOf(hf, z) / 100;
    this.markers.push(m);
  }

  /**
   * Whether mark `i` is a body the view holds, which is then drawn from the view, where it moves every frame. The marks
   * carry no names, so a mark is taken for a body of its kind standing within SAME_BODY of it. Worked out once for each
   * message of marks.
   */
  seenInView(marks: Marks, i: number, remote: RemoteSample, team: number): boolean {
    if (marks.version !== this.marksSeen) {
      this.marksSeen = marks.version;
      for (let k = 0; k < marks.count; k++) {
        const kind = marks.kind[k]!;
        let found = 0;
        for (let j = 0; j < remote.count && found === 0; j++) {
          const player = (remote.flags[j]! & VIEW_FLAG_PLAYER) !== 0;
          const mine = team !== 0 && remote.team[j] === team;
          if ((remote.flags[j]! & VIEW_FLAG_PROP) !== 0 || (kind === MARK_MATE ? !player || !mine : kind === MARK_TAME ? player || !mine : !player || mine)) continue;
          const dx = remote.x[j]! - marks.x[k]!;
          const dz = remote.z[j]! - marks.z[k]!;
          if (dx * dx + dz * dz < SAME_BODY * SAME_BODY) found = 1;
        }
        this.inView[k] = found;
      }
    }
    return this.inView[i] === 1;
  }

  formatReadout(): void {
    this.readout[0] = `${latLonText(this.lat, this.lon)}  ${this.compass} ${this.heading.toFixed(0)}`;
    this.readout[1] = `x ${this.x.toFixed(1)}  y ${this.y.toFixed(1)}  z ${this.z.toFixed(1)}  ${this.speed.toFixed(1)} m/s`;
    this.readout[2] = `${this.fps.toFixed(0)} fps${this.steady}  ${this.pingMs.toFixed(0)} ms  ${this.corrections} corrections  ${this.nearby} nearby`;
  }

  /** True once every `every` calls. */
  readoutDue(every: number): boolean {
    if (this.readoutAge++ % every !== 0) return false;
    return true;
  }
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** Bits of the replicated entity flags. */
const VIEW_FLAG_PLAYER = 4;
const VIEW_FLAG_PROP = 8;

/** Where x is across the map, 0 at its west edge and 1 at its east. */
export function mapU(hf: Heightfield, x: number): number {
  return lonOf(hf, x) / 100;
}

/** Where z is down the map, 0 at its north edge and 1 at its south. */
export function mapV(hf: Heightfield, z: number): number {
  return latOf(hf, z) / 100;
}

export function headingOf(yaw: number): number {
  const deg = (-yaw * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** Marks the bodies in view that are survivors or not, and the reader's tribe's or not. */
function markView(model: HudModel, hf: Heightfield, remote: RemoteSample, team: number, player: boolean, mine: boolean, kind: MarkerKind): void {
  for (let i = 0; i < remote.count; i++) {
    const f = remote.flags[i]!;
    if ((f & VIEW_FLAG_PROP) === 0 && ((f & VIEW_FLAG_PLAYER) !== 0) === player && (team !== 0 && remote.team[i] === team) === mine) model.mark(kind, hf, remote.x[i]!, remote.z[i]!);
  }
}

/** Marks the server's marks of one kind, but for the reader's own and those that are bodies in view. */
function markFar(model: HudModel, hf: Heightfield, marks: Marks, remote: RemoteSample, team: number, from: number, kind: MarkerKind): void {
  for (let i = 0; i < marks.count; i++) if (marks.kind[i] === from && i !== marks.self && !model.seenInView(marks, i, remote, team)) model.mark(kind, hf, marks.x[i]!, marks.z[i]!);
}

/** Fills the model's markers, the most important first. Friends in view come from the view, and those beyond it from the server's marks. */
function fillMarkers(model: HudModel, session: ClientSession, remote: RemoteSample): void {
  const hf = session.world!.hf;
  const team = session.tribe.team;
  const marks = session.tactical.marks;
  model.markers.length = 0;
  model.unmarked = 0;
  // A server rule can hide the reader's own position.
  if (session.mapLocation) model.mark("self", hf, session.own.x, session.own.z);
  markView(model, hf, remote, team, true, true, "mate");
  markFar(model, hf, marks, remote, team, MARK_MATE, "mate");
  markView(model, hf, remote, team, false, true, "tame");
  markFar(model, hf, marks, remote, team, MARK_TAME, "tame");
  for (const m of session.markers) model.mark("death", hf, m.x, m.z);
  // Beds and spawn points, while one is being chosen.
  if (session.sessionState === SESSION_DEAD) for (const p of session.respawnPoints) model.mark("spawn", hf, p.x, p.z);
  // Survivors of other tribes: those the server marks, and those in view if its rule lets them show.
  markFar(model, hf, marks, remote, team, MARK_OTHER, "player");
  if (marks.players !== PLAYERS_OFF) markView(model, hf, remote, team, true, false, "player");
  markView(model, hf, remote, team, false, false, "creature");
}

/** `scale` is screen pixels to a unit of the interface. */
export function updateHud(model: HudModel, session: ClientSession, remote: RemoteSample, fps: number, scale = 1): void {
  const world = session.world;
  if (!world) return;
  const b = session.own;
  model.frames++;
  model.scale = scale;
  model.x = b.x;
  model.y = b.y;
  model.z = b.z;
  model.lon = lonOf(world.hf, b.x);
  model.lat = latOf(world.hf, b.z);
  model.heading = headingOf(session.ownYaw);
  model.compass = COMPASS[Math.round(model.heading / 45) % 8]!;
  model.speed = Math.hypot(b.vx, b.vz);
  model.pingMs = Math.max(0, (session.stats.rttTicks * 1000) / TICK_RATE);
  model.fps = fps;
  model.corrections = session.stats.corrections;
  model.nearby = remote.count;
  fillMarkers(model, session, remote);
  const chart = model.chart;
  if (chart) {
    chart.tiles.step();
    chart.drawMini(session.tactical, session.tribe.team, model.lon / 100, model.lat / 100, Math.max(64, Math.min(512, Math.round(MINIMAP_SIZE * scale))), session.mapLocation);
    // The server sends structure cells at the size that suits the finest zoom on show. Its marks say which zoom it holds, so a
    // request that was lost or refused is made again.
    const want = Math.max(chart.mini.view.zoom, model.mapSeen === model.frames - 1 ? chart.fullZoom : 0);
    if (want !== session.tactical.marks.zoom && session.simTick - model.zoomAsked >= 45 && session.command(CMD_MAP_ZOOM, (w) => w.bits(want, 2)) !== 0) model.zoomAsked = session.simTick;
  }
  model.vitals[1]!.fraction = b.staminaMax > 0 ? b.stamina / (b.staminaMax * STAMINA_UNITS) : 0;
  if (session.hasVitals) {
    const v = session.vitals;
    const tick = session.serverTick;
    const fraction = (i: number): number => (v.max[i]! > 0 ? v.at(i, tick) / v.max[i]! : 1);
    model.vitals[0]!.fraction = fraction(V_HEALTH);
    model.vitals[2]!.fraction = fraction(V_FOOD);
    model.vitals[3]!.fraction = fraction(V_WATER);
    model.vitals[4]!.fraction = fraction(V_OXYGEN);
    model.vitals[5]!.fraction = v.max[V_TORPOR]! > 0 ? v.at(V_TORPOR, tick) / v.max[V_TORPOR]! : 0;
  }
  model.out = session.sessionState === SESSION_ALIVE && (b.mflags & MF_OUT) !== 0;
  model.clock = formatHour(hourOfDay(session.latestSnapshot, session.dayOffset, session.clock));
  model.banner = session.sessionState === SESSION_SPECTATING ? "SPECTATING" : session.sessionState === SESSION_DEAD ? (session.choosing === CHOOSE_DIED ? "DEAD" : "") : model.out ? "UNCONSCIOUS" : "";
  model.crosshair = model.banner === "" && session.crosshair;
  if (model.readoutDue(6)) model.formatReadout();
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
  const species = id.slice(id.indexOf(":") + 1);
  const named = remote.name[i] !== "";
  const team = session.tribe.team;
  m.owner = remote.team[i] === 0 ? OWNER_WILD : team !== 0 && remote.team[i] === team ? OWNER_TRIBE : OWNER_OTHER;
  m.title = named ? remote.name[i]! : species.charAt(0).toUpperCase() + species.slice(1);
  const vehicle = reg.vehicle[remote.kind[i]!];
  m.line = vehicle ? "Vehicle · driver and passenger seats" : `${named ? `${species}  ` : ""}level ${remote.level[i]}`;
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
export function fillOverhead(m: OverheadModel, session: ClientSession, remote: RemoteSample, cam: Camera, heads: Heads, eye: number, yaw: number, pitch: number): void {
  m.look = false;
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
    let best = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, OVER_RANGE) === HIT_NONE ? OVER_RANGE : rayHit.t;
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

/** A top-down RGBA picture of the whole terrain, north up, with relief shading: the one tile of the map's far zoom. */
export function minimapImage(hf: Heightfield, palette: Uint8Array, size: number): Uint8ClampedArray {
  const out = new Uint32Array(size * size);
  paintRelief(hf, palette, 0, 0, 0, size, out);
  return new Uint8ClampedArray(out.buffer);
}
