// A local street environment. Only the resident near stores and the already sampled traffic enter the capture.
import { surfaceIndex } from "../../../content/surfaces.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE, YAW_UNITS } from "../../../shared/coords.ts";
import { isWheelVehicle } from "../../../shared/sim/vehicle.ts";
import { type NodeForms, SIZE_UNITS } from "../../../shared/world/nodes.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { StructureStore } from "../../../shared/world/structures.ts";
import type { RemoteSample } from "../session.ts";
import type { Camera } from "./camera.ts";
import type { RenderWorld } from "./scene.ts";
import { FRAME, type FramePacket } from "./packet.ts";

import { GLASS, RUST, STEEL, STREET_HEIGHT, STREET_WIDTH, type StreetImage, streetPriority } from "./street-finish.ts";
const TAU = 2 * Math.PI, REACH = 36, MAX_PROXIES = 128, ROWS_PER_CHUNK = 192;
const columns = Array.from({ length: STREET_WIDTH }, (_, i) => {
  const angle = ((i + 0.5) / STREET_WIDTH - 0.5) * TAU;
  return [Math.sin(angle), Math.cos(angle)] as const;
});
const elevations = Float64Array.from({ length: STREET_HEIGHT }, (_, j) => Math.tan(((j + 0.5) / STREET_HEIGHT - 0.5) * Math.PI));

interface ResidentBounds {
  meshes: readonly { center: readonly number[]; half: readonly number[] }[];
  kinds: Uint16Array;
  forms: Uint16Array;
}
interface Proxy {
  id: number;
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
  color: number;
  tree: boolean;
  importance: number;
}

/** The resident static kinds eligible to anchor a shared street picture. */
export function placedPriority(d: Registry["defs"][number]): number {
  if (!d) return 0;
  const declared = Math.max(streetPriority(d.id), "mesh" in d ? streetPriority(d.mesh) : 0);
  if (declared || d.type !== "structure" || d.id.startsWith("core:compact_wreck")) return declared;
  const surface = surfaceIndex(d.color, false);
  return surface === GLASS ? 0.7 : surface === STEEL ? 0.35 : surface === RUST ? 0.12 : 0;
}

export class StreetReflections {
  private readonly priority: Float32Array;
  private readonly proxies: Proxy[] = [];
  private scratch: Uint8Array | null = null;
  private readonly depth = new Float32Array(STREET_WIDTH * STREET_HEIGHT);
  private next = -Infinity;
  private started = 0;
  private lastX = Infinity;
  private lastZ = Infinity;
  private x = 0;
  private y = 0;
  private z = 0;
  private anchor = -1;
  private image: StreetImage | null = null;
  private best = 0;
  private winner: Proxy | null = null;
  private count = 0;
  private ground = 0;
  private readonly reg: Registry;
  private readonly palette: Uint8Array;
  private readonly forms: NodeForms;
  private readonly bounds?: ResidentBounds;
  constructor(reg: Registry, palette: Uint8Array, forms: NodeForms, bounds?: ResidentBounds) {
    this.bounds = bounds;
    this.reg = reg;
    this.palette = Uint8Array.from(palette, (channel) => Math.round(255 * (channel / 255) ** 2.2));
    this.forms = forms;
    this.priority = Float32Array.from(reg.defs, placedPriority);
  }

  frame(p: FramePacket, cam: Camera, world: RenderWorld, remote: RemoteSample | null, hidden: ReadonlySet<number>, now: number): void {
    const offset = FRAME.reflection;
    p.frame[offset + 3] = 0;
    p.street = null;
    const hz = p.tier.reflectionHz;
    if (!p.lit || !hz) {
      this.image = null;
      this.scratch = null;
      this.anchor = -1;
      this.next = -Infinity;
      return;
    }
    if (Math.hypot(cam.x - this.lastX, cam.z - this.lastZ) > 20 || (this.anchor !== -1 && Math.abs(cam.y - this.y) > 24)) {
      this.anchor = -1;
      this.next = -Infinity;
    }
    if (now >= this.next) {
      this.next = now + 1000 / hz;
      this.lastX = cam.x;
      this.lastZ = cam.z;
      this.best = 0;
      this.winner = null;
      this.count = 0;
      // Include interpolated traffic, even where it is off screen in the main view.
      if (remote) {
        for (let i = 0; i < remote.count; i++) {
          const k = remote.kind[i]!, v = this.reg.vehicle[k];
          if (!v || !isWheelVehicle(v)) continue;
          const s = v.spec;
          this.consider(
            cam,
            -2 - remote.id[i]!,
            remote.x[i]!,
            remote.y[i]! + v.beltline * 0.65,
            remote.z[i]!,
            s.halfWidth,
            Math.max(0.55, v.beltline * 0.7),
            s.halfLength,
            remote.yaw[i]!,
            remote.colors[i * 6]!,
            false,
            1,
          );
        }
      }
      this.gather(world.structs, cam, false, hidden);
      if (this.winner) {
        const winner: Proxy = this.winner;
        if (world.nodes) this.gather(world.nodes, cam, true, hidden);
        if (this.anchor === -1 || Math.hypot(winner.x - this.x, winner.y - this.y, winner.z - this.z) > 5) this.started = now;
        this.anchor = winner.id;
        this.x = winner.x;
        this.y = winner.y;
        this.z = winner.z;
        this.ground = world.hf.heightAt(this.x, this.z);
        this.capture(world.hf);
      } else this.anchor = -1;
    }
    if (this.anchor === -1 || !this.image) return;
    p.street = this.image;
    p.frame[offset] = this.x - cam.x;
    p.frame[offset + 1] = this.y - cam.y;
    p.frame[offset + 2] = this.z - cam.z;
    p.frame[offset + 3] = Math.min(1, Math.max(0, now - this.started) / 180);
  }

