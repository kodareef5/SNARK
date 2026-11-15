// Small details: feathers knocked loose, dust thrown up, a splash. A species answers what its body does (occasions.ts)
// as its cue sheet says (shared/pack/details.ts), each answer a burst of particles from a place on its body, seeded by
// the body, the occasion and its tick, so every client that saw the occasion makes the same ones. They are pictures:
// nothing here is read by the simulation. planning/reference/round9-details-design.md is the design.

import { creaturePose, type CreatureAnim } from "../../../shared/anim/creature.ts";
import { bodyDown, bodyUp } from "../../../shared/anim/moments.ts";
import { AnimState, bodySeed } from "../../../shared/anim/pose.ts";
import { boneToModel, solve, type Solved } from "../../../shared/anim/skeleton.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { TICK_RATE } from "../../../shared/coords.ts";
import { hashString } from "../../../shared/hash.ts";
import { OCCASIONS, type DetailEffect, type DetailEntry, type DetailPicture, type Occasion, type PackDetails } from "../../../shared/pack/details.ts";
import { Rng } from "../../../shared/rng.ts";
import { youngScale } from "../../../shared/sim/breeding.ts";
import { sortU32 } from "../../../shared/sort.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { Tier } from "../assets/tiers.ts";
import { Occasions, type Happening, type ShotEnd, type Viewer } from "../occasions.ts";
import type { Corpse } from "../ragdoll.ts";
import { LOW } from "../render/atmosphere.ts";
import type { Camera } from "../render/camera.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_LIT, DETAIL_PUFF, MAX_DETAILS, type FramePacket } from "../render/packet.ts";
import type { RemoteSample } from "../session.ts";
import { dustColour, groundAt } from "./ground.ts";
import { Pool } from "./pool.ts";

/** A burst keeps its whole count within this many metres of the eye, and this many over the distance beyond. */
const NEAR = 10;
/** The ground wind is the low clouds' turned down to this share, and it gusts by this share of itself. */
const WIND_SHARE = 0.1;
const GUST = 0.4;
/** Seconds a frame is stepped at most, so a stall does not throw particles through the ground. */
const LONGEST_STEP = 0.1;
/** The most bursts waiting for their moment. */
const MOST_WAITING = 256;
/** A see-through particle within this many metres of the eye fades out, so one through the camera does not fill the screen. */
const EYE_FADE = 1;

interface Answer {
  entry: DetailEntry;
  effect: DetailEffect;
  /** Seconds into the occasion at which it is made. */
  delay: number;
}

/** What a species answers, by occasion. */
interface Book {
  anim: CreatureAnim;
  answers: Partial<Record<Occasion, Answer[]>>;
  /** Its dyes where a body has none of its own, and its height and radius. */
  colour: number;
  height: number;
  radius: number;
}

interface Waiting {
  h: Happening;
  answer: Answer;
  /** The tick it is made at, and its place among the answers, for its seed. */
  due: number;
  index: number;
}

export class Details {
  readonly pool: Pool;
  readonly occasions: Occasions;
  /** Particles left out this frame because the packet was full, and bursts thinned for the screen's fill. */
  dropped = 0;
  thinned = 0;
  /** The blended fill of the last frame written, in screens. */
  fill = 0;
  private readonly effects: readonly DetailEffect[];
  private readonly pictures: readonly DetailPicture[];
  private readonly books: (Book | null)[];
  private readonly waiting: Waiting[] = [];
  private readonly palette: Uint8Array;
  private readonly st = new AnimState();
  private last = Number.NaN;
  private readonly at = [0, 0, 0];
  private readonly colour = [0, 0, 0];
  private readonly order = new Uint32Array(MAX_DETAILS);
  private readonly index = new Map<number, number>();
  private readonly birth: Float32Array;

