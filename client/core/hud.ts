// HUD view model: what the interface shows, as plain data.
//
// The shell binds these fields to DOM nodes and draws nothing it was not told
// to. Coordinates, compass, minimap projection and marker placement are decided
// here, where they can be tested.
//
// Map coordinates follow the survival-game convention: latitude and longitude
// run 0..100, (50, 50) is the map centre, latitude grows southward and
// longitude grows eastward. North is +Z; east is -X (the world is right-handed
// with +Y up, so facing north puts +X on your left).

import { TICK_RATE } from "../../shared/coords.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { HOTBAR_SLOTS, type Inventory } from "../../shared/sim/items.ts";
import { SESSION_ALIVE, SESSION_DEAD, SESSION_SPECTATING } from "../../shared/net/protocol.ts";
import { MF_OUT, STAMINA_UNITS } from "../../shared/sim/character.ts";
import { ACT_DRAW, ACT_HOLD, ACT_RELOAD } from "../../shared/sim/weapon.ts";
import { formatHour, hourOfDay } from "../../shared/sim/clock.ts";
import { V_FOOD, V_HEALTH, V_OXYGEN, V_TORPOR, V_WATER } from "../../shared/sim/vitals.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { CombatModel } from "./feedback.ts";
import type { ClientSession, RemoteSample } from "./session.ts";

export type MarkerKind = "self" | "player" | "creature" | "spawn" | "death";

export interface Marker {
  kind: MarkerKind;
  /** Position on the minimap, 0..1, origin top-left, north up. */
  u: number;
  v: number;
}

export interface Vital {
  id: string;
  label: string;
  /** 0..1. */
  fraction: number;
}

/** One hotbar slot as the HUD shows it: a few letters of the item's name, its colour, and a number (a count, or rounds loaded). */
export interface HotbarCell {
  label: string;
  /** 0xRRGGBB, or -1 for an empty slot. */
  tint: number;
  number: string;
}

/** Fill the HUD's hotbar from what the survivor carries. */
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

/** Fill what the HUD shows of what is acting on the body, from what the server last said. */
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

/** What `HudModel.actionKind` says the bar under the crosshair is showing. */
export const ACTION_NONE = 0;
export const ACTION_DRAW = 1;
export const ACTION_RELOAD = 2;

/** Fill what the HUD shows of the weapon in hand: how far a bow is drawn or a reload has got, and the rounds in it and in the bag. */
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
  /** Stamina comes from the predicted body; the others from vitals evaluated at the server's tick. */
  readonly vitals: Vital[] = [
    { id: "health", label: "Health", fraction: 1 },
    { id: "stamina", label: "Stamina", fraction: 1 },
    { id: "food", label: "Food", fraction: 1 },
    { id: "water", label: "Water", fraction: 1 },
    { id: "oxygen", label: "Oxygen", fraction: 1 },
    { id: "torpor", label: "Torpor", fraction: 0 },
  ];
  /** What is acting on the body: a name, its colour (0xRRGGBB), and the seconds it has left (-1 for no end). */
  readonly buffs: { label: string; tint: number; seconds: number }[] = [];
  /** The body is unconscious: the screen is dark and nothing can be done. */
  out = false;
  readonly markers: Marker[] = [];
  /** Lines of text at the top left. Rewritten a few times a second, not every frame. */
  readonly readout: string[] = ["", "", ""];
  /** Time of day, "06:30". */
  clock = "";
  /** A line at the bottom left: connection state, or nothing. */
  status = "";
  /** A word across the top while the session has no body: "SPECTATING", "DEAD". */
  banner = "";
  crosshair = true;
  /** What the use button would do to the thing looked at, or nothing. */
  prompt = "";
  /** The ten hotbar slots, or none for a body that has no hotbar. `held` is the one in hand, or -1. */
  readonly hotbar: HotbarCell[] = [];
  held = -1;
  /** The bar under the crosshair: ACTION_DRAW or ACTION_RELOAD and how far along, 0 to 1; or ACTION_NONE. */
  actionKind = ACTION_NONE;
  actionFraction = 0;
  /** The weapon in hand: what it is loaded with, the rounds in it, and those carried. Empty for anything that takes none. */
  ammo = "";
  /** Hits landed and harm taken, as they are shown this frame. */
  readonly combat = new CombatModel();
  private readoutAge = 0;

  /** Rewrite the readout from the numbers above. */
  formatReadout(): void {
    this.readout[0] = `${this.lat.toFixed(1)} lat  ${this.lon.toFixed(1)} lon  ${this.compass} ${this.heading.toFixed(0)}`;
    this.readout[1] = `x ${this.x.toFixed(1)}  y ${this.y.toFixed(1)}  z ${this.z.toFixed(1)}  ${this.speed.toFixed(1)} m/s`;
    this.readout[2] = `${this.fps.toFixed(0)} fps  ${this.pingMs.toFixed(0)} ms  ${this.corrections} corrections  ${this.nearby} nearby`;
  }

  /** True once every `every` calls: the readout need not change faster than it can be read. */
  readoutDue(every: number): boolean {
    if (this.readoutAge++ % every !== 0) return false;
    return true;
  }
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** Bit in replicated entity flags marking a player-controlled body. */
const VIEW_FLAG_PLAYER = 4;

