// The wires hung between the wooden utility poles still standing (content/street.ts `pole`): each pole is strung to
// the nearest standing pole ahead and behind along its line, three wires from its insulators sagging between them, and
// a pole that is down (`pole_leaning`) breaks the run. Thin see-through detail cards (packet.ts DETAIL_WIRE), lit as the
// scene is, never thinner than about a pixel and fainter as they would be.

import type { Registry } from "../../../shared/content/registry.ts";
import type { StructureStore } from "../../../shared/world/structures.ts";
import { CHUNK_SIZE } from "../../../shared/coords.ts";
import type { Camera } from "./camera.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_LIT, DETAIL_WIRE, type FramePacket } from "./packet.ts";
import { VehicleCards } from "./vehicle-cards.ts";

/** Spans strung at once, nearest first; each is three wires of SEGMENTS cards. */
export const MAX_SPANS = 96;
const SEGMENTS = 8;
/** Metres out to which wires are drawn, and from which they fade to nothing there. */
const REACH = 220, FADE_FROM = 170;
/** The longest and shortest span between two poles, and how far a span's far pole may stand off the line it runs. */
const LONGEST = 80, SHORTEST = 12, OFF_LINE = 0.3, OFF_SLACK = 1.5;
/** How nearly two poles strung together face the same way (the cosine between their crossarms): within 35 degrees. */
const ALIGNED = 0.82;
/** The insulators' tops in the pole's own frame: across the line along its crossarm (z), at this height (model.py). */
const INSULATORS = [-1.05, 0.16, 1.05] as const;
const HANG = 10.22;
/** A wire's sag at mid span, per metre of span. */
const SAG = 0.025;
/** A wire's radius, and the half width of a pixel at a metre: a wire is drawn no thinner and shows its share of that. */
const RADIUS = 0.012, PIXEL = 0.0007;
/** Weathered black, as RGBA bytes least significant first. */
const COLOUR = 0xff2a2c2e;

/**
 * The spans between standing poles, from `poles` (x, y, z, yaw in radians, and 1 for one standing or 0 for one down,
 * five numbers each): pairs of indices. A pole down between two standing ones breaks the run.
 */
export function spansOf(poles: ArrayLike<number>, longest = LONGEST, offLine = OFF_LINE, aligned = ALIGNED): number[] {
  const n = poles.length / 5;
  // Each pole's nearest pole ahead and behind along its line (its local x), as long as they face nearly as it does.
  const ahead = new Int32Array(n).fill(-1), behind = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (poles[i * 5 + 4] !== 1) continue;
    const yaw = poles[i * 5 + 3]!, ax = Math.cos(yaw), az = -Math.sin(yaw);
    let best = [Infinity, Infinity];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = poles[j * 5]! - poles[i * 5]!, dz = poles[j * 5 + 2]! - poles[i * 5 + 2]!;
      const d = Math.hypot(dx, dz);
      if (d < SHORTEST || d > longest) continue;
      const along = dx * ax + dz * az, off = Math.abs(dz * ax - dx * az);
      if (off > offLine * Math.abs(along) + OFF_SLACK) continue;
      const other = poles[j * 5 + 3]!;
      if (Math.abs(ax * Math.cos(other) - az * Math.sin(other)) < aligned) continue;
      const k = along > 0 ? 0 : 1;
      if (d < best[k]!) { best[k] = d; (k === 0 ? ahead : behind)[i] = j; }
    }
  }
  // A span where each pole is the other's nearest that way.
  const spans: number[] = [];
  for (let i = 0; i < n; i++) for (const j of [ahead[i]!, behind[i]!]) {
    if (j > i && poles[j * 5 + 4] === 1 && (ahead[j] === i || behind[j] === i)) spans.push(i, j);
  }
  return spans;
}

export class StreetWires extends VehicleCards {
  private readonly kind: number;
  private readonly down: number;
  /** The poles of each chunk: x, y, z, yaw (radians) and whether it stands, five numbers each, as of the chunk's version. */
  private readonly chunks = new Map<number, { version: number; poles: Float64Array }>();
  private readonly near: number[] = [];
  private readonly a = [0, 0, 0];
  private readonly b = [0, 0, 0];
  /** Whether the frame draws them (passes.ts `wires`). */
  on = true;

  constructor(reg: Registry) {
    super(MAX_SPANS * INSULATORS.length * SEGMENTS);
    this.kind = reg.index.get("core:zzstreet_pole") ?? -1;
    this.down = reg.index.get("core:zzstreet_pole_leaning") ?? -1;
  }