  /** `animOf` gives what a species of a kind plays, or null for one not drawn on a rig of its own. */
  constructor(reg: Registry, details: PackDetails | undefined, palette: Uint8Array, animOf: (kind: number) => CreatureAnim | null) {
    this.palette = palette;
    this.birth = reg.birthScale;
    this.effects = details?.effects ?? [];
    this.pictures = details?.pictures ?? [];
    this.pool = new Pool(MAX_DETAILS);
    const listens = new Uint16Array(reg.defs.length);
    this.books = reg.defs.map((d, kind) => {
      const sheet = d?.type === "species" ? details?.sheets.find((s) => s.owner === d.id) : undefined;
      const anim = sheet ? animOf(kind) : null;
      if (!sheet || !anim) return null;
      const moments: Partial<Record<Occasion, number>> = { down: bodyDown(anim.rig, anim.torporIn ?? anim.death), death: bodyDown(anim.rig, anim.death), up: bodyUp(anim.rig, anim.torporOut) };
      const answers: Book["answers"] = {};
      for (const [o, cue] of Object.entries(sheet.cues) as [Occasion, NonNullable<(typeof sheet.cues)[Occasion]>][]) {
        answers[o] = cue.effects.map((entry) => ({ entry, effect: this.effects[entry.effect]!, delay: entry.at === "down" ? (moments[o] ?? 0) : entry.at === "now" ? 0 : entry.at }));
        listens[kind]! |= 1 << OCCASIONS.indexOf(o);
      }
      return { anim, answers, colour: d!.type === "species" ? d!.color : 0, height: reg.bodyHeight[kind]!, radius: reg.bodyRadius[kind]! };
    });
    this.occasions = new Occasions(
      this.books.map((b) => b?.anim ?? null),
      listens,
      (o) => 1 << OCCASIONS.indexOf(o),
    );
  }

  /**
   * Reads what bodies did, makes the bursts whose moment has come, moves every particle on to the tick of `remote`, and
   * writes those in view into `p`. Returns the first particle of the blended ones; those before it are cut out.
   */
  frame(p: FramePacket, cam: Camera, remote: RemoteSample | null, corpses: readonly Corpse[], shots: readonly ShotEnd[], viewer: Viewer | null, hf: Heightfield, tier: Tier, nowMs: number): number {
    const tick = remote ? remote.tick : nowMs * (TICK_RATE / 1000);
    const dt = this.last === this.last ? Math.min(LONGEST_STEP, Math.max(0, (tick - this.last) / TICK_RATE)) : 0;
    this.last = tick;
    if (this.effects.length === 0) return 0;
    const ex = cam.x;
    const ey = cam.y;
    const ez = cam.z;
    if (remote) {
      this.occasions.update(remote, corpses, shots, viewer, ex, ey, ez, nowMs);
      for (const h of this.occasions.happened) {
        const book = this.books[h.kind];
        book?.answers[h.occasion]?.forEach((answer, k) => {
          if (this.waiting.length < MOST_WAITING) this.waiting.push({ h, answer, due: h.tick + answer.delay * TICK_RATE, index: k });
        });
      }
      this.index.clear();
      for (let i = 0; i < remote.count; i++) this.index.set(remote.id[i]!, i);
    }
    const seconds = tick / TICK_RATE;
    const gust = 1 + GUST * Math.sin(seconds * 0.7) * Math.sin(seconds * 0.23 + 1);
    const wx = LOW.wind[0] * WIND_SHARE * gust;
    const wz = LOW.wind[1] * WIND_SHARE * gust;
    const full = this.pool.count / Math.max(1, tier.details.pool);
    this.pool.step(dt, this.effects, hf, wx, wz, Math.max(0, 1 - full * full));
    let fill = this.fill;
    let kept = 0;
    for (const w of this.waiting) {
      if (w.due > tick) {
        this.waiting[kept++] = w;
        continue;
      }
      fill += this.burst(w, remote, hf, tier, cam, tick, fill);
    }
    this.waiting.length = kept;
    return this.write(p, cam, hf);
  }