export function mapU(hf: Heightfield, x: number): number {
  return 1 - x / hf.sizeX;
}

export function mapV(hf: Heightfield, z: number): number {
  return 1 - z / hf.sizeZ;
}

export function headingOf(yaw: number): number {
  const deg = (-yaw * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

export function updateHud(model: HudModel, session: ClientSession, remote: RemoteSample, fps: number): void {
  const world = session.world;
  if (!world) return;
  const b = session.own;
  model.x = b.x;
  model.y = b.y;
  model.z = b.z;
  model.lon = mapU(world.hf, b.x) * 100;
  model.lat = mapV(world.hf, b.z) * 100;
  model.heading = headingOf(session.ownYaw);
  model.compass = COMPASS[Math.round(model.heading / 45) % 8]!;
  model.speed = Math.hypot(b.vx, b.vz);
  model.pingMs = Math.max(0, (session.stats.rttTicks * 1000) / TICK_RATE);
  model.fps = fps;
  model.corrections = session.stats.corrections;
  model.nearby = remote.count;
  model.markers.length = 0;
  for (let i = 0; i < remote.count; i++) {
    model.markers.push({ kind: (remote.flags[i]! & VIEW_FLAG_PLAYER) !== 0 ? "player" : "creature", u: mapU(world.hf, remote.x[i]!), v: mapV(world.hf, remote.z[i]!) });
  }
  for (const m of session.markers) model.markers.push({ kind: "death", u: mapU(world.hf, m.x), v: mapV(world.hf, m.z) });
  model.markers.push({ kind: "self", u: mapU(world.hf, b.x), v: mapV(world.hf, b.z) });
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
  model.clock = formatHour(hourOfDay(session.latestSnapshot, session.dayOffset));
  model.banner = session.sessionState === SESSION_SPECTATING ? "SPECTATING" : session.sessionState === SESSION_DEAD ? "DEAD" : model.out ? "UNCONSCIOUS" : "";
  model.crosshair = model.banner === "";
  if (model.readoutDue(6)) model.formatReadout();
}

/** A top-down picture of the terrain, north up, for the minimap: palette tint with simple relief shading. */
export function minimapImage(hf: Heightfield, palette: Uint8Array, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (1 - (px + 0.5) / size) * hf.sizeX;
      const z = (1 - (py + 0.5) / size) * hf.sizeZ;
      const i = Math.min(hf.nx - 2, Math.floor(x / hf.cell));
      const j = Math.min(hf.nz - 2, Math.floor(z / hf.cell));
      const tint = hf.tint[j * hf.nx + i]!;
      // Light from the north-west: slopes facing it are brighter.
      const relief = (hf.sample(i + 1, j) - hf.sample(i, j) + hf.sample(i, j + 1) - hf.sample(i, j)) / hf.cell;
      const shade = Math.max(0.55, Math.min(1.3, 0.9 + relief * 0.35));
      const o = (py * size + px) * 4;
      out[o] = palette[tint * 4]! * shade;
      out[o + 1] = palette[tint * 4 + 1]! * shade;
      out[o + 2] = palette[tint * 4 + 2]! * shade;
      out[o + 3] = 255;
    }
  }
  return out;
}
