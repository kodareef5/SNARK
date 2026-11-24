// A local street environment. Only the resident near stores and the already sampled traffic enter the capture.
import type { ShapeBox } from "../../../shared/content/defs.ts";
import { streetSilhouette } from "./street-silhouettes.ts";
import { surfaceIndex } from "../../../content/surfaces.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { CHUNK_SIZE, YAW_UNITS } from "../../../shared/coords.ts";
import { isWheelVehicle } from "../../../shared/sim/vehicle.ts";
import { type NodeForms, SIZE_UNITS } from "../../../shared/world/nodes.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import { ReceiverIndex } from "./receiver-index.ts";
import type { ChunkTable, StructureStore } from "../../../shared/world/structures.ts";
import type { RemoteSample } from "../session.ts";
import { GEAR_COUNT, GEAR_WORN } from "../../../shared/sim/entities.ts";
import { stanceEye } from "../../../shared/sim/character.ts";
import type { Camera } from "./camera.ts";
import type { OwnBody, RenderWorld } from "./scene.ts";
import { FRAME, ORB_AT, type FramePacket } from "./packet.ts";
import { ORB_OVER } from "./orb-light.ts";

import { GLASS, RUST, STEEL, FINE_STREET_WIDTH, STREET_WIDTH, captureByte, streetWidth, type StreetImage, streetPriority } from "./street-finish.ts";
const TAU = 2 * Math.PI, REACH = 36, MAX_PROXIES = 128, ROWS_PER_CHUNK = 192;
function captureGrid(width: number) {
  const height = width / 2;
  const columns = Array.from({length: width}, (_, i) => {
    const angle = ((i + 0.5) / width - 0.5) * TAU;
    return [Math.sin(angle),Math.cos(angle)] as const;
  });
  const elevations = Float64Array.from({length: height}, (_, j) => Math.tan(((j + 0.5) / height - 0.5) * Math.PI));
  return {width,height,columns,elevations};
}
const standardGrid = captureGrid(STREET_WIDTH), fineGrid = captureGrid(FINE_STREET_WIDTH);
const EMPTY_DEPTH = new Float32Array(0);

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
  kind: number;
  ox: number;
  oy: number;
  oz: number;
}

function emptyProxy(): Proxy {
  return { id: -1, x: 0, y: 0, z: 0, hx: 0, hy: 0, hz: 0, yaw: 0, color: 0, tree: false, importance: 0, kind: 0, ox: 0, oy: 0, oz: 0 };
}

/** The resident static kinds eligible to anchor a shared street picture. */
export function placedPriority(d: Registry["defs"][number]): number {
  if (!d) return 0;
  const declared = Math.max(streetPriority(d.id), "mesh" in d ? streetPriority(d.mesh) : 0);
  if (declared || d.type !== "structure") return declared;
  const surface = surfaceIndex(d.color, false);
  return surface === GLASS ? 0.7 : surface === STEEL ? 0.35 : surface === RUST ? 0.12 : 0;
}

/**
 * An orb in the street's picture (orb.ts `orbInStreet`), the picture taken (x, y, z) from the camera. `over` says
 * whether the ball is in it, and sets how many times the sky's light the picture must hold for it, less one, a channel;
 * `paint` then draws its disc over what is not nearer.
 */
export interface StreetOrb {
  over(frame: Float32Array, x: number, y: number, z: number, over: Float32Array): boolean;
  paint(pixels: Uint8Array, depth: Float32Array, width: number, frame: Float32Array, x: number, y: number, z: number, over: Float32Array): void;
}