  /** Makes one burst. Returns the share of the screen it is expected to cover, if it is see-through. */
  private burst(w: Waiting, remote: RemoteSample | null, hf: Heightfield, tier: Tier, cam: Camera, tick: number, fill: number): number {
    const { h, answer } = w;
    const e = answer.effect;
    const book = this.books[h.kind]!;
    const rng = new Rng(hashString(`${h.occasion}:${Math.floor(h.tick)}:${w.index}`, h.id * 2654435761));
    const at = this.at;
    let size = h.size;
    // Where the body is as it is drawn now, posed at the moment.
    let x = h.x;
    let y = h.y;
    let z = h.z;
    let yaw = h.yaw;
    let solved: Solved | null = null;
    const rig = book.anim.rig;
    if (h.corpse) solved = h.corpse.solved;
    else {
      const i = remote ? this.index.get(h.id) : undefined;
      const st = this.st;
      if (i !== undefined) {
        const r = remote!;
        [x, y, z, yaw] = [r.x[i]!, r.y[i]!, r.z[i]!, r.yaw[i]!];
        st.unpack(r.anim[i]!, r.cue[i]!);
        if (r.grown[i] !== 0) size = youngScale(this.birth[h.kind]!, r.span[i]!, r.grown[i]!, r.tick);
      } else st.unpack(h.anim, h.cue);
      st.seed = bodySeed(h.id);
      creaturePose(book.anim, st, w.due, rig.a);
      solve(rig, rig.a, rig.solved);
      solved = rig.solved;
    }
    const [s, c] = [Math.sin(yaw), Math.cos(yaw)];
    const world = (mx: number, my: number, mz: number): void => {
      at[0] = x + (c * mx + s * mz) * size;
      at[1] = y + my * size;
      at[2] = z + (c * mz - s * mx) * size;
    };
    const from = answer.entry.from;
    let [ox, oy, oz] = [0, 0, 0];
    if (from === "body" || from === "ground") world(solved.pos[0]!, solved.pos[1]!, solved.pos[2]!);
    else if (from === "hit") {
      world(solved.pos[0]!, book.height * 0.55, solved.pos[2]!);
      const [cx, cz] = [at[0]!, at[2]!];
      if (h.fromX === h.fromX) {
        // The side of the body that faces whoever struck it, and away from them.
        const [dx, dz] = [h.fromX - cx, h.fromZ - cz];
        const l = Math.hypot(dx, dz) || 1;
        const r = book.radius * size;
        at[0] = cx + (dx / l) * r;
        at[1] = Math.min(y + book.height * size, Math.max(y + 0.1, h.fromY - 0.6));
        at[2] = cz + (dz / l) * r;
        [ox, oy, oz] = [-dx / l, 0, -dz / l];
      } else {
        const a = rng.float() * Math.PI * 2;
        [ox, oz] = [Math.cos(a), Math.sin(a)];
        at[0] = cx + ox * book.radius * size;
        at[2] = cz + oz * book.radius * size;
      }
    } else if (from === "foot") {
      if (h.foot < 0) return 0;
      world(solved.pos[h.foot * 3]!, 0, solved.pos[h.foot * 3 + 2]!);
    } else {
      const socket = rig.sockets.get(from);
      if (!socket) return 0;
      boneToModel(solved, socket.bone, socket.x, socket.y, socket.z, at);
      world(at[0]!, at[1]!, at[2]!);
    }
    if (from === "ground" || from === "foot") at[1] = y;
    const [px, py, pz] = [at[0]!, at[1]!, at[2]!];
    const d = Math.hypot(px - cam.x, py - cam.y, pz - cam.z);
    if (d > e.reach * tier.details.reach) return 0;
    // What the ground is, for the dust's colour and whether there is any.
    const kind = groundAt(hf, px, y, pz);
    if (answer.entry.on && !answer.entry.on.includes(kind)) return 0;
    const colour = this.colour;
    if (e.colour === "ground" && !dustColour(hf, this.palette, kind, px, pz, colour)) return 0;
    const [least, most] = answer.entry.count ?? e.count;
    let n = least + Math.floor(rng.float() * (most - least + 1));
    n = n * tier.details.share * Math.min(1, NEAR / Math.max(d, 0.01));
    n = n > 0 ? Math.max(1, Math.round(n)) : 0;
    let share = 0;
    if (e.pass === "blend") {
      // How much of the screen the burst covers at its largest, at its distance.
      const big = e.size[1] * e.grow * size;
      const t = Math.tan(cam.fovY / 2);
      share = (big * big * e.aspect) / (Math.max(d, 1) ** 2 * 4 * t * t * cam.aspect);
      const room = tier.details.fill - fill;
      if (n * share > room) {
        const fits = Math.max(Math.min(3, n), Math.floor(Math.max(0, room) / share));
        this.thinned += n - fits;
        n = fits;
      }
    }
    // A body on a floor above the ground lands its particles on that floor; one on the ground or in the air on the ground.
    const onFloor = h.grounded && y > hf.heightAt(x, z) + 0.25 ? y : Number.NaN;
    const pool = this.pool;
    const age = Math.max(0, (tick - w.due) / TICK_RATE);
    for (let k = 0; k < n; k++) {
      const i = pool.take();
      if (i < 0) break;
      // Where it starts and which way it goes: out from the place, and up by the effect's share.
      let [sx, sy, sz] = [0, 0, 0];
      let [dx, dy, dz] = [ox, oy, oz];
      const turn = ((k + rng.float() * 0.6) / n) * Math.PI * 2;
      if (e.shape === "ring" || e.shape === "disc") {
        const r = e.radius * size * (e.shape === "disc" ? Math.sqrt(rng.float()) : 0.85 + rng.float() * 0.3);
        [dx, dy, dz] = [Math.cos(turn), 0, Math.sin(turn)];
        [sx, sz] = [dx * r, dz * r];
      } else {
        const u = rng.float() * 2 - 1;
        const a = rng.float() * Math.PI * 2;
        const ring = Math.sqrt(1 - u * u);
        const [rx, ry, rz] = [ring * Math.cos(a), u, ring * Math.sin(a)];
        if (e.shape === "sphere") {
          const r = e.radius * size * Math.cbrt(rng.float());
          [sx, sy, sz] = [rx * r, ry * r, rz * r];
        }
        if (from === "hit") [dx, dy, dz] = [dx + rx * 0.6, dy + Math.abs(ry) * 0.3, dz + rz * 0.6];
        else [dx, dy, dz] = [rx, Math.abs(ry), rz];
      }
      const up = e.up;
      const hl = Math.hypot(dx, dz);
      const [hx, hz] = hl > 0 ? [dx / hl, dz / hl] : [0, 0];
      const speed = e.speed[0] + rng.float() * (e.speed[1] - e.speed[0]);
      [pool.x[i], pool.y[i], pool.z[i]] = [px + sx, py + sy, pz + sz];
      pool.vx[i] = hx * (1 - up) * speed;
      pool.vy[i] = up * speed;
      pool.vz[i] = hz * (1 - up) * speed;
      pool.age[i] = age;
      pool.end[i] = e.life[0] + rng.float() * (e.life[1] - e.life[0]);
      pool.landed[i] = -1;
      pool.plane[i] = onFloor;
      pool.size[i] = (e.size[0] + rng.float() * (e.size[1] - e.size[0])) * size;
      pool.heading[i] = rng.float() * Math.PI * 2;
      pool.pitch[i] = (rng.float() - 0.5) * 0.8;
      pool.phase[i] = rng.float() * Math.PI * 2;
      pool.swayTo[i] = rng.float() * Math.PI * 2;
      pool.effect[i] = answer.entry.effect;
      const picture = this.pictures[e.pictures[Math.floor(rng.float() * e.pictures.length)]!]!;
      pool.cell[i] = picture.cell;
      pool.flags[i] = picture.flat | (e.lit ? DETAIL_LIT : 0) | (e.face === "camera" ? DETAIL_PUFF : 0);
      pool.grey[i] = Math.max(1, Math.min(255, Math.round(picture.grey * 255)));
      const shade = 1 + e.vary * (rng.float() * 2 - 1);
      pool.colourA[i] = this.paint(e, picture.regions[0]!, h, book, colour, shade);
      pool.colourB[i] = this.paint(e, picture.regions[1]!, h, book, colour, shade);
    }
    return e.pass === "blend" ? n * share : 0;
  }

