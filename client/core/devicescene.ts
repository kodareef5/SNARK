// What the device probe stands in front of the camera, and how it adds load a step at a time: bodies, building pieces,
// rocks near and far, and texture memory. The probe's server stands the crowd and builds the base (tools/device.ts);
// the rest is added on the page, so that the link does not limit what is measured.

import { LOOK_BYTES } from "../../shared/anim/look.ts";
import { MAX_VIEW } from "../../shared/net/view.ts";
import { GEAR_COUNT } from "../../shared/sim/entities.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import type { AssetTable } from "./assets/table.ts";
import type { Thing } from "./render/scene.ts";
import type { RemoteSample } from "./session.ts";

/** A bit of the replicated entity flags: a prop, which is not a body. As in app.ts. */
const VIEW_FLAG_PROP = 8;
/** Half the width of what every scene is laid out in, in radians: a portrait phone shows about 18 degrees each side. */
const HALF_WEDGE = 0.28;

/** Where the camera looks for each load: yaw 0 faces +Z, and a quarter turn faces +X. */
export const LOOK = { bodies: Math.PI / 2, pieces: -Math.PI / 2, rocks: 0, crowd: Math.PI };

/**
 * What tools/device.ts stands behind the spawn point, where the crowd scene looks and the others do not. Near, a floor of
 * thatch with a wall down each side: thatch has materials, and only a piece's finest level has them, so it must be near
 * to be drawn with them. Past it, bodies in rows that widen with distance, so a narrow screen has them all in view. A
 * piece's `y` is its height over the ground at `floor`.
 */
export function crowdScene(): { bodies: { species: string; x: number; z: number }[]; floor: { x: number; z: number }; pieces: { id: string; x: number; y: number; z: number; yaw: number }[] } {
  const species = ["core:survivor", "core:parasaur", "core:raptor", "core:grazer"];
  const bodies: { species: string; x: number; z: number }[] = [];
  [4, 6, 8, 8, 10, 12].forEach((n, row) => {
    const d = 17 + row * 6;
    const half = d * 0.28;
    for (let i = 0; i < n; i++) bodies.push({ species: species[bodies.length % species.length]!, x: PROVING_SPAWN.x - half + (2 * half * (i + 0.5)) / n, z: PROVING_SPAWN.z - d });
  });
  const floor = { x: PROVING_SPAWN.x, z: PROVING_SPAWN.z - 11 };
  const pieces: { id: string; x: number; y: number; z: number; yaw: number }[] = [];
  for (const a of [-1.5, 1.5]) {
    for (const b of [-1.5, 1.5]) pieces.push({ id: "core:foundation_thatch", x: floor.x + a, y: 0.1875, z: floor.z + b, yaw: 0 });
    pieces.push({ id: "core:wall_thatch", x: floor.x - 3, y: 1.875, z: floor.z + a, yaw: 16384 }, { id: "core:wall_thatch", x: floor.x + 3, y: 1.875, z: floor.z + a, yaw: 16384 });
  }
  return { bodies, floor, pieces };
}

/** Building pieces the base has room for: 256 houses, the furthest about 170 m off. */
export const BASE_MOST = 4096;

/**
 * The base the probe's server builds toward -X, nearest first: houses of sixteen pieces on a 7.5 m grid, stone and wood
 * by turns, each four foundations, walls round them with a doorway facing the viewer, and a roof, as
 * tests/fixtures/world.ts lays a room. The first `n` pieces; a piece's `y` is its height over the ground at its house.
 */
export function basePieces(n: number): { id: string; x: number; y: number; z: number; yaw: number; house: { x: number; z: number } }[] {
  const homes: { x: number; z: number; d: number }[] = [];
  for (let i = 1; i < 40; i++) {
    for (let j = -30; j <= 30; j++) {
      const [ahead, side] = [5 + i * 7.5, j * 7.5];
      if (Math.abs(side) - 4 <= Math.tan(HALF_WEDGE) * ahead) homes.push({ x: PROVING_SPAWN.x - ahead, z: PROVING_SPAWN.z + side, d: Math.hypot(ahead, side) });
    }
  }
  homes.sort((a, b) => a.d - b.d);
  const out: ReturnType<typeof basePieces> = [];
  const Q = 16384;
  for (let h = 0; out.length < n && h < homes.length; h++) {
    const house = homes[h]!;
    const tier = h % 2 === 0 ? "stone" : "wood";
    const [cx, cz] = [house.x, house.z];
    const add = (part: string, x: number, y: number, z: number, yaw: number): void => void (out.length < n && out.push({ id: `core:${part}_${tier}`, x, y, z, yaw, house }));
    for (const a of [-1.5, 1.5]) for (const b of [-1.5, 1.5]) add("foundation", cx + a, 0.1875, cz + b, 0);
    for (const o of [-1.5, 1.5]) {
      // The doorway is on the side that faces the spawn point, which is +X.
      add(o < 0 ? "doorframe" : "wall", cx + 3, 1.875, cz + o, Q);
      add("wall", cx - 3, 1.875, cz + o, Q);
      add("wall", cx + o, 1.875, cz - 3, 0);
      add("wall", cx + o, 1.875, cz + 3, 0);
    }
    for (const a of [-1.5, 1.5]) for (const b of [-1.5, 1.5]) add("ceiling", cx + a, 3.5, cz + b, 0);
  }
  return out;
}