export class StreetReflections {
  /** The orb's part (orb-late.ts), which comes after the first frame. */
  static orb: StreetOrb | null = null;
  /** Whether the picture holds an orb (passes.ts `orbmirror`), and what this picture, the one before and the one being made hold for it (orb-light.ts ORB_OVER). */
  orb = true;
  private readonly over = new Float32Array(3);
  private readonly overWas = new Float32Array(3);
  private readonly overNext = new Float32Array(3);
  private readonly dense = new WeakMap<ChunkTable, ReceiverIndex>();
  private readonly nearby = new Int32Array(3);
  indexChunk(t: ChunkTable, x0: number, z0: number, cam: Camera): void {
    if (t.high <= ROWS_PER_CHUNK || cam.x < x0-REACH || cam.z < z0-REACH || cam.x > x0+CHUNK_SIZE+REACH || cam.z > z0+CHUNK_SIZE+REACH) return;
    if (this.dense.get(t)?.shape !== t.shape) this.dense.set(t, new ReceiverIndex(t,this.priority));
  }
  /** Per item: 1 for a head piece with a visor, which takes the shared picture. */
  private readonly visor: Uint8Array;
  private readonly priority: Float32Array;
  private readonly proxies = Array.from({ length: MAX_PROXIES }, emptyProxy);
  private candidate = emptyProxy();
  private readonly selected = emptyProxy();
  private readonly drawOrder = new Uint16Array(MAX_PROXIES);
  private readonly silhouettes = new Map<number, readonly ShapeBox[] | null>();
  private previous: StreetImage | null = null;
  private previousX = 0;
  private previousY = 0;
  private previousZ = 0;
  private changedAt = 0;
  private blendMs = 0;
  private revision = 0;
  private scratch: Uint8Array | null = null;
  private depth = EMPTY_DEPTH;
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
  private readonly palette: Float32Array;
  private readonly groundColor: Uint8Array;
  private readonly forms: NodeForms;
  private readonly bounds?: ResidentBounds;
  constructor(reg: Registry, palette: Uint8Array, forms: NodeForms, bounds?: ResidentBounds) {
    this.visor = Uint8Array.from(reg.defs, (d) => (d?.type === "item" && d.wear?.slot === "head" && d.optic?.shape === "visor" ? 1 : 0));
    this.bounds = bounds;
    this.reg = reg;
    this.palette = Float32Array.from(palette, channel => (channel / 255) ** 2.2);
    this.groundColor = Uint8Array.from(this.palette, captureByte);
    this.forms = forms;
    this.priority = Float32Array.from(reg.defs, placedPriority);
  }

