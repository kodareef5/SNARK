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
import { SESSION_DEAD, SESSION_SPECTATING } from "../../shared/net/protocol.ts";
import { STAMINA_UNITS } from "../../shared/sim/character.ts";
import { formatHour, hourOfDay } from "../../shared/sim/clock.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
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
  /** Stamina comes from the predicted body. The rest are placeholders until vitals replicate. */
  readonly vitals: Vital[] = [
    { id: "health", label: "Health", fraction: 1 },
    { id: "stamina", label: "Stamina", fraction: 1 },
    { id: "food", label: "Food", fraction: 1 },
    { id: "water", label: "Water", fraction: 1 },
  ];
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
  model.markers.push({ kind: "self", u: mapU(world.hf, b.x), v: mapV(world.hf, b.z) });
  model.vitals[1]!.fraction = b.staminaMax > 0 ? b.stamina / (b.staminaMax * STAMINA_UNITS) : 0;
  model.clock = formatHour(hourOfDay(session.latestSnapshot, session.dayOffset));
  model.banner = session.sessionState === SESSION_SPECTATING ? "SPECTATING" : session.sessionState === SESSION_DEAD ? "DEAD" : "";
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
