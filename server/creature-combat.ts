// Contacts follow the same animated sockets that players see. Each attack owns its victim and node sets until it ends.
import { poseCreatureOn } from "../shared/anim/creature.ts";
import { AnimState, bodySeed } from "../shared/anim/pose.ts";
import { boneToModel } from "../shared/anim/skeleton.ts";
import type { CreatureAttackDef, CreatureModeDef } from "../shared/content/defs.ts";
import { CHUNK_SIZE } from "../shared/coords.ts";
import { TAU, detCos, detSin } from "../shared/math/scalar.ts";
import { youngScale } from "../shared/sim/breeding.ts";
import { F_ALIVE, F_HELD, F_PROP } from "../shared/sim/entities.ts";
import { ACT_HOLD, ACT_RELOAD, ACT_SWING } from "../shared/sim/weapon.ts";
import { HIT_NODE, HIT_NONE, HIT_STRUCTURE, castWorld, rayBox, rayHit } from "../shared/world/ray.ts";
import { capsuleHull, hullPush, rayHull } from "../shared/world/convex.ts";
import { Found, type StructureStore } from "../shared/world/structures.ts";
import { frame, frameOf } from "../shared/world/frame.ts";
import type { Harvest } from "./harvest.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

type Point = readonly [number, number, number];
interface Swing {
  gen: number; pid: number; start: number; act: number; mode: number;
  x: number; y: number; z: number;
  hit: Set<number>; nodes: Set<number>; built: Set<number>;
}
export interface CreatureContactContext {
  world: ServerWorld;
  records: Records;
  harvest: Harvest | null;
  /** Tests the posed target, returning its contacted zone and distance along the sweep. */
  test(target: number, from: Point, to: Point, radius: number): { zone: number; distance: number } | null;
  structure?(actor: EntityRecord, ref: number, attack: CreatureAttackDef, mode: CreatureModeDef | undefined, point: Point, power: number): void;
  hit(actor: EntityRecord, target: number, attack: CreatureAttackDef, mode: CreatureModeDef | undefined, point: Point, zone: number, power: number): void;
}
export class CreatureContacts {
  private readonly swings = new Map<number, Swing>();
  private readonly seen = new Set<number>();
  private readonly state = new AnimState();
  private readonly point = new Float64Array(3);
  private readonly centre: [number, number, number] = [0, 0, 0];
  private readonly witness: [number, number, number] = [0, 0, 0];
  private readonly surface: [number, number, number] = [0, 0, 0];
  private readonly found = new Found();
  private readonly candidates: number[] = [];
  private readonly maxTargetReach: number;
  readonly ctx: CreatureContactContext;
  constructor(ctx: CreatureContactContext) {
    this.ctx = ctx;
    this.maxTargetReach = Math.max(4, ...ctx.world.anims.map(a => a?.rig.reach ?? 0), ...ctx.world.reg.bodyRadius);
  }