/** Where `n` added bodies stand toward +X, in rows a body and a half apart that widen with distance, nearest first. */
export function bodySpots(n: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let d = 6; out.length < n; d += 1.6) {
    const across = Math.max(1, Math.floor((2 * Math.tan(HALF_WEDGE) * d) / 1.6));
    for (let k = 0; k < across && out.length < n; k++) out.push({ x: PROVING_SPAWN.x + d, z: PROVING_SPAWN.z + (k - (across - 1) / 2) * 1.6 });
  }
  return out;
}

/**
 * Rocks of the stress pack hanging in front of the camera, toward +Z, each a draw of its own: `near` from 6 m out, so each
 * is drawn at a fine level and they add triangles; `far` from 140 m out, where each is drawn at its coarsest and they add
 * draws and little else. Spread over the view by the golden angle.
 */
export function rocks(table: AssetTable, hf: Heightfield, near: number, far: number): Thing[] {
  const meshes: number[] = [];
  for (let i = 0; ; i++) {
    const mesh = table.find(`stress:rock_${String(i).padStart(2, "0")}`);
    if (mesh < 0) break;
    meshes.push(mesh);
  }
  if (meshes.length === 0) return [];
  const eye = hf.heightAt(PROVING_SPAWN.x, PROVING_SPAWN.z) + 1.62;
  const out: Thing[] = [];
  const place = (i: number, d: number, rise: number): void => {
    // The golden angle spreads them evenly across the view and up it.
    const across = ((((i * 0.618034) % 1) * 2 - 1) * HALF_WEDGE) * 0.9;
    const up = (((i * 0.754878) % 1) * 2 - 1) * 0.18 + rise;
    out.push({ mesh: meshes[i % meshes.length]!, x: PROVING_SPAWN.x + Math.sin(across) * d, y: eye + Math.sin(up) * d - 1, z: PROVING_SPAWN.z + Math.cos(across) * d, level: -1 });
  };
  for (let i = 0; i < near; i++) place(i, 6 + 0.05 * i, 0.12);
  for (let i = 0; i < far; i++) place(i, 140 + 0.02 * i, 0.3);
  return out;
}

/**
 * Bodies added after the session has sampled its own: copies of those it has, each standing at one of `bodySpots`, posed
 * and coloured as its original. Every scene and system that reads the sample reads them too, as it would a crowd that
 * came over the link, but nothing of them crosses the link. `n` is how many are wanted.
 */
export class BodyCopies {
  n = 0;
  private readonly spots = bodySpots(MAX_VIEW);
  private readonly hf: Heightfield;

  constructor(session: { sampleRemote(out: RemoteSample, delayTicks?: number): void }, hf: Heightfield) {
    this.hf = hf;
    const sample = session.sampleRemote.bind(session);
    session.sampleRemote = (out, delayTicks) => {
      sample(out, delayTicks);
      this.add(out);
    };
  }