  /** The cards for this frame, the camera at `cam`. */
  build(p: FramePacket, cam: Camera, structs: StructureStore, chunksX: number, chunksZ: number): void {
    this.begin();
    if (!this.on || this.kind < 0) return;
    const near = this.near; near.length = 0;
    const out = REACH + LONGEST;
    const c0 = Math.max(0, Math.floor((cam.x - out) / CHUNK_SIZE)), c1 = Math.min(chunksX - 1, Math.floor((cam.x + out) / CHUNK_SIZE));
    const r0 = Math.max(0, Math.floor((cam.z - out) / CHUNK_SIZE)), r1 = Math.min(chunksZ - 1, Math.floor((cam.z + out) / CHUNK_SIZE));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const poles = this.polesOf(structs, r * chunksX + c);
      for (let i = 0; i < poles.length; i += 5) {
        if (Math.hypot(poles[i]! - cam.x, poles[i + 2]! - cam.z) < out) for (let k = 0; k < 5; k++) near.push(poles[i + k]!);
      }
    }
    const spans = spansOf(near);
    // The nearest spans by their middles, as many as there is room for, drawn far to near.
    const dist = (s: number): number => Math.hypot((near[spans[s]! * 5]! + near[spans[s + 1]! * 5]!) / 2 - cam.x, (near[spans[s]! * 5 + 2]! + near[spans[s + 1]! * 5 + 2]!) / 2 - cam.z);
    const order: number[] = [];
    for (let s = 0; s < spans.length; s += 2) if (dist(s) < REACH) order.push(s);
    order.sort((s, t) => dist(s) - dist(t));
    order.length = Math.min(order.length, MAX_SPANS);
    order.reverse();
    const a = this.a, b = this.b;
    for (const s of order) {
      const i = spans[s]! * 5, j = spans[s + 1]! * 5;
      const fade = Math.min(1, Math.max(0, (REACH - dist(s)) / (REACH - FADE_FROM)));
      // Each pole's crossarm runs along its local z, (sin yaw, cos yaw); a pole turned the other way takes its wires in turn.
      const si = Math.sin(near[i + 3]!), ci = Math.cos(near[i + 3]!), sj = Math.sin(near[j + 3]!), cj = Math.cos(near[j + 3]!);
      const flip = si * sj + ci * cj < 0;
      const span = Math.hypot(near[j]! - near[i]!, near[j + 2]! - near[i + 2]!);
      for (let w = 0; w < INSULATORS.length; w++) {
        const zi = INSULATORS[w]!, zj = INSULATORS[flip ? INSULATORS.length - 1 - w : w]!;
        a[0] = near[i]! + si * zi - cam.x; a[1] = near[i + 1]! + HANG - cam.y; a[2] = near[i + 2]! + ci * zi - cam.z;
        b[0] = near[j]! + sj * zj - cam.x; b[1] = near[j + 1]! + HANG - cam.y; b[2] = near[j + 2]! + cj * zj - cam.z;
        this.wire(a, b, SAG * span, fade);
      }
    }
  }

  /** A wire from `a` to `b` (from the camera), `sag` metres low at its middle, in SEGMENTS straight cards. */
  private wire(a: number[], b: number[], sag: number, fade: number): void {
    for (let k = 0; k < SEGMENTS; k++) {
      const t0 = k / SEGMENTS, t1 = (k + 1) / SEGMENTS;
      const y0 = a[1]! + (b[1]! - a[1]!) * t0 - 4 * sag * t0 * (1 - t0), y1 = a[1]! + (b[1]! - a[1]!) * t1 - 4 * sag * t1 * (1 - t1);
      const x0 = a[0]! + (b[0]! - a[0]!) * t0, z0 = a[2]! + (b[2]! - a[2]!) * t0;
      const x1 = a[0]! + (b[0]! - a[0]!) * t1, z1 = a[2]! + (b[2]! - a[2]!) * t1;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, mz = (z0 + z1) / 2;
      const hx = (x1 - x0) / 2, hy = (y1 - y0) / 2, hz = (z1 - z0) / 2;
      // Its width across both its length and the eye's ray to it.
      let wx = hy * mz - hz * my, wy = hz * mx - hx * mz, wz = hx * my - hy * mx;
      const wl = Math.hypot(wx, wy, wz);
      if (wl < 1e-9) continue;
      const d = Math.hypot(mx, my, mz), half = Math.max(RADIUS, d * PIXEL);
      wx *= half / wl; wy *= half / wl; wz *= half / wl;
      const shows = Math.round(255 * fade * Math.min(1, RADIUS / half * 1.5));
      if (shows <= 0) continue;
      const n = this.next(), card = this.cards;
      card[n] = mx; card[n + 1] = my; card[n + 2] = mz;
      card[n + DETAIL.across] = hx; card[n + DETAIL.across + 1] = hy; card[n + DETAIL.across + 2] = hz;
      card[n + DETAIL.along] = wx; card[n + DETAIL.along + 1] = wy; card[n + DETAIL.along + 2] = wz;
      this.words[n + DETAIL.colourA] = COLOUR;
      this.words[n + DETAIL.colourB] = COLOUR;
      this.words[n + DETAIL.misc] = ((255 << 24) | (Math.min(255, shows) << 16) | ((DETAIL_WIRE | DETAIL_LIT) << 8)) >>> 0;
    }
  }

  /** The cards in the order made, far spans first: no sort is needed. */
  override write(p: FramePacket): void {
    const words = this.words;
    for (let n = 0; n < this.count; n++) {
      const from = n * DETAIL_FLOATS, to = p.detailCount++ * DETAIL_FLOATS;
      for (let f = 0; f < DETAIL_FLOATS; f++) p.detailWords[to + f] = words[from + f]!;
    }
  }

  /** A chunk's poles, read again only when its table has changed. */
  private polesOf(structs: StructureStore, chunk: number): Float64Array {
    const t = structs.chunks[chunk];
    const version = t ? t.version : -1;
    const had = this.chunks.get(chunk);
    if (had && had.version === version) return had.poles;
    const found: number[] = [];
    if (t) for (let s = 0; s < t.high; s++) {
      const kind = t.kind[s];
      if (kind === this.kind || kind === this.down) found.push(t.x[s]!, t.y[s]!, t.z[s]!, (t.yaw[s]! / 65536) * 2 * Math.PI, kind === this.kind ? 1 : 0);
    }
    const poles = new Float64Array(found);
    this.chunks.set(chunk, { version, poles });
    return poles;
  }
}