  /** Use the awake list, including mounts driven by clients, after their bodies and poses have stepped. */
  step(active: ArrayLike<number>, count: number): void {
    const { world, records } = this.ctx, ents = world.ents;
    const seen = this.seen;
    seen.clear();
    for (let at = 0; at < count; at++) {
      const e = active[at]!, kind = ents.kind[e]!, c = world.reg.combat[kind];
      if (!c || (ents.flags[e]! & (F_ALIVE | F_HELD)) !== F_ALIVE) continue;
      const act = ents.act[e]!, rec = records.byPid.get(ents.pid[e]!);
      const attack = act === ACT_SWING ? c.primary : act === ACT_RELOAD ? c.secondary : act === ACT_HOLD ? c.charge?.attack : undefined;
      if (!attack || !rec || rec.dead || rec.out) continue;
      const anim = world.anims[kind], socket = anim?.rig.sockets.get(attack.socket);
      // A missing authored socket never invents a hit from the eye or the origin.
      if (!anim || !socket) continue;
      seen.add(e);
      const ticks = ents.actTicks[e]!, start = world.tick - ticks;
      this.state.unpack(ents.anim[e]!, ents.cue[e]!); this.state.seed = bodySeed(e);
      const size = ents.grown[e] ? youngScale(world.reg.birthScale[kind]!, ents.span[e]!, ents.grown[e]!, world.tick) : 1;
      const yaw = ents.yaw[e]! / 65536 * TAU, s = detSin(yaw), cs = detCos(yaw);
      poseCreatureOn(anim, this.state, world.tick, world, ents.x[e]!, ents.y[e]!, ents.z[e]!, yaw, size);
      boneToModel(anim.rig.solved, socket.bone, socket.x, socket.y, socket.z, this.point);
      const x = ents.x[e]! + size * (cs * this.point[0]! + s * this.point[2]!);
      const y = ents.y[e]! + size * this.point[1]!;
      const z = ents.z[e]! + size * (cs * this.point[2]! - s * this.point[0]!);
      let swing = this.swings.get(e);
      if (!swing || swing.gen !== ents.gen[e] || swing.pid !== rec.pid || swing.start !== start || swing.act !== act) {
        swing = { gen: ents.gen[e]!, pid: rec.pid, start, act, mode: ents.creatureMode[e]!, x, y, z, hit: new Set(), nodes: new Set(), built: new Set() };
        this.swings.set(e, swing);
      }
      const from: Point = [swing.x, swing.y, swing.z], to: Point = [x, y, z];
      swing.x = x; swing.y = y; swing.z = z;
      if (act !== ACT_HOLD && (ticks < attack.lands || ticks > attack.through)) continue;
      // A teleport, a bad rig, or a discontinuity cannot sweep an attack across the world.
      if (Math.hypot(x - ents.x[e]!, y - ents.y[e]!, z - ents.z[e]!) > attack.reach * size + 0.05 || Math.hypot(x - from[0], y - from[1], z - from[2]) > attack.reach * size) continue;
      const radius = attack.radius * size, mode = c.modes?.[swing.mode];
      const origin: Point = [ents.x[e]!, ents.y[e]! + world.reg.bodyHeight[kind]! * .5 * size, ents.z[e]!];
      this.targets(e, from, to, radius);
      for (const victim of this.candidates) {
        const pid = ents.pid[victim]!;
        if (swing.hit.has(pid)) continue;
        const contact = this.ctx.test(victim, from, to, radius);
        if (!contact) continue;
        const distance = Math.hypot(x - from[0], y - from[1], z - from[2]);
        const t = distance > 1e-9 ? Math.min(1, contact.distance / distance) : 1;
        const point: Point = [from[0] + (x - from[0]) * t, from[1] + (y - from[1]) * t, from[2] + (z - from[2]) * t];
        if (!this.clear(origin, point) || !this.clear(from, point)) continue;
        // Check from the contact to the victim too, so a radius cannot reach through a thin wall.
        const targetSize = ents.grown[victim] ? youngScale(world.reg.birthScale[ents.kind[victim]!]!, ents.span[victim]!, ents.grown[victim]!, world.tick) : 1;
        const targetPoint: Point = [ents.x[victim]!, Math.max(ents.y[victim]!, Math.min(ents.y[victim]! + world.reg.bodyHeight[ents.kind[victim]!]! * targetSize, point[1])), ents.z[victim]!];
        if (!this.clear(point, targetPoint)) continue;
        swing.hit.add(pid);
        this.ctx.hit(rec, victim, attack, mode, point, contact.zone, act === ACT_HOLD ? .6 + .4 * ents.creaturePower[e]! / 255 : 1);
      }
      const power = act === ACT_HOLD ? .6 + .4 * ents.creaturePower[e]! / 255 : 1;
      if (this.ctx.structure) {
        const store = world.structs;
        const n = store.query(Math.min(from[0], x) - radius, Math.min(from[2], z) - radius, Math.max(from[0], x) + radius, Math.max(from[2], z) + radius, this.found, Math.min(from[1], y) - radius, Math.max(from[1], y) + radius);
        const refs = Array.from(this.found.refs.subarray(0, n)).sort((a, b) => a - b);
        for (const ref of refs) {
          if (swing.built.has(ref)) continue;
          const point = this.partContact(store, ref, from, to, radius, origin, HIT_STRUCTURE);
          if (!point) continue;
          swing.built.add(ref);
          this.ctx.structure(rec, ref, attack, mode, point, power);
        }
      }
      const profile = mode?.harvest ?? attack.harvest;
      const field = this.ctx.harvest?.field;
      if (!profile || !field || rec.team === 0) continue;
      const n = field.store.query(Math.min(from[0], x) - radius, Math.min(from[2], z) - radius, Math.max(from[0], x) + radius, Math.max(from[2], z) + radius, this.found, Math.min(from[1], y) - radius, Math.max(from[1], y) + radius);
      const refs = Array.from(this.found.refs.subarray(0, n)).sort((a, b) => a - b);
      for (const ref of refs) {
        if (swing.nodes.has(ref)) continue;
        const chunk = Math.floor(ref / 65536), slot = ref & 65535, table = field.store.chunks[chunk];
        if (!table || field.standing(chunk, slot) === 0) continue;
        if (!this.partContact(field.store, ref, from, to, radius, origin, HIT_NODE)) continue;
        swing.nodes.add(ref);
        this.ctx.harvest!.creature(rec, chunk, slot, profile);
      }
    }
    for (const e of this.swings.keys()) if (!seen.has(e)) this.swings.delete(e);
  }