  /** The colour word of a particle's region `region` of the body, the ground's `ground`, or the effect's own, shaded. */
  private paint(e: DetailEffect, region: number, h: Happening, book: Book, ground: readonly number[], shade: number): number {
    let r: number;
    let g: number;
    let b: number;
    if (e.colour === "ground") [r, g, b] = [ground[0]!, ground[1]!, ground[2]!];
    else if (Array.isArray(e.colour)) [r, g, b] = e.colour;
    else {
      const dye = (region >= 0 && h.colours[region]) || book.colour;
      [r, g, b] = [this.palette[dye * 4]!, this.palette[dye * 4 + 1]!, this.palette[dye * 4 + 2]!];
    }
    const k = (v: number): number => Math.max(0, Math.min(255, Math.round(v * shade)));
    return (k(r) | (k(g) << 8) | (k(b) << 16) | (255 << 24)) >>> 0;
  }

  /** Writes the particles in view into `p`, the cut-out ones and then the see-through ones far to near. */
  private write(p: FramePacket, cam: Camera, hf: Heightfield): number {
    const pool = this.pool;
    const out = p.details;
    const words = p.detailWords;
    const order = this.order;
    const [cx, cy, cz] = [cam.x, cam.y, cam.z];
    // The camera's right and up, which a puff faces.
    const [sy, cyw, sp, cp] = [Math.sin(cam.yaw), Math.cos(cam.yaw), Math.sin(cam.pitch), Math.cos(cam.pitch)];
    const [rx, rz] = [-cyw, sy];
    const [ux, uy, uz] = [-sy * sp, cp, -cyw * sp];
    const t = Math.tan(cam.fovY / 2);
    let cut = 0;
    let blended = 0;
    let fill = 0;
    // Cut-out ones go first; see-through ones are kept aside to be sorted.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < pool.count; i++) {
        const e = this.effects[pool.effect[i]!]!;
        if ((e.pass === "blend") !== (pass === 1)) continue;
        const half = pool.size[i]! * (e.grow === 1 ? 1 : 1 + (e.grow - 1) * ease(pool.age[i]! / pool.end[i]!)) * 0.5;
        const x = pool.x[i]! - cx;
        const y = pool.y[i]! - cy;
        const z = pool.z[i]! - cz;
        if (!cam.boxVisible(x - half, y - half, z - half, x + half, y + half, z + half)) continue;
        const d = Math.hypot(x, y, z);
        let shows = pool.shows(i, e);
        if (pass === 1) {
          shows *= Math.min(1, Math.max(0, (d - 0.3) / EYE_FADE));
          if (shows <= 0) continue;
          const area = (4 * half * half * e.aspect) / (Math.max(d, 0.5) ** 2 * 4 * t * t * cam.aspect);
          fill += area * shows;
        }
        const n = cut + blended;
        if (n >= MAX_DETAILS) {
          this.dropped++;
          continue;
        }
        const o = n * DETAIL_FLOATS;
        out[o + DETAIL.middle] = x;
        out[o + DETAIL.middle + 1] = y;
        out[o + DETAIL.middle + 2] = z;
        const width = half * e.aspect;
        const lying = pool.landed[i]! >= 0;
        if (e.face === "camera") {
          const a = pool.heading[i]! + e.turn * pool.age[i]!;
          const [ca, sa] = [Math.cos(a), Math.sin(a)];
          out.set([(ux * ca - rx * sa) * half, uy * ca * half, (uz * ca - rz * sa) * half, (rx * ca + ux * sa) * width, uy * sa * width, (rz * ca + uz * sa) * width], o + DETAIL.along);
        } else if (lying || e.face === "flat") {
          const l = i * 6;
          if (!lying) {
            const h = pool.heading[i]! + e.turn * pool.age[i]!;
            out.set([Math.cos(h) * half, 0, Math.sin(h) * half, -Math.sin(h) * width, 0, Math.cos(h) * width], o + DETAIL.along);
          } else for (let k = 0; k < 3; k++) [out[o + DETAIL.along + k], out[o + DETAIL.across + k]] = [pool.lying[l + k]! * half, pool.lying[l + 3 + k]! * width];
        } else {
          // Falling, a feather lies across its fall and rocks; bursting out, it tumbles.
          const age = pool.age[i]!;
          const swing = Math.sin(2 * Math.PI * e.swayHz * age + pool.phase[i]!);
          const h = pool.heading[i]! + e.turn * age;
          const pitch = pool.pitch[i]! + e.rock * swing;
          const roll = e.rock * 0.6 * Math.cos(2 * Math.PI * e.swayHz * age + pool.phase[i]!) + 3 * Math.max(0, 0.5 - age) * pool.phase[i]!;
          const [ch, sh, cpt, spt, cr, sr] = [Math.cos(h), Math.sin(h), Math.cos(pitch), Math.sin(pitch), Math.cos(roll), Math.sin(roll)];
          const [ax, ay, az] = [ch * cpt, spt, sh * cpt];
          // Across: the level side direction, rolled about the length.
          const [bx, by, bz] = [-sh, 0, ch];
          const [nx, ny, nz] = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
          out.set([ax * half, ay * half, az * half, (bx * cr + nx * sr) * width, (by * cr + ny * sr) * width, (bz * cr + nz * sr) * width], o + DETAIL.along);
        }
        out[o + DETAIL.floor] = pool.floor(i, pool.x[i]!, pool.z[i]!, hf) - cy;
        words[o + DETAIL.colourA] = pool.colourA[i]!;
        words[o + DETAIL.colourB] = pool.colourB[i]!;
        words[o + DETAIL.misc] = (pool.cell[i]! | (pool.flags[i]! << 8) | (Math.round(shows * 255) << 16) | (pool.grey[i]! << 24)) >>> 0;
        if (pass === 0) cut++;
        else {
          order[blended] = (0x7ffff - Math.min(0x7ffff, Math.floor(d * 64))) * MAX_DETAILS + n;
          blended++;
        }
      }
    }
    // The see-through ones far to near: their keys are inverted distances, sorted from least.
    if (blended > 1) {
      sortU32(order, blended);
      const from = p.details.slice(cut * DETAIL_FLOATS, (cut + blended) * DETAIL_FLOATS);
      for (let k = 0; k < blended; k++) out.set(from.subarray(((order[k]! % MAX_DETAILS) - cut) * DETAIL_FLOATS, ((order[k]! % MAX_DETAILS) - cut + 1) * DETAIL_FLOATS), (cut + k) * DETAIL_FLOATS);
    }
    p.detailCount = cut + blended;
    p.detailFill = this.fill = fill;
    return cut;
  }
}

/** Fast at first and slower as it ends, 0 to 1. */
function ease(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return 1 - (1 - t) * (1 - t);
}