  private gather(store: StructureStore, cam: Camera, nodes: boolean, hidden: ReadonlySet<number>): void {
    const { chunksX, chunksZ } = store.dims;
    for (
      let j = Math.max(0, Math.floor((cam.z - REACH) / CHUNK_SIZE));
      j <= Math.min(chunksZ - 1, Math.floor((cam.z + REACH) / CHUNK_SIZE));
      j++
    ) {
      for (
        let i = Math.max(0, Math.floor((cam.x - REACH) / CHUNK_SIZE));
        i <= Math.min(chunksX - 1, Math.floor((cam.x + REACH) / CHUNK_SIZE));
        i++
      ) {
        const chunk = j * chunksX + i, t = store.chunks[chunk];
        if (!t) continue;
        const rows = Math.min(t.high, ROWS_PER_CHUNK);
        for (let row = 0; row < rows; row++) {
          const slot = Math.floor(row * t.high / rows), form = t.kind[slot]!, ref = chunk * 65536 + slot;
          if (!form || (nodes && (this.forms.depleted[form] || hidden.has(ref)))) continue;
          const k = nodes ? this.forms.kind[form]! : form;
          const d = this.reg.defs[k];
          if (!d || !("color" in d) || d.color === undefined) continue;
          const size = nodes ? this.forms.size[form]! / SIZE_UNITS : 1;
          const bounds = this.bounds;
          const mesh = bounds?.meshes[(nodes ? bounds.forms : bounds.kinds)[form]!];
          // A manifest stub has zero bounds until its page arrives. The collision box already exists.
          const shape = mesh && mesh.half[0]! > 0 && mesh.half[1]! > 0 && mesh.half[2]! > 0 ? mesh : null;
          const hx = (shape?.half[0] ?? this.reg.halfX[k]!) * size;
          const hy = (shape?.half[1] ?? this.reg.halfY[k]!) * size;
          const hz = (shape?.half[2] ?? this.reg.halfZ[k]!) * size;
          const priority = nodes ? 0 : this.priority[k]!;
          if (hy < 0.18 && !priority) continue;
          const yaw = t.yaw[slot]! * TAU / YAW_UNITS;
          const ox = (shape?.center[0] ?? 0) * size, oz = (shape?.center[2] ?? 0) * size;
          const x = t.x[slot]! + ox * Math.cos(yaw) + oz * Math.sin(yaw);
          const z = t.z[slot]! - ox * Math.sin(yaw) + oz * Math.cos(yaw);
          const y = t.y[slot]! + (shape ? shape.center[1]! * size : nodes ? hy : 0);
          this.consider(cam, nodes ? ref + 2 ** 40 : ref, x, y, z, hx, hy, hz, yaw, d.color, nodes && hy > hx, priority);
        }
      }
    }
  }