  /** Earliest visible surface of an actual part, not the centre of its radius-expanded broad-phase shape. */
  private partContact(store: StructureStore, ref: number, from: Point, to: Point, radius: number, origin: Point, kind: number): Point | null {
    const table = store.chunks[Math.floor(ref / 65536)], slot = ref & 65535;
    if (!table || !table.kind[slot]) return null;
    const form = table.kind[slot]!, parts = store.parts;
    frameOf(table.yaw[slot]!);
    const sx = from[0] - table.x[slot]!, sy = from[1] - table.y[slot]!, sz = from[2] - table.z[slot]!;
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], length = Math.hypot(dx, dy, dz);
    const vx = length > 0 ? dx / length : 1, vy = length > 0 ? dy / length : 0, vz = length > 0 ? dz / length : 0;
    const scale = 1 / frame.stretch;
    const ox = (frame.cos * sx - frame.sin * sz) * scale, oz = (frame.sin * sx + frame.cos * sz) * scale;
    const ux = (frame.cos * vx - frame.sin * vz) * scale, uz = (frame.sin * vx + frame.cos * vz) * scale;
    let best = Infinity;
    for (let b = parts.start[form]! * 6; b < parts.start[form + 1]! * 6; b += 6) {
      const box = parts.box, rx = box[b + 3]! + radius * scale, ry = box[b + 4]! + radius, rz = box[b + 5]! + radius * scale;
      const broad = rayBox(ox, sy, oz, ux, vy, uz, box[b]! - rx, box[b + 1]! - ry, box[b + 2]! - rz, box[b]! + rx, box[b + 1]! + ry, box[b + 2]! + rz);
      if (broad > length || broad >= best) continue;
      const hit = this.touch(store, ref, b, -1, from, vx, vy, vz, radius, broad, Math.min(length, best));
      if (hit < best && this.visiblePart(origin, from, ref, kind)) best = hit;
    }
    const hulls = parts.hulls;
    if (hulls) for (let p = hulls.start[form]!; p < hulls.start[form + 1]!; p++) {
      const broad = rayHull(hulls, p, table.yaw[slot]!, sx, sy, sz, vx, vy, vz, radius);
      if (broad > length || broad >= best) continue;
      const hit = this.touch(store, ref, -1, p, from, vx, vy, vz, radius, broad, Math.min(length, best));
      if (hit < best && this.visiblePart(origin, from, ref, kind)) best = hit;
    }
    return best < Infinity ? this.surface : null;
  }

  private visiblePart(origin: Point, from: Point, ref: number, kind: number): boolean {
    if (!this.clear(origin, this.centre, ref, kind) || !this.clear(from, this.centre, ref, kind) || !this.clear(this.centre, this.witness, ref, kind)) return false;
    this.surface[0] = this.witness[0]; this.surface[1] = this.witness[1]; this.surface[2] = this.witness[2];
    return true;
  }

  /**
   * Conservative advancement against a convex part's supporting plane. Unlike an expanded box, its exact nearest
   * surface rejects corner-only overlaps. The support plane bounds every next step; no swept interval is skipped.
   */
  private touch(store: StructureStore, ref: number, box: number, hull: number, from: Point, vx: number, vy: number, vz: number, radius: number, start: number, end: number): number {
    let at = start;
    for (let n = 0; n < 32 && at <= end + 1e-7; n++) {
      this.centre[0] = from[0] + vx * at; this.centre[1] = from[1] + vy * at; this.centre[2] = from[2] + vz * at;
      const distance = this.closest(store, ref, box, hull);
      if (distance <= radius + 1e-7) return at;
      const closing = -((this.centre[0] - this.witness[0]) * vx + (this.centre[1] - this.witness[1]) * vy + (this.centre[2] - this.witness[2]) * vz) / distance;
      if (closing <= 1e-10) return Infinity;
      at += Math.max(1e-8, (distance - radius) / closing);
    }
    return Infinity;
  }

  /** Signed distance to the part and an actual nearest face/edge/corner point, in world coordinates. */
  private closest(store: StructureStore, ref: number, box: number, hull: number): number {
    const table = store.chunks[Math.floor(ref / 65536)]!, slot = ref & 65535;
    const sx = table.x[slot]!, sy = table.y[slot]!, sz = table.z[slot]!, yaw = table.yaw[slot]!;
    const dx = this.centre[0] - sx, dy = this.centre[1] - sy, dz = this.centre[2] - sz;
    if (hull >= 0) {
      // A zero-radius, zero-length capsule asks the existing convex distance solver for the nearest surface.
      capsuleHull(store.parts.hulls!, hull, yaw, dx, dz, dy, dy, 0, Infinity);
      this.witness[0] = this.centre[0] + hullPush.x; this.witness[1] = this.centre[1] + hullPush.y; this.witness[2] = this.centre[2] + hullPush.z;
      return -hullPush.depth;
    }
    frameOf(yaw);
    const c = frame.cos, s = frame.sin, wide = frame.stretch, b = store.parts.box;
    const x = c * dx - s * dz - b[box]! * wide, y = dy - b[box + 1]!, z = s * dx + c * dz - b[box + 2]! * wide;
    const hx = b[box + 3]! * wide, hy = b[box + 4]!, hz = b[box + 5]! * wide;
    let px = Math.max(-hx, Math.min(hx, x)), py = Math.max(-hy, Math.min(hy, y)), pz = Math.max(-hz, Math.min(hz, z));
    let distance = Math.hypot(x - px, y - py, z - pz);
    if (distance === 0) {
      // Inside the part: use its nearest exit face as the witness, retaining a negative distance.
      distance = hx - Math.abs(x); px = x < 0 ? -hx : hx;
      if (hy - Math.abs(y) < distance) { distance = hy - Math.abs(y); px = x; py = y < 0 ? -hy : hy; }
      if (hz - Math.abs(z) < distance) { distance = hz - Math.abs(z); px = x; py = y; pz = z < 0 ? -hz : hz; }
      distance = -distance;
    }
    px += b[box]! * wide; py += b[box + 1]!; pz += b[box + 2]! * wide;
    this.witness[0] = sx + c * px + s * pz; this.witness[1] = sy + py; this.witness[2] = sz + c * pz - s * px;
    return distance;
  }

  private clear(from: Point, to: Point, ref = -1, kind = HIT_NODE): boolean {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], length = Math.hypot(dx, dy, dz);
    if (length < .001) return true;
    const what = castWorld(this.ctx.world, from[0], from[1], from[2], dx / length, dy / length, dz / length, Math.max(0, length - .005));
    return what === HIT_NONE || (what === kind && rayHit.ref === ref);
  }
  private targets(e: number, a: Point, b: Point, radius: number): void {
    const { world } = this.ctx, ents = world.ents, dims = world.dims, pad = radius + this.maxTargetReach;
    const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - pad) / CHUNK_SIZE)), x1 = Math.min(dims.chunksX - 1, Math.floor((Math.max(a[0], b[0]) + pad) / CHUNK_SIZE));
    const z0 = Math.max(0, Math.floor((Math.min(a[2], b[2]) - pad) / CHUNK_SIZE)), z1 = Math.min(dims.chunksZ - 1, Math.floor((Math.max(a[2], b[2]) + pad) / CHUNK_SIZE));
    this.candidates.length = 0;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) for (let target = ents.chunkHead[z * dims.chunksX + x]!; target >= 0; target = ents.next[target]!) {
      if (target === e || (ents.flags[target]! & (F_ALIVE | F_HELD | F_PROP)) !== F_ALIVE) continue;
      if (ents.seat[target] === e + 1 && ents.seatGen[target] === ents.gen[e]) continue;
      this.candidates.push(target);
    }
    this.candidates.sort((a, b) => ents.pid[a]! - ents.pid[b]! || a - b);
  }
}
