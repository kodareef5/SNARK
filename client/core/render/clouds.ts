// How smoke and gas look (planning/reference/weapons-plan.md, M7). Every prop/cloud in the snapshot is drawn as layered
// puffs over its reach: cards made here, facing the eye, and drawn by the small details' program (packet.ts
// DRAW_DETAILS) with the details' dust pictures on a lit tier and their flat puff on low poly. A core of cut-out puffs is
// opaque on every tier, so whatever stands in the cloud or behind it is hidden; a rim of see-through puffs softens its
// edge. The server gives the cloud's entity its ticks and its end as a young thing's growing (server/clouds.ts), so each
// client knows how old it is: it billows out over its first seconds, turns and bobs as it hangs, and thins away over its
// last. Each cloud's puffs are seeded by its entity id, so every client draws it alike. Nothing here is read by the
// simulation.

import type { Registry } from "../../../shared/content/registry.ts";
import { TICK_RATE } from "../../../shared/coords.ts";
import type { PackDetails } from "../../../shared/pack/details.ts";
import { Rng } from "../../../shared/rng.ts";
import { sortU32 } from "../../../shared/sort.ts";
import type { RemoteSample } from "../session.ts";
import type { Camera } from "./camera.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_LIT, DETAIL_PUFF, MAX_DETAILS, type FramePacket } from "./packet.ts";

/** Cut-out puffs in a cloud of radius R and height H: one for every this many cubic metres of its dome, within the bounds. */
const CORE_VOLUME = 20;
const CORE_LEAST = 10;
const CORE_MOST = 48;
/** See-through puffs round its rim, as a share of its core, and how much of one shows at most. */
const RIM_SHARE = 0.5;
const RIM_SHOWS = 0.75;
/** A core puff's width as a share of the cloud's radius, from and to; a rim puff's. */
const CORE_SIZE: readonly [number, number] = [0.7, 1];
const RIM_SIZE: readonly [number, number] = [0.8, 1.15];
/** Seconds it takes to billow out, and the most seconds it thins away over (a fifth of its life for a short one). */
const BILLOW = 1.5;
const THIN = 6;
/** Radians a second a puff turns at most, and metres it bobs. */
const TURN = 0.06;
const BOB = 0.15;
/** A puff nearer the eye than this many metres, plus its half width, fades away, so one through the camera does not wall the view in at once. */
const EYE_FADE = 1.5;
/** Shades a puff's colour is varied by. */
const VARY = 0.07;

/** Where in a cloud one puff sits, made once per cloud from its seed. Shares of the cloud's radius and height. */
interface Puff {
  /** Out from the middle, as shares of the radius, and up from the floor as a share of the height. */
  ox: number;
  oz: number;
  up: number;
  /** Its width as a share of the radius. */
  size: number;
  heading: number;
  turn: number;
  phase: number;
  /** Its colour word, its picture's cell, flags and grey as its misc word without how much shows. */
  colour: number;
  misc: number;
  rim: boolean;
}

export class Clouds {
  /** 1 for each content index that is a prop/cloud: the scene draws no mesh for it. */
  readonly kinds: Uint8Array;
  /** Puffs written and left out for room in the last frame. */
  written = 0;
  dropped = 0;
  private readonly radius: Float32Array;
  private readonly height: Float32Array;
  private readonly colour: Uint8Array;
  private readonly palette: Uint8Array;
  /** The details' dust pictures: their cells, flat shapes and greys. Cell 0 and the puff shape where the pack has none. */
  private readonly cells: number[] = [];
  private readonly flats: number[] = [];
  private readonly greys: number[] = [];
  /** Each cloud's puffs, by entity id, made the first frame it is seen and dropped when it is gone. */
  private readonly made = new Map<number, Puff[]>();
  private readonly seen = new Set<number>();
  /** This frame's see-through puffs, kept aside to be written far to near. */
  private readonly soft = new Float32Array(MAX_DETAILS * DETAIL_FLOATS);
  private readonly softWords = new Uint32Array(this.soft.buffer);
  private readonly order = new Uint32Array(MAX_DETAILS);