  private consider(
    cam: Camera,
    id: number,
    x: number,
    y: number,
    z: number,
    hx: number,
    hy: number,
    hz: number,
    yaw: number,
    color: number,
    tree: boolean,
    priority: number,
  ): void {
    const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > REACH * REACH || hx <= 0 || hz <= 0) return;
    const radius = Math.max(hx, hz), area = radius * Math.max(hy, Math.min(hx, hz));
    const importance = Math.min(24, area) / (2 + d2);
    let score = 0;
    if (priority && d2 < 20 * 20 && cam.boxVisible(dx - radius, dy - hy, dz - radius, dx + radius, dy + hy, dz + radius)) {
      const m = cam.viewProj, depth = Math.max(1, dx * m[3]! + dy * m[7]! + dz * m[11]!);
      const offX = Math.abs(dx * m[0]! + dy * m[4]! + dz * m[8]!), offY = Math.abs(dx * m[1]! + dy * m[5]! + dz * m[9]!);
      const inFrame = Math.max(0.15, Math.min(1, 1.5 - Math.max(offX, offY) / depth));
      score = priority * importance * inFrame * (id === this.anchor ? 1.35 : 1);
    }
    const data = { id, x, y, z, hx, hy, hz, yaw, color, tree, importance };
    if (score > Math.max(this.best, 0.0012)) {
      this.best = score;
      this.winner = data;
    }
    if (this.count < MAX_PROXIES) this.proxies[this.count++] = data;
    else {
      let least = 0;
      for (let n = 1; n < MAX_PROXIES; n++) if (this.proxies[n]!.importance < this.proxies[least]!.importance) least = n;
      if (importance > this.proxies[least]!.importance) this.proxies[least] = data;
    }
  }

  private capture(hf: Heightfield): void {
    const image = this.image ??= { pixels: new Uint8Array(STREET_WIDTH * STREET_HEIGHT * 4), revision: 0 };
    const pixels = this.scratch ??= new Uint8Array(image.pixels.length);
    pixels.fill(0);
    this.depth.fill(Infinity);
    for (let j = 0; j < STREET_HEIGHT / 2; j++) {
      const distance = Math.max(0.2, this.y - this.ground) / -elevations[j]!;
      for (let i = 0; i < STREET_WIDTH; i++) {
        const at = j * STREET_WIDTH + i;
        this.depth[at] = distance;
        const [sx, sz] = columns[i]!;
        const gx = Math.max(0, Math.min(hf.nx - 1, Math.round((this.x + distance * sx) / hf.cell)));
        const gz = Math.max(0, Math.min(hf.nz - 1, Math.round((this.z + distance * sz) / hf.cell)));
        const tint = hf.tint[gz * hf.nx + gx];
        for (let ch = 0; ch < 3; ch++) pixels[at * 4 + ch] = tint === undefined ? 39 : this.palette[tint * 4 + ch]!;
        pixels[at * 4 + 3] = 255;
      }
    }
    for (let k = 0; k < this.count; k++) {
      const b = this.proxies[k]!;
      if (b.id === this.anchor) continue;
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      const x = (this.x - b.x) * c - (this.z - b.z) * s, z = (this.x - b.x) * s + (this.z - b.z) * c;
      const y = b.y - this.y;
      for (let i = 0; i < STREET_WIDTH; i++) {
        const [sx, sz] = columns[i]!;
        const dx = sx * c - sz * s || 1e-9, dz = sx * s + sz * c || 1e-9;
        const x1 = (-b.hx - x) / dx, x2 = (b.hx - x) / dx, z1 = (-b.hz - z) / dz, z2 = (b.hz - z) / dz;
        const front = Math.max(0.25, Math.min(x1, x2), Math.min(z1, z2)), back = Math.min(Math.max(x1, x2), Math.max(z1, z2));
        if (back <= front) continue;
        const shade = Math.min(x1, x2) > Math.min(z1, z2) ? 0.76 : 0.94;
        for (let j = 0; j < STREET_HEIGHT; j++) {
          const slope = elevations[j]!, lo = (y - b.hy) / slope, hi = (y + b.hy) / slope;
          let t = Math.max(front, Math.min(lo, hi));
          const at = j * STREET_WIDTH + i;
          if (t > Math.min(back, Math.max(lo, hi)) || t >= this.depth[at]!) continue;
          if (b.tree) {
            // Intersect the crown as an ellipsoid inside the resident mesh bounds.
            const ax = dx / b.hx, ay = slope / b.hy, az = dz / b.hz;
            const ox = x / b.hx, oy = -y / b.hy, oz = z / b.hz;
            const a = ax * ax + ay * ay + az * az, dot = ox * ax + oy * ay + oz * az;
            const disc = dot * dot - a * (ox * ox + oy * oy + oz * oz - 1);
            if (disc < 0) continue;
            t = Math.max(t, (-dot - Math.sqrt(disc)) / a);
            if (t >= this.depth[at]!) continue;
          }
          this.depth[at] = t;
          for (let ch = 0; ch < 3; ch++) pixels[4 * at + ch] = Math.round(this.palette[b.color * 4 + ch]! * shade);
          pixels[4 * at + 3] = 255;
        }
      }
    }
    // A still street needs no upload. Keep the image object and its byte array stable for renderer caches.
    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i] === image.pixels[i]) continue;
      image.pixels.set(pixels);
      image.revision++;
      break;
    }
  }
}