  frame(p: FramePacket, cam: Camera, world: RenderWorld, remote: RemoteSample | null, hidden: ReadonlySet<number>, now: number, own?: OwnBody | null): void {
    const offset = FRAME.reflection;
    p.frame[offset + 3] = 0;
    p.street = p.previousStreet = null;
    const history = FRAME.previousReflection;
    p.frame[history + 3] = 0;
    const hz = p.tier.reflectionHz;
    if (!p.lit || !hz) {
      this.image = this.previous = null;
      this.scratch = null;
      this.depth = EMPTY_DEPTH;
      this.anchor = -1;
      this.next = -Infinity;
      return;
    }
    if (Math.hypot(cam.x - this.lastX, cam.z - this.lastZ) > 20 || (this.anchor !== -1 && Math.abs(cam.y - this.y) > 24)) {
      this.anchor = -1;
      this.next = -Infinity;
    }
    const grid = hz >= 4 ? fineGrid : standardGrid;
    if (this.image && streetWidth(this.image) !== grid.width) {
      this.image = this.previous = null;
      this.scratch = null;
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
          const k = remote.kind[i]!,
            v = this.reg.vehicle[k];
          if (!v || !isWheelVehicle(v)) {
            if (this.visor[remote.gear[i * GEAR_COUNT + GEAR_WORN]!] === 1 && remote.id[i] !== own?.cockpitActor)
              this.helmet(cam, remote.id[i]!, k, remote.x[i]!, remote.y[i]!, remote.z[i]!, (remote.anim[i]! >>> 8) & 3);
            continue;
          }
          const s = v.spec;
          this.consider(
            cam,
            -2 - remote.id[i]!,
            remote.x[i]!,
            remote.y[i]! + s.height / 2,
            remote.z[i]!,
            s.halfWidth,
            s.height / 2,
            s.halfLength,
            remote.yaw[i]!,
            remote.colors[i * 6]!,
            false,
            1,
            k,
            0,
            s.height / 2,
            0,
          );
        }
      }
      if (own && !own.firstPerson && this.visor[own.gear[GEAR_WORN]!] === 1)
        this.helmet(cam, own.id, own.kind, own.x, own.y, own.z, own.state.stance);
      this.gather(world.structs, cam, false, hidden);
      if (this.winner) {
        const winner: Proxy = this.winner;
        if (world.nodes) this.gather(world.nodes, cam, true, hidden);
        const travel = Math.hypot(winner.x - this.x, winner.y - this.y, winner.z - this.z);
        const cut = this.anchor === -1 || travel > 16;
        if (cut) {
          this.started = now;
          this.blendMs = 0;
        }
        const oldX = this.x,
          oldY = this.y,
          oldZ = this.z;
        this.anchor = winner.id;
        this.x = winner.x;
        this.y = winner.y;
        this.z = winner.z;
        this.ground = world.hf.heightAt(this.x, this.z);
        if (this.capture(world.hf, travel > 0.01, grid, p.frame, cam) && !cut) {
          this.previousX = oldX;
          this.previousY = oldY;
          this.previousZ = oldZ;
          this.changedAt = now;
          this.blendMs = Math.min(300, 720 / hz);
        }
      } else this.anchor = -1;
    }
    if (this.anchor === -1 || !this.image) return;
    p.street = this.image;
    p.frame[FRAME.streetLook + 1] = this.image.revision & 1;
    if (this.previous && this.blendMs > 0 && now - this.changedAt < this.blendMs) {
      const t = Math.max(0, (now - this.changedAt) / this.blendMs);
      p.previousStreet = this.previous;
      p.frame[history] = this.previousX - cam.x;
      p.frame[history + 1] = this.previousY - cam.y;
      p.frame[history + 2] = this.previousZ - cam.z;
      p.frame[history + 3] = 1 - t * t * (3 - 2 * t);
    }
    // What the pictures hold for an orb goes from the one before's to this one's as they blend.
    for (let c = 0; c < 3; c++) p.frame[ORB_OVER + c] = this.over[c]! + (this.overWas[c]! - this.over[c]!) * p.frame[history + 3]!;
    p.frame[offset] = this.x - cam.x;
    p.frame[offset + 1] = this.y - cam.y;
    p.frame[offset + 2] = this.z - cam.z;
    p.frame[offset + 3] = Math.min(1, Math.max(0, now - this.started) / 180);
  }

  private gather(store: StructureStore, cam: Camera, nodes: boolean, hidden: ReadonlySet<number>): void {
    const { chunksX, chunksZ } = store.dims;
    for (let j = Math.max(0, Math.floor((cam.z - REACH) / CHUNK_SIZE)); j <= Math.min(chunksZ - 1, Math.floor((cam.z + REACH) / CHUNK_SIZE)); j++) {
      for (let i = Math.max(0, Math.floor((cam.x - REACH) / CHUNK_SIZE)); i <= Math.min(chunksX - 1, Math.floor((cam.x + REACH) / CHUNK_SIZE)); i++) {
        const chunk = j * chunksX + i,
          t = store.chunks[chunk];
        if (!t) continue;
        const rows = Math.min(t.high, ROWS_PER_CHUNK);
        let ahead = 0;
        const index = !nodes && t.high > ROWS_PER_CHUNK ? this.dense.get(t) : undefined;
        if (index?.shape === t.shape) {
          const m = cam.viewProj;
          for (let step = 0; step < 3; step++) {
            const range = step * 6;
            const slot = index.nearest(cam.x + range*m[3]!, cam.y + range*m[7]!, cam.z + range*m[11]!);
            if (slot >= 0 && (ahead < 1 || this.nearby[0] !== slot) && (ahead < 2 || this.nearby[1] !== slot)) this.nearby[ahead++] = slot;
          }
        }
        for (let row = 0; row < rows; row++) {
          const slot = row < ahead ? this.nearby[row]! : Math.floor((row-ahead)*t.high/(rows-ahead));
          if (row >= ahead && ((ahead > 0 && slot === this.nearby[0]) || (ahead > 1 && slot === this.nearby[1]) || (ahead > 2 && slot === this.nearby[2]))) continue;
          const form = t.kind[slot]!,
            ref = chunk * 65536 + slot;
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
          const yaw = (t.yaw[slot]! * TAU) / YAW_UNITS;
          const ox = (shape?.center[0] ?? 0) * size,
            oz = (shape?.center[2] ?? 0) * size;
          const x = t.x[slot]! + ox * Math.cos(yaw) + oz * Math.sin(yaw);
          const z = t.z[slot]! - ox * Math.sin(yaw) + oz * Math.cos(yaw);
          const y = t.y[slot]! + (shape ? shape.center[1]! * size : nodes ? hy : 0);
          this.consider(
            cam,
            nodes ? ref + 2 ** 40 : ref,
            x,
            y,
            z,
            hx,
            hy,
            hz,
            yaw,
            d.color,
            nodes && hy > hx,
            priority,
            k,
            ox,
            (shape?.center[1] ?? 0) * size,
            oz,
          );
        }
      }
    }
  }

  private helmet(cam: Camera, id: number, kind: number, x: number, y: number, z: number, stance: number): void {
    const move = this.reg.move[kind];
    if (move) this.consider(cam, -2-id, x, y+stanceEye(move,stance), z, 0.16, 0.14, 0.16, 0, 0, false, 2, kind, 0, 0, 0, true);
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
    kind: number,
    ox: number,
    oy: number,
    oz: number,
    receiverOnly = false,
  ): void {
    const dx = x - cam.x,
      dy = y - cam.y,
      dz = z - cam.z,
      d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > REACH * REACH || hx <= 0 || hz <= 0) return;
    const radius = Math.max(hx, hz),
      area = radius * Math.max(hy, Math.min(hx, hz));
    const importance = Math.min(24, area) / (2 + d2);
    let score = 0;
    if (priority && d2 < 20 * 20 && cam.boxVisible(dx - radius, dy - hy, dz - radius, dx + radius, dy + hy, dz + radius)) {
      const m = cam.viewProj,
        depth = Math.max(1, dx * m[3]! + dy * m[7]! + dz * m[11]!);
      const offX = Math.abs(dx * m[0]! + dy * m[4]! + dz * m[8]!),
        offY = Math.abs(dx * m[1]! + dy * m[5]! + dz * m[9]!);
      const inFrame = Math.max(0.15, Math.min(1, 1.5 - Math.max(offX, offY) / depth));
      score = priority * importance * inFrame * (id === this.anchor ? 1.35 : 1);
    }
    const data = this.candidate;
    data.id = id; data.x = x; data.y = y; data.z = z;
    data.hx = hx; data.hy = hy; data.hz = hz; data.yaw = yaw;
    data.color = color; data.tree = tree; data.importance = importance; data.kind = kind;
    data.ox = ox; data.oy = oy; data.oz = oz;
    if (score > Math.max(this.best, 0.0012)) {
      this.best = score;
      this.winner = Object.assign(this.selected, data);
    }
    if (receiverOnly) return; // A visor receives the shared picture without painting a proxy of itself.
    let slot = this.count;
    if (slot < MAX_PROXIES) this.count++;
    else {
      slot = 0;
      for (let n = 1; n < MAX_PROXIES; n++) if (this.proxies[n]!.importance < this.proxies[slot]!.importance) slot = n;
      if (importance <= this.proxies[slot]!.importance) return;
    }
    this.candidate = this.proxies[slot]!;
    this.proxies[slot] = data;
  }

  private capture(hf: Heightfield, moved: boolean, grid: typeof standardGrid, frame: Float32Array, cam: Camera): boolean {
    const { width, height, columns, elevations } = grid;
    const pixels = (this.scratch ??= new Uint8Array(width * height * 4));
    pixels.fill(0);
    // With an orb in it the picture is a share of more light than the sky's, and all else in it is that much darker.
    const over = this.overNext, ox = this.x - cam.x, oy = this.y - cam.y, oz = this.z - cam.z;
    const ball = this.orb && frame[ORB_AT + 3]! > 0 && StreetReflections.orb !== null && StreetReflections.orb.over(frame, ox, oy, oz, over);
    if (!ball) over.fill(0);
    if (this.depth.length !== width * height) this.depth = new Float32Array(width * height);
    this.depth.fill(Infinity);
    for (let j = 0; j < height / 2; j++) {
      const distance = Math.max(0.2, this.y - this.ground) / -elevations[j]!;
      for (let i = 0; i < width; i++) {
        const at = j * width + i;
        this.depth[at] = distance;
        const [sx, sz] = columns[i]!;
        const gx = Math.max(0, Math.min(hf.nx - 1, Math.round((this.x + distance * sx) / hf.cell)));
        const gz = Math.max(0, Math.min(hf.nz - 1, Math.round((this.z + distance * sz) / hf.cell)));
        const tint = hf.tint[gz * hf.nx + gx];
        for (let ch = 0; ch < 3; ch++) pixels[at * 4 + ch] = ball ? captureByte((tint ? this.palette[tint * 4 + ch]! : 39/255) / (1 + over[ch]!)) : !tint ? captureByte(39/255) : this.groundColor[tint * 4 + ch]!;
        pixels[at * 4 + 3] = 255;
      }
    }
    const fine = grid === fineGrid;
    const order = this.drawOrder.subarray(0, this.count);
    for (let k = 0; k < this.count; k++) order[k] = k;
    if (fine) order.sort((a, b) => this.proxies[b]!.importance - this.proxies[a]!.importance);
    let extra = 96;
    for (const k of order) {
      const b = this.proxies[k]!;
      if (b.id === this.anchor) continue;
      const c = Math.cos(b.yaw),
        s = Math.sin(b.yaw);
      const x = (this.x - b.x) * c - (this.z - b.z) * s,
        z = (this.x - b.x) * s + (this.z - b.z) * c;
      const y = b.y - this.y;
      const sunX = frame[FRAME.sun]! * c - frame[FRAME.sun + 2]! * s;
      const sunZ = frame[FRAME.sun]! * s + frame[FRAME.sun + 2]! * c,
        sunY = frame[FRAME.sun + 1]!;
      let parts: readonly ShapeBox[] | null = null;
      if (fine && !b.tree && extra > 0) {
        if (!this.silhouettes.has(b.kind)) this.silhouettes.set(b.kind, streetSilhouette(this.reg, b.kind));
        parts = this.silhouettes.get(b.kind) ?? null;
      }
      if (parts && parts.length <= extra + 1) {
        extra -= parts.length - 1;
        for (const part of parts) {
          this.drawPart(
            grid,
            pixels,
            c,
            s,
            x + b.ox - part.at[0],
            y - b.oy + part.at[1],
            z + b.oz - part.at[2],
            part.half[0],
            part.half[1],
            part.half[2],
            part.color ?? b.color,
            false,
            sunX,
            sunY,
            sunZ,
          );
        }
      } else if (fine && b.tree && extra > 0) {
        // Leave daylight between crowns and asphalt. The trunk and crown share a world-space centreline.
        extra--;
        this.drawPart(grid, pixels, c, s, x, y - b.hy * 0.45, z, b.hx * 0.14, b.hy * 0.55, b.hz * 0.14, 117, false, sunX, sunY, sunZ);
        this.drawPart(grid, pixels, c, s, x, y + b.hy * 0.34, z, b.hx, b.hy * 0.66, b.hz, b.color, true, sunX, sunY, sunZ);
      } else {
        this.drawPart(grid, pixels, c, s, x, y, z, b.hx, b.hy, b.hz, b.color, b.tree, sunX, sunY, sunZ);
      }
    }
    if (ball) StreetReflections.orb!.paint(pixels, this.depth, width, frame, ox, oy, oz, over);
    if (this.image && !moved && over[0] === this.over[0] && over[1] === this.over[1] && over[2] === this.over[2]) {
      const current = this.image.pixels;
      let i = 0;
      while (i < pixels.length && current[i] === pixels[i]) i++;
      if (i === pixels.length) return false;
    }
    this.overWas.set(this.over);
    this.over.set(over);
    const next = this.previous ?? { pixels: new Uint8Array(pixels.length), revision: 0 };
    this.previous = this.image;
    this.image = next;
    this.scratch = next.pixels;
    next.pixels = pixels;
    next.revision = ++this.revision;
    return true;
  }

  private drawPart(
    grid: typeof standardGrid,
    pixels: Uint8Array,
    c: number,
    s: number,
    x: number,
    y: number,
    z: number,
    hx: number,
    hy: number,
    hz: number,
    color: number,
    crown: boolean,
    sunX: number,
    sunY: number,
    sunZ: number,
  ): void {
    if (hx <= 0 || hy <= 0 || hz <= 0) return;
    const { width, height, columns, elevations } = grid;
    const fine = grid === fineGrid;
    for (let i = 0; i < width; i++) {
      const [sx, sz] = columns[i]!;
      const dx = sx * c - sz * s || 1e-9,
        dz = sx * s + sz * c || 1e-9;
      const x1 = (-hx - x) / dx,
        x2 = (hx - x) / dx,
        z1 = (-hz - z) / dz,
        z2 = (hz - z) / dz;
      const tx = Math.min(x1, x2),
        tz = Math.min(z1, z2);
      const front = Math.max(0.25, tx, tz),
        back = Math.min(Math.max(x1, x2), Math.max(z1, z2));
      if (back <= front) continue;
      const side = tx > tz ? -Math.sign(dx) * sunX : -Math.sign(dz) * sunZ;
      for (let j = 0; j < height; j++) {
        const slope = elevations[j]!,
          lo = (y - hy) / slope,
          hi = (y + hy) / slope;
        let t = Math.max(front, Math.min(lo, hi));
        const at = j * width + i;
        if (t > Math.min(back, Math.max(lo, hi)) || t >= this.depth[at]!) continue;
        let diffuse = t > front ? -Math.sign(slope) * sunY : side;
        if (crown) {
          const ax = dx / hx,
            ay = slope / hy,
            az = dz / hz;
          const ox = x / hx,
            oy = -y / hy,
            oz = z / hz;
          const a = ax * ax + ay * ay + az * az,
            dot = ox * ax + oy * ay + oz * az;
          const disc = dot * dot - a * (ox * ox + oy * oy + oz * oz - 1);
          if (disc < 0) continue;
          t = Math.max(t, (-dot - Math.sqrt(disc)) / a);
          if (t >= this.depth[at]!) continue;
          diffuse = (ox + t * ax) * sunX + (oy + t * ay) * sunY + (oz + t * az) * sunZ;
        }
        this.depth[at] = t;
        const shade = fine ? 0.34 + 0.66 * Math.max(0, Math.min(1, diffuse)) : tx > tz ? 0.76 : 0.94;
        for (let ch = 0; ch < 3; ch++) pixels[4 * at + ch] = captureByte((this.palette[color * 4 + ch]! * shade) / (1 + this.overNext[ch]!));
        pixels[4 * at + 3] = 255;
      }
    }
  }
}