  constructor(reg: Registry, details: PackDetails | undefined, palette: Uint8Array) {
    const n = reg.defs.length;
    this.kinds = new Uint8Array(n);
    this.radius = new Float32Array(n);
    this.height = new Float32Array(n);
    this.colour = new Uint8Array(n);
    this.palette = palette;
    for (let k = 1; k < n; k++) {
      const d = reg.defs[k];
      if (d?.type !== "prop" || d.class !== "cloud") continue;
      this.kinds[k] = 1;
      this.radius[k] = d.radius;
      this.height[k] = d.height;
      this.colour[k] = d.color;
    }
    for (const p of details?.pictures ?? []) {
      if (!/\/dust_\d+$/.test(p.id)) continue;
      this.cells.push(p.cell);
      this.flats.push(p.flat);
      this.greys.push(Math.max(1, Math.min(255, Math.round(p.grey * 255))));
    }
    if (this.cells.length === 0) [this.cells[0], this.flats[0], this.greys[0]] = [0, 1, 255];
  }

  /**
   * Writes the puffs of the clouds in view into `p` after its particles: the cut-out ones, then the see-through ones far
   * to near. Returns how many are cut out; the rest, to `p.detailCount`, are see-through. `range` gets the nearest and
   * farthest depth along the view any of them reaches.
   */
  write(p: FramePacket, cam: Camera, remote: RemoteSample | null, range: number[]): number {
    this.written = this.dropped = 0;
    range[0] = Infinity;
    range[1] = -Infinity;
    const seen = this.seen;
    seen.clear();
    if (!remote) {
      this.made.clear();
      return 0;
    }
    const out = p.details;
    const words = p.detailWords;
    const first = p.detailCount;
    let cut = 0;
    let soft = 0;
    // The camera's right and up, which a puff faces.
    const [sy, cyw, sp, cp] = [Math.sin(cam.yaw), Math.cos(cam.yaw), Math.sin(cam.pitch), Math.cos(cam.pitch)];
    const [rx, rz] = [-cyw, sy];
    const [ux, uy, uz] = [-sy * sp, cp, -cyw * sp];
    const tick = remote.tick;
    for (let i = 0; i < remote.count; i++) {
      const kind = remote.kind[i]!;
      if (this.kinds[kind] === 0) continue;
      const id = remote.id[i]!;
      seen.add(id);
      const R = this.radius[kind]!;
      const H = this.height[kind]!;
      const x = remote.x[i]! - cam.x;
      const y = remote.y[i]! - cam.y;
      const z = remote.z[i]! - cam.z;
      const reach = R * (1 + RIM_SIZE[1] * 0.5);
      if (!cam.boxVisible(x - reach, y - reach * 0.5, z - reach, x + reach, y + H + reach * 0.5, z + reach)) continue;
      let puffs = this.made.get(id);
      if (!puffs) this.made.set(id, (puffs = this.puffs(id, R, H, this.colour[kind]!)));
      // How old it is and how long it has left, in seconds, from its span and end.
      const span = remote.span[i]!;
      const end = remote.grown[i]!;
      const age = end !== 0 ? Math.max(0, (tick - (end - span)) / TICK_RATE) : BILLOW;
      const left = end !== 0 ? Math.max(0, (end - tick) / TICK_RATE) : Infinity;
      const thin = Math.min(THIN, (span / TICK_RATE) * 0.2);
      const out1 = ease(Math.min(1, age / BILLOW));
      const going = thin > 0 ? Math.min(1, left / thin) : 1;
      const spread = 0.35 + 0.65 * out1 + 0.15 * (1 - going);
      const floor = y - 0.1;
      for (const f of puffs) {
        const half = f.size * R * 0.5 * (0.4 + 0.6 * out1) * (1 + 0.25 * (1 - going));
        const px = x + f.ox * R * spread;
        const py = y + Math.max(half * 0.45, f.up * H * (0.5 + 0.5 * out1)) + BOB * Math.sin(age * 0.6 + f.phase) + (1 - going) * 0.5;
        const pz = z + f.oz * R * spread;
        const d = Math.sqrt(px * px + py * py + pz * pz);
        let shows = going * Math.min(1, Math.max(0, (d - half * 0.5) / EYE_FADE));
        if (f.rim) shows *= RIM_SHOWS;
        if (shows <= 0.02) continue;
        if (first + cut + soft >= MAX_DETAILS) {
          this.dropped++;
          continue;
        }
        const depth = cam.depth(px, py, pz);
        if (depth - half < range[0]!) range[0] = depth - half;
        if (depth + half > range[1]!) range[1] = depth + half;
        // A see-through puff waits in `soft`; a cut-out one goes straight in.
        const to = f.rim ? this.soft : out;
        const toWords = f.rim ? this.softWords : words;
        const o = (f.rim ? soft : first + cut) * DETAIL_FLOATS;
        to[o + DETAIL.middle] = px;
        to[o + DETAIL.middle + 1] = py;
        to[o + DETAIL.middle + 2] = pz;
        const a = f.heading + f.turn * age;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        to[o + DETAIL.along] = (ux * ca - rx * sa) * half;
        to[o + DETAIL.along + 1] = uy * ca * half;
        to[o + DETAIL.along + 2] = (uz * ca - rz * sa) * half;
        to[o + DETAIL.across] = (rx * ca + ux * sa) * half;
        to[o + DETAIL.across + 1] = uy * sa * half;
        to[o + DETAIL.across + 2] = (rz * ca + uz * sa) * half;
        to[o + DETAIL.floor] = floor;
        toWords[o + DETAIL.colourA] = f.colour;
        toWords[o + DETAIL.colourB] = f.colour;
        toWords[o + DETAIL.misc] = (f.misc | (Math.round(Math.min(1, shows) * 255) << 16)) >>> 0;
        if (f.rim) {
          this.order[soft] = (0x7ffff - Math.min(0x7ffff, Math.floor(d * 64))) * MAX_DETAILS + soft;
          soft++;
        } else cut++;
      }
    }
    for (const id of this.made.keys()) if (!seen.has(id)) this.made.delete(id);
    // The see-through ones far to near: their keys are inverted distances, sorted from least.
    sortU32(this.order, soft);
    // Copied as words, so a colour word that reads as a float's NaN keeps its bits.
    const from = this.softWords;
    for (let k = 0; k < soft; k++) {
      const a = (this.order[k]! % MAX_DETAILS) * DETAIL_FLOATS;
      const b = (first + cut + k) * DETAIL_FLOATS;
      for (let w = 0; w < DETAIL_FLOATS; w++) words[b + w] = from[a + w]!;
    }
    p.detailCount = first + cut + soft;
    this.written = cut + soft;
    return cut;
  }