  private add(out: RemoteSample): void {
    const real = out.count;
    const bodies: number[] = [];
    for (let i = 0; i < real; i++) if ((out.flags[i]! & VIEW_FLAG_PROP) === 0) bodies.push(i);
    const room = Math.min(this.n, MAX_VIEW - real);
    if (bodies.length === 0) return;
    for (let i = 0; i < room; i++) {
      const from = bodies[i % bodies.length]!;
      const to = out.count++;
      const spot = this.spots[i]!;
      out.id[to] = 0x40000000 + i;
      out.kind[to] = out.kind[from]!;
      out.flags[to] = out.flags[from]!;
      out.level[to] = out.level[from]!;
      out.name[to] = "";
      out.x[to] = spot.x;
      out.z[to] = spot.z;
      out.y[to] = Math.max(this.hf.heightAt(spot.x, spot.z), this.hf.seaLevel);
      out.yaw[to] = (i * 2.399963) % (2 * Math.PI);
      out.anim[to] = out.anim[from]!;
      out.colors.copyWithin(to * 6, from * 6, from * 6 + 6);
      out.hasLook[to] = out.hasLook[from]!;
      out.look.copyWithin(to * LOOK_BYTES, from * LOOK_BYTES, (from + 1) * LOOK_BYTES);
      out.gear.copyWithin(to * GEAR_COUNT, from * GEAR_COUNT, (from + 1) * GEAR_COUNT);
      out.team[to] = out.seat[to] = out.span[to] = out.grown[to] = 0;
    }
  }
}

/** What TextureMemory asks of a WebGL 2 context. The numbers are WebGL's own. */
export interface GlMemory {
  createTexture(): unknown;
  deleteTexture(texture: unknown): void;
  bindTexture(target: number, texture: unknown): void;
  activeTexture(unit: number): void;
  texStorage2D(target: number, levels: number, internal: number, width: number, height: number): void;
  compressedTexSubImage2D(target: number, level: number, x: number, y: number, width: number, height: number, format: number, data: ArrayBufferView): void;
  texSubImage2D(target: number, level: number, x: number, y: number, width: number, height: number, format: number, type: number, data: ArrayBufferView | null): void;
  getError(): number;
  isContextLost(): boolean;
  getParameter(name: number): unknown;
}
const GL = { TEXTURE_2D: 0x0de1, TEXTURE15: 0x84cf, ACTIVE_TEXTURE: 0x84e0, RGBA: 0x1908, RGBA8: 0x8058, UNSIGNED_BYTE: 0x1401, ASTC_4X4: 0x93b0, BPTC: 0x8e8c, OUT_OF_MEMORY: 0x0505, NO_ERROR: 0 };
/** A tile is a megabyte in every variant: 1,024 pixels square in a compressed one, 512 in RGBA. */
const TILE = 1048576;

/**
 * Texture memory taken a megabyte at a time, in the variant the renderer draws from, on a unit the renderer does not use.
 * Each tile is filled, so its memory is the device's to find. `grow` adds up to `most` tiles a call, toward `mb`, and says
 * whether the context refused or was lost.
 */
export class TextureMemory {
  private readonly gl: GlMemory;
  private readonly create: () => unknown;
  private readonly tiles: unknown[] = [];
  private readonly internal: number;
  private readonly side: number;
  private readonly zeros = new Uint8Array(TILE);

  /** `create` makes a texture without the probe counting it among the renderer's. */
  constructor(gl: GlMemory, create: () => unknown, variant: string) {
    this.gl = gl;
    this.create = create;
    this.internal = variant === "astc" ? GL.ASTC_4X4 : variant === "bc" ? GL.BPTC : GL.RGBA8;
    this.side = variant === "rgba" ? 512 : 1024;
  }

  get mb(): number {
    return this.tiles.length;
  }

  grow(mb: number, most: number): "growing" | "held" | "out of memory" | "context lost" {
    const gl = this.gl;
    if (gl.isContextLost()) return "context lost";
    const unit = gl.getParameter(GL.ACTIVE_TEXTURE) as number;
    gl.activeTexture(GL.TEXTURE15);
    for (let k = 0; k < most && this.tiles.length < mb; k++) {
      const t = this.create();
      gl.bindTexture(GL.TEXTURE_2D, t);
      gl.texStorage2D(GL.TEXTURE_2D, 1, this.internal, this.side, this.side);
      if (this.internal === GL.RGBA8) gl.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, this.side, this.side, GL.RGBA, GL.UNSIGNED_BYTE, this.zeros);
      else gl.compressedTexSubImage2D(GL.TEXTURE_2D, 0, 0, 0, this.side, this.side, this.internal, this.zeros);
      this.tiles.push(t);
    }
    gl.bindTexture(GL.TEXTURE_2D, null);
    gl.activeTexture(unit);
    const error = gl.getError();
    if (gl.isContextLost()) return "context lost";
    if (error === GL.OUT_OF_MEMORY) return "out of memory";
    return this.tiles.length < mb ? "growing" : "held";
  }

  free(): void {
    for (const t of this.tiles) this.gl.deleteTexture(t);
    this.tiles.length = 0;
  }
}
