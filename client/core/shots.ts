// Pictures of shots: arrows and darts in the air, and tracer lines. They decide nothing. The server flies every shot
// (server/projectiles.ts), and the client draws its own with the same arithmetic (shared/sim/projectiles.ts).

import { Assets } from "./assets/assets.ts";
import type { Registry } from "../../shared/content/registry.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { EVENT_BLAST, EVENT_SHOT } from "../../shared/net/protocol.ts";
import { FLIGHT_TICKS, HITSCAN_RANGE, flyEnd, flyStep, launchSpeed, piece, type Flight } from "../../shared/sim/projectiles.ts";
import { TICK_DT } from "../../shared/coords.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { HIT_NONE, castWorld, lookDirection, rayBox, rayHit } from "../../shared/world/ray.ts";
import type { Camera } from "./render/camera.ts";
import type { Characters } from "./render/characters.ts";
import type { FramePacket } from "./render/packet.ts";
import type { ClientSession, RemoteSample } from "./session.ts";

export const TRACER_MS = 90;
export const BLAST_MS = 220;
const MAX_FLYING = 256;
const MAX_TRACERS = 32;
/** Its own shot is drawn from ahead of the eye and a little below, so it is seen to leave. Metres. */
const AHEAD = 0.7;
const BELOW = 0.1;
/** Longest tracer drawn, in metres. */
const TRACER_REACH = 300;

interface Flying extends Flight {
  gravity: number;
  mesh: number;
  /** Ticks left to fly. */
  left: number;
}

interface Tracer {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  length: number;
  until: number;
}

export class Shots {
  readonly flying: Flying[] = [];
  readonly tracers: Tracer[] = [];
  readonly blasts: { x: number; y: number; z: number; radius: number; born: number }[] = [];
  private readonly blastMesh: number;
  private now = 0;
  private readonly meshOfAmmo: Int32Array;
  private readonly tracerMesh: number;
  /** The owner replaces this when the server's tuning arrives. */
  reg: Registry;
  private readonly dir = [0, 0, 0];
  /** The whole tick the flights have been flown through. */
  private tick = -1;

  constructor(reg: Registry, pack: Pack) {
    this.reg = reg;
    const { table, bind } = new Assets(reg, pack);
    // Its own mesh and no stand-in: ammunition without one is drawn as a tracer.
    this.meshOfAmmo = Int32Array.from(reg.defs, (d) => (d?.type === "item" && d.ammo ? bind.own(d.id, "shot") : -1));
    this.tracerMesh = table.find("core:tracer");
    this.blastMesh = table.find("core:blast");
  }

  absorb(session: ClientSession, world: CollisionWorld, nowMs: number): void {
    const reg = this.reg;
    const d = this.dir;
    for (const s of session.fired) {
      lookDirection(s.yaw, s.pitch, d);
      const full = reg.ammoSpeed[s.ammo]!;
      if (full <= 0) {
        const reach = castWorld(world, s.x, s.y, s.z, d[0]!, d[1]!, d[2]!, HITSCAN_RANGE) === HIT_NONE ? HITSCAN_RANGE : rayHit.t;
        this.line(s.x + d[0]! * AHEAD, s.y - BELOW + d[1]! * AHEAD, s.z + d[2]! * AHEAD, s.x + d[0]! * reach, s.y + d[1]! * reach, s.z + d[2]! * reach, nowMs);
      } else {
        const speed = launchSpeed(full, s.draw);
        this.fly(s.x + d[0]! * AHEAD, s.y - BELOW + d[1]! * AHEAD, s.z + d[2]! * AHEAD, d[0]! * speed, d[1]! * speed, d[2]! * speed, s.ammo);
      }
    }
    session.fired.length = 0;
    // Shot and blast events are taken here. The rest stay for Feedback.absorb.
    const events = session.events;
    let kept = 0;
    for (const ev of events) {
      if (ev.kind === EVENT_BLAST) {
        if (this.blasts.length >= MAX_TRACERS) this.blasts.shift();
        this.blasts.push({ x: ev.x, y: ev.y, z: ev.z, radius: ev.far, born: nowMs });
        continue;
      }
      if (ev.kind !== EVENT_SHOT) {
        events[kept++] = ev;
        continue;
      }
      if (ev.flies) this.fly(ev.x, ev.y, ev.z, ev.vx, ev.vy, ev.vz, ev.item);
      else this.line(ev.x, ev.y, ev.z, ev.vx, ev.vy, ev.vz, nowMs);
    }
    events.length = kept;
  }

