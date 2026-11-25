// The smoke a guided missile leaves (server/vehicle-weapons.ts). A missile is a prop drawn from the snapshots, not a
// round this client flies, so its flame and smoke are laid here: the fire lays a round's smoke along one straight or
// falling path (render/blasts.ts), and a missile turns, so each time its way has turned past a few degrees its smoke
// starts a new leg from where it is, and the old one thins where it lies.

import type { Registry } from "../../shared/content/registry.ts";
import type { AppFrame, FramePart } from "./frame.ts";

/** What the trail asks of the fire: Blasts' fly, at and end. */
export interface TrailFire {
  fly(key: number, ox: number, oy: number, oz: number, vx: number, vy: number, vz: number, gravity: number, flame: number, bornMs: number): void;
  at(key: number, x: number, y: number, z: number, dx: number, dy: number, dz: number): void;
  end(key: number, nowMs: number): void;
}

/** What it reads of the bodies drawn: RemoteSample's columns. */
export interface TrailSample {
  readonly count: number;
  readonly id: ArrayLike<number>;
  readonly gen: ArrayLike<number>;
  readonly kind: ArrayLike<number>;
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  readonly z: ArrayLike<number>;
}

/** A leg starts once the way has turned this far from the last leg's, and has lasted this long. */
export const LEG_TURN = 2 * Math.PI / 180;
export const LEG_MS = 100;
/** Keys of this trail's smoke, apart from the rounds' (client/core/shots.ts). */
const KEYS = 2 ** 40;

interface Trail { key: number; seen: number; x: number; y: number; z: number; dx: number; dy: number; dz: number; legMs: number; leg: boolean }

export class MissileTrail implements FramePart {
  /** Legs begun, for tests. */
  legs = 0;
  /** By prop kind: its flame's length, its speed; 0 for a kind that is no missile. */
  private flame = new Float32Array(0);
  private speed = new Float32Array(0);
  private readonly trails = new Map<number, Trail>();
  private serial = 0;
  private frame = 0;
  private reg: Registry | null = null;

  /** Reads which props are missiles, from the vehicles that fire them. */
  retable(reg: Registry): void {
    this.reg = reg;
    this.flame = new Float32Array(reg.defs.length);
    this.speed = new Float32Array(reg.defs.length);
    for (const v of reg.vehicle) {
      const m = v?.weapons?.missiles;
      if (!m) continue;
      const prop = reg.index.get(m.prop), ammo = reg.index.get(m.ammo);
      if (prop === undefined || ammo === undefined) continue;
      this.flame[prop] = reg.ammoFlame[ammo] || 1;
      this.speed[prop] = m.speed;
    }
  }

  step(f: AppFrame): void {
    if (!f.scene) return;
    if (this.reg !== f.reg) this.retable(f.reg);
    this.trace(f.remote, f.scene.blasts, f.nowMs);
  }

  /** One frame: each missile drawn has its leg of smoke, and each gone has its last end. */
  trace(r: TrailSample, fire: TrailFire, nowMs: number): void {
    const frame = ++this.frame;
    if (this.flame.length === 0) return;
    for (let i = 0; i < r.count; i++) {
      const kind = r.kind[i]!, flame = this.flame[kind] ?? 0;
      if (flame === 0) continue;
      const id = r.id[i]! * 65536 + r.gen[i]!, x = r.x[i]!, y = r.y[i]!, z = r.z[i]!;
      let t = this.trails.get(id);
      if (!t) { t = { key: 0, seen: frame, x, y, z, dx: 0, dy: 0, dz: 0, legMs: nowMs, leg: false }; this.trails.set(id, t); }
      t.seen = frame;
      const mx = x - t.x, my = y - t.y, mz = z - t.z, moved = Math.hypot(mx, my, mz);
      t.x = x; t.y = y; t.z = z;
      if (moved < 1e-3) { if (t.leg) fire.at(t.key, x, y, z, t.dx, t.dy, t.dz); continue; }
      const dx = mx / moved, dy = my / moved, dz = mz / moved, speed = this.speed[kind]!;
      const turned = !t.leg || (dx * t.dx + dy * t.dy + dz * t.dz < Math.cos(LEG_TURN) && nowMs - t.legMs >= LEG_MS);
      if (turned) {
        if (t.leg) fire.end(t.key, nowMs);
        t.key = KEYS + ++this.serial; t.leg = true; t.legMs = nowMs; this.legs++;
        t.dx = dx; t.dy = dy; t.dz = dz;
        fire.fly(t.key, x, y, z, dx * speed, dy * speed, dz * speed, 0, flame, nowMs);
      }
      fire.at(t.key, x, y, z, dx, dy, dz);
    }
    for (const id of this.trails.keys()) {
      const t = this.trails.get(id)!;
      if (t.seen === frame) continue;
      if (t.leg) fire.end(t.key, nowMs);
      this.trails.delete(id);
    }
  }
}