  /** The puffs of a cloud, seeded by its id: a core within its dome, and a rim round its edge. */
  private puffs(id: number, R: number, H: number, dye: number): Puff[] {
    const rng = new Rng((id * 2654435761) ^ 0x5eed);
    const dome = (2 / 3) * Math.PI * R * R * H;
    const core = Math.max(CORE_LEAST, Math.min(CORE_MOST, Math.round(dome / CORE_VOLUME)));
    const rim = Math.round(core * RIM_SHARE);
    const out: Puff[] = [];
    for (let k = 0; k < core + rim; k++) {
      const isRim = k >= core;
      // A core puff anywhere within three quarters of the radius, thicker near the middle; a rim puff round the edge.
      const turn = ((k + rng.float() * 0.7) / (isRim ? rim : core)) * Math.PI * 2;
      const r = isRim ? 0.7 + rng.float() * 0.25 : 0.72 * Math.sqrt(rng.float());
      // Lower near the edge, so the cloud is a dome.
      const up = (isRim ? 0.15 + rng.float() * 0.45 : 0.15 + rng.float() * 0.6) * Math.sqrt(Math.max(0.2, 1 - r * r));
      const [lo, hi] = isRim ? RIM_SIZE : CORE_SIZE;
      out.push({
        ox: Math.cos(turn) * r,
        oz: Math.sin(turn) * r,
        up,
        size: lo + rng.float() * (hi - lo),
        heading: rng.float() * Math.PI * 2,
        turn: (rng.float() * 2 - 1) * TURN,
        phase: rng.float() * Math.PI * 2,
        colour: this.paint(dye, 1 + VARY * (rng.float() * 2 - 1)),
        misc: this.misc(Math.floor(rng.float() * this.cells.length)),
        rim: isRim,
      });
    }
    return out;
  }

  /** A misc word of picture `k`, lit as a puff, showing nothing yet. */
  private misc(k: number): number {
    return (this.cells[k]! | ((this.flats[k]! | DETAIL_LIT | DETAIL_PUFF) << 8) | (this.greys[k]! << 24)) >>> 0;
  }

  /** The colour word of palette colour `dye`, shaded, as a particle's region colour (sRGB, opaque). */
  private paint(dye: number, shade: number): number {
    const pal = this.palette;
    const k = (v: number): number => Math.max(0, Math.min(255, Math.round(v * shade)));
    return (k(pal[dye * 4]!) | (k(pal[dye * 4 + 1]!) << 8) | (k(pal[dye * 4 + 2]!) << 16) | (255 << 24)) >>> 0;
  }
}

/** Fast at first and slower as it ends, 0 to 1. */
function ease(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return 1 - (1 - t) * (1 - t);
}
