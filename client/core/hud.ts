// HUD view model as plain data. Places are in ARK's latitude and longitude (shared/world/coords.ts).

import { TICK_RATE } from "../../shared/coords.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { HOTBAR_SLOTS, type Inventory } from "../../shared/sim/items.ts";
import { CMD_MAP_ZOOM, SESSION_ALIVE, SESSION_DEAD, SESSION_SPECTATING } from "../../shared/net/protocol.ts";
import { MF_OUT, STAMINA_UNITS } from "../../shared/sim/character.ts";
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
      continue;
    }
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

export class HudModel {
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
    this.readout[2] = `${this.fps.toFixed(0)} fps  ${this.pingMs.toFixed(0)} ms  ${this.corrections} corrections  ${this.nearby} nearby`;
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
  model.banner = session.sessionState === SESSION_SPECTATING ? "SPECTATING" : session.sessionState === SESSION_DEAD ? "DEAD" : model.out ? "UNCONSCIOUS" : "";
  model.crosshair = model.banner === "" && session.crosshair;
  if (model.readoutDue(6)) model.formatReadout();
}

/** A top-down RGBA picture of the whole terrain, north up, with relief shading: the one tile of the map's far zoom. */
export function minimapImage(hf: Heightfield, palette: Uint8Array, size: number): Uint8ClampedArray {
  const out = new Uint32Array(size * size);
  paintRelief(hf, palette, 0, 0, 0, size, out);
  return new Uint8ClampedArray(out.buffer);
}