  private fly(x: number, y: number, z: number, vx: number, vy: number, vz: number, ammo: number): void {
    const mesh = this.meshOfAmmo[ammo] ?? -1;
    if (mesh < 0) return;
    if (this.flying.length >= MAX_FLYING) this.flying.shift();
    this.flying.push({ x, y, z, vx, vy, vz, gravity: this.reg.ammoGravity[ammo]!, mesh, left: FLIGHT_TICKS });
  }

  private line(x: number, y: number, z: number, ex: number, ey: number, ez: number, nowMs: number): void {
    const dx = ex - x;
    const dy = ey - y;
    const dz = ez - z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(length > 0.01)) return;
    if (this.tracers.length >= MAX_TRACERS) this.tracers.shift();
    this.tracers.push({ x, y, z, dx: dx / length, dy: dy / length, dz: dz / length, length: length > TRACER_REACH ? TRACER_REACH : length, until: nowMs + TRACER_MS });
  }

  /** Flies each shot up to the whole tick of `tick`. A flight ends at the ground, a wall, water, or a drawn body. */
  step(world: CollisionWorld, remote: RemoteSample | null, tick: number, nowMs: number): void {
    while (this.tracers.length > 0 && nowMs >= this.tracers[0]!.until) this.tracers.shift();
    while (this.blasts.length > 0 && nowMs >= this.blasts[0]!.born + BLAST_MS) this.blasts.shift();
    this.now = nowMs;
    const whole = Math.floor(tick);
    // After a clock jump, do not catch up tick by tick.
    if (this.tick < 0 || whole - this.tick > 8 || whole < this.tick) this.tick = whole - 1;
    const reg = this.reg;
    const sea = world.hf.seaLevel;
    for (; this.tick < whole; this.tick++) {
      let kept = 0;
      for (const f of this.flying) {
        flyStep(f, f.gravity);
        let length = piece.length;
        const { x, y, z, dx, dy, dz } = piece;
        let ends = --f.left <= 0 || !(length > 0);
        if (y > sea && y + dy * length <= sea) ends = true;
        if (!ends && castWorld(world, x, y, z, dx, dy, dz, length) !== HIT_NONE) ends = true;
        // The body test skips a flight's first two pieces, because a shot starts inside its shooter's box.
        for (let i = 0; remote && !ends && f.left < FLIGHT_TICKS - 2 && i < remote.count; i++) {
          const kind = remote.kind[i]!;
          const r = reg.bodyRadius[kind]!;
          if (reg.move[kind] === null || r <= 0) continue;
          if (rayBox(x, y, z, dx, dy, dz, remote.x[i]! - r, remote.y[i]!, remote.z[i]! - r, remote.x[i]! + r, remote.y[i]! + reg.bodyHeight[kind]!, remote.z[i]! + r) < length) ends = true;
        }
        if (ends) continue;
        flyEnd(f, f.gravity);
        this.flying[kept++] = f;
      }
      this.flying.length = kept;
    }
  }

  /** `tick` may be fractional. A flight is drawn that far along its next piece. */
  draw(ch: Characters, p: FramePacket, cam: Camera, tick: number): void {
    const ahead = (tick - Math.floor(tick)) * TICK_DT;
    for (const f of this.flying) {
      const x = f.x + f.vx * ahead - cam.x;
      const y = f.y + f.vy * ahead - cam.y;
      const z = f.z + f.vz * ahead - cam.z;
      const speed = Math.sqrt(f.vx * f.vx + f.vy * f.vy + f.vz * f.vz);
      if (!(speed > 0) || !cam.boxVisible(x - 1, y - 1, z - 1, x + 1, y + 1, z + 1)) continue;
      if (!ch.loose(p, f.mesh, x, y, z, f.vx / speed, f.vy / speed, f.vz / speed, 1)) return;
    }
    // A blast is a flash that swells from a quarter of its reach to most of it.
    for (const b of this.blasts) {
      const size = b.radius * (0.25 + 0.75 * Math.min(1, (this.now - b.born) / BLAST_MS)) * 0.9;
      if (this.blastMesh >= 0 && !ch.loose(p, this.blastMesh, b.x - cam.x, b.y - cam.y, b.z - cam.z, 0, 0, 1, size, size)) return;
    }
    if (this.tracerMesh < 0) return;
    for (const t of this.tracers) if (!ch.loose(p, this.tracerMesh, t.x - cam.x, t.y - cam.y, t.z - cam.z, t.dx, t.dy, t.dz, t.length)) return;
  }
}
