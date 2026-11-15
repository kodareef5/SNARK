// What the device probe stands in front of the camera, and how it adds load a step at a time: bodies, building pieces,
// rocks near and far, far bases, the terrain map's wood, and texture memory. The probe's server stands the crowd and builds the base
// (tools/device.ts); the rest is added on the page, so that the link does not limit what is measured.

import { LOOK_BYTES } from "../../shared/anim/look.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, type MapDims } from "../../shared/coords.ts";
import { MAX_VIEW } from "../../shared/net/view.ts";
import { Rng } from "../../shared/rng.ts";
import { GEAR_COUNT } from "../../shared/sim/entities.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import type { NodeScatter } from "../../shared/world/mapfile.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Summary, bakeChunk, pieceShapes, type FarCells } from "../../shared/world/tactical.ts";
import type { AssetTable } from "./assets/table.ts";
import { FULL_SCREEN, GL, PROBE_UNITS, compile, framebuffer, saveState, solidBlock, texture2d, type Gl2 } from "./devicegpu.ts";
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

/**
 * The far feed's cells of three bases, as the far blocks' benchmark has them (tools/bench/far.ts, D257): a castle 39 m
 * square with a tower to 48 m, a pile of 2,000 pieces, and ten huts with a tower. Each is built on flat ground in a
 * store of its own and baked as the server bakes a chunk.
 */
export function farBases(reg: Registry): FarCells[] {
  const dims = { chunksX: 3, chunksZ: 1 };
  const hf = new Heightfield(dims, TERRAIN_CELL, 0, 1 / 64);
  const store = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const id = (name: string): number => reg.index.get(`core:${name}`) ?? 0;
  const rng = new Rng(8);
  // The castle on a 3 m lattice: foundations, four floors of walls with a doorway and windows and a cross of inner walls,
  // a ceiling over each, pillars, stairs, and twelve floors more of a tower in one corner (tests/fixtures/farworld.ts).
  const [foundation, wall, ceiling, doorway, window, pillar, stairs, door] = ["foundation_wood", "wall_wood", "ceiling_wood", "doorframe_wood", "windowframe_wood", "pillar_wood", "stairs_wood", "door_wood"].map(id) as number[];
  const put = (kind: number, lx: number, y: number, lz: number, quarter: number): void => void store.add(kind, 32 + lx, y, 32 + lz, (quarter * 16384) & 0xffff, 1, 1000);
  const [N, S, RISE] = [13, 3, 3];
  const half = ((N - 1) / 2) * S;
  const [F, C] = [2 * reg.halfY[foundation!]!, 2 * reg.halfY[ceiling!]!];
  const floorAt = (k: number): number => F + k * RISE;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) put(foundation!, i * S - half, F / 2, j * S - half, 0);
  const ring = (k: number, i0: number, i1: number, j0: number, j1: number, outer: boolean): void => {
    const y = floorAt(k) + RISE / 2;
    for (let i = i0; i <= i1; i++) {
      for (const [j, side] of [[j0 - 0.5, 0], [j1 + 0.5, 2]] as const) {
        const open = outer && k === 0 && i === 6 && side === 2;
        put(open ? doorway! : k > 0 && i % 3 === 1 ? window! : wall!, i * S - half, y, j * S - half, side);
        if (open) put(door!, i * S - half, floorAt(0) + reg.halfY[door!]!, j * S - half, side);
      }
    }
    for (let j = j0; j <= j1; j++) for (const [i, side] of [[i0 - 0.5, 1], [i1 + 0.5, 3]] as const) put(k > 0 && j % 3 === 1 ? window! : wall!, i * S - half, y, j * S - half, side);
  };
  for (let k = 0; k < 4; k++) {
    ring(k, 0, N - 1, 0, N - 1, true);
    for (let t = 1; t < N - 1; t++) {
      put(wall!, 6.5 * S - half, floorAt(k) + RISE / 2, t * S - half, 1);
      put(wall!, t * S - half, floorAt(k) + RISE / 2, 6.5 * S - half, 0);
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) put(ceiling!, i * S - half, floorAt(k + 1) - C / 2, j * S - half, 0);
    for (const [i, j] of [[-0.5, -0.5], [N - 0.5, -0.5], [-0.5, N - 0.5], [N - 0.5, N - 0.5]] as const) put(pillar!, i * S - half, floorAt(k) + RISE / 2, j * S - half, 0);
    put(stairs!, 2 * S - half, floorAt(k) + RISE / 2, 2 * S - half, 0);
  }
  for (let k = 4; k < 16; k++) {
    ring(k, 10, 12, 10, 12, false);
    for (let i = 10; i < N; i++) for (let j = 10; j < N; j++) put(ceiling!, i * S - half, floorAt(k + 1) - C / 2, j * S - half, 0);
  }
  // The pile, in the next chunk: 2,000 pieces of eight kinds on a 3 m lattice, up to four storeys.
  const kinds = ["foundation", "wall", "wall", "ceiling", "ceiling", "pillar", "crate", "block"].map(id);
  for (let n = 0; n < 2000; n++) {
    const kind = kinds[rng.int(kinds.length)]!;
    store.add(kind, 96 + (rng.int(15) - 7) * 3, rng.int(4) * 3.3 + store.halfYOf(kind), 32 + (rng.int(15) - 7) * 3, rng.int(4) * 16384, 1, 1000);
  }
  // The huts, in the last: four wooden foundations and a stone wall each, and four pillars stacked in the middle.
  for (let hut = 0; hut < 10; hut++) {
    const [x, z] = [160 - 30 + rng.int(9) * 6, 32 - 30 + rng.int(9) * 6];
    for (const [dx, dz] of [[1.5, 1.5], [4.5, 1.5], [1.5, 4.5], [4.5, 4.5]] as const) store.add(id("foundation_wood"), x + dx, 0.19, z + dz, 0, 1, 100);
    store.add(id("wall_stone"), x + 1.5, 1.88, z + 3, rng.int(4) * 16384, 1, 100);
  }
  for (let i = 0; i < 4; i++) store.add(id("pillar"), 160, 3.3 + i * 6, 32, 0, 9, 100);
  const shapes = pieceShapes(reg);
  return [0, 1, 2].map((chunk) => {
    const s = new Summary();
    bakeChunk(store.chunks[chunk] ?? null, chunk * CHUNK_SIZE, 0, shapes, hf, s);
    return s.far;
  });
}

/** The far nodes' benchmark's wood (tools/bench/far.ts, D259) as a map's layer: 160 slots a chunk, trees, rocks and bushes 3 to 2 to 1. */
export const WOOD: NodeScatter = { seed: 0xbe7c, perChunk: 160, kinds: [["core:tree", 3], ["core:rock", 2], ["core:bush", 1]], allowCell: 0, allow: null };

/** Chunks of `dims` whose middles are within `reach` of (x, z), less those `skip` says, in a shuffled order of their own. */
export function farSpots(dims: MapDims, x: number, z: number, reach: number, skip: (chunk: number) => boolean): number[] {
  const out: number[] = [];
  for (let cz = 0; cz < dims.chunksZ; cz++) {
    for (let cx = 0; cx < dims.chunksX; cx++) {
      const chunk = cz * dims.chunksX + cx;
      if (Math.hypot((cx + 0.5) * CHUNK_SIZE - x, (cz + 0.5) * CHUNK_SIZE - z) <= reach && !skip(chunk)) out.push(chunk);
    }
  }
  const rng = new Rng(8);
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A tile is a megabyte in every variant: 1,024 pixels square in a compressed one, 512 in RGBA. */
const TILE = 1048576;
/** Tiles sampled a frame, and the side of the target the samples are drawn to: each tile is read at 16 by 16 points across it. */
const TOUCH_TILES = 120;
const TOUCH_SIDE = 16;

/**
 * Texture memory taken a megabyte at a time, in the variant the renderer draws from, on units the renderer does not use.
 * Every tile is one colour, in blocks the variant decodes to it. `grow` adds up to `most` tiles a call, toward `mb`, and
 * says whether the context refused or was lost. `touch`, once a frame, samples the next TOUCH_TILES tiles, a few to a
 * small draw, so a browser that would leave a texture nobody reads off the card cannot here. After the last tile it
 * reads the samples back: the lowest of every tile's must be the colour, or the work was skipped or the memory lost.
 */
export class TextureMemory {
  /** Times every tile has been sampled since the memory was made, and what the last readback said: "right", or what went wrong. */
  sweeps = 0;
  read = "";
  private readonly gl: Gl2;
  private readonly create: () => unknown;
  private readonly tiles: unknown[] = [];
  private readonly internal: number;
  private readonly side: number;
  private readonly fill = new Uint8Array(TILE);
  private readonly colour: number[];
  private next = 0;
  private drawn: { program: unknown; fb: unknown; target: unknown; vao: unknown } | null = null;

  /** `create` makes a texture without the probe counting it among the renderer's. */
  constructor(gl: Gl2, create: () => unknown, variant: string) {
    this.gl = gl;
    this.create = create;
    this.internal = variant === "astc" ? GL.ASTC_4X4 : variant === "bc" ? GL.BPTC : GL.RGBA8;
    this.side = variant === "rgba" ? 512 : 1024;
    const block = solidBlock(variant);
    for (let at = 0; at < TILE; at += block.bytes.length) this.fill.set(block.bytes, at);
    this.colour = block.rgba;
  }

  get mb(): number {
    return this.tiles.length;
  }

  grow(mb: number, most: number): "growing" | "held" | "out of memory" | "context lost" {
    const gl = this.gl;
    if (gl.isContextLost()) return "context lost";
    const unit = gl.getParameter(GL.ACTIVE_TEXTURE) as number;
    gl.activeTexture(GL.TEXTURE0 + 15);
    for (let k = 0; k < most && this.tiles.length < mb; k++) {
      const t = texture2d(gl, this.internal, this.side, this.side, GL.NEAREST, 1, this.create);
      if (this.internal === GL.RGBA8) gl.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, this.side, this.side, GL.RGBA, GL.UNSIGNED_BYTE, this.fill);
      else gl.compressedTexSubImage2D(GL.TEXTURE_2D, 0, 0, 0, this.side, this.side, this.internal, this.fill);
      this.tiles.push(t);
    }
    gl.bindTexture(GL.TEXTURE_2D, null);
    gl.activeTexture(unit);
    const error = gl.getError();
    if (gl.isContextLost()) return "context lost";
    if (error === GL.OUT_OF_MEMORY) return "out of memory";
    return this.tiles.length < mb ? "growing" : "held";
  }

  touch(): void {
    const gl = this.gl;
    if (this.tiles.length === 0 || gl.isContextLost()) return;
    const restore = saveState(gl, 1);
    try {
      try {
        this.drawn ??= this.make();
      } catch (e) {
        this.read = `could not be sampled: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
        return;
      }
      const d = this.drawn;
      gl.bindFramebuffer(GL.FRAMEBUFFER, d.fb);
      gl.viewport(0, 0, TOUCH_SIDE, TOUCH_SIDE);
      for (const cap of [GL.DEPTH_TEST, GL.CULL_FACE, GL.SCISSOR_TEST, GL.SAMPLE_ALPHA_TO_COVERAGE]) gl.disable(cap);
      gl.colorMask(true, true, true, true);
      if (this.next === 0) {
        gl.clearColor(1, 1, 1, 1);
        gl.clear(GL.COLOR_BUFFER_BIT);
      }
      // Each draw keeps the lowest of what it and those before it read.
      gl.enable(GL.BLEND);
      gl.blendEquationSeparate(GL.MIN, GL.MIN);
      gl.useProgram(d.program);
      gl.bindVertexArray(d.vao);
      for (let n = 0; n < TOUCH_TILES && this.next < this.tiles.length; n += PROBE_UNITS.length) {
        PROBE_UNITS.forEach((u, i) => {
          gl.activeTexture(GL.TEXTURE0 + u);
          gl.bindTexture(GL.TEXTURE_2D, this.tiles[Math.min(this.next + i, this.tiles.length - 1)]);
        });
        gl.drawArrays(GL.TRIANGLES, 0, 3);
        this.next += PROBE_UNITS.length;
      }
      if (this.next < this.tiles.length) return;
      const px = new Uint8Array(TOUCH_SIDE * TOUCH_SIDE * 4);
      gl.readPixels(0, 0, TOUCH_SIDE, TOUCH_SIDE, GL.RGBA, GL.UNSIGNED_BYTE, px);
      const off = px.findIndex((v, i) => Math.abs(v - this.colour[i % 4]!) > 3);
      this.read = off < 0 ? "right" : `read back as ${Array.from(px.subarray(off - (off % 4), off - (off % 4) + 4)).join(",")}, not ${this.colour.join(",")}`;
      this.sweeps++;
      this.next = 0;
    } finally {
      restore();
    }
  }

  /** The program that reads a tile on each of PROBE_UNITS, its target and an empty vertex array. */
  private make(): { program: unknown; fb: unknown; target: unknown; vao: unknown } {
    const gl = this.gl;
    const names = PROBE_UNITS.map((_, i) => `t${i}`);
    const program = compile(gl, `#version 300 es
${FULL_SCREEN}
void main() { gl_Position = vec4(corner(), 0.0, 1.0); }`, `#version 300 es
precision highp float;
uniform sampler2D ${names.join(", ")};
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / ${TOUCH_SIDE.toFixed(1)};
  o = texture(t0, uv);
${names.slice(1).map((n) => `  o = min(o, texture(${n}, uv));`).join("\n")}
}`);
    gl.useProgram(program);
    names.forEach((n, i) => gl.uniform1i(gl.getUniformLocation(program, n), PROBE_UNITS[i]!));
    const target = texture2d(gl, GL.RGBA8, TOUCH_SIDE, TOUCH_SIDE, GL.NEAREST, 1, this.create);
    const fb = framebuffer(gl, (f) => gl.framebufferTexture2D(f, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, target, 0), "an RGBA8 texture 16 square");
    return { program, fb, target, vao: gl.createVertexArray() };
  }

  free(): void {
    const gl = this.gl;
    for (const t of this.tiles) gl.deleteTexture(t);
    this.tiles.length = 0;
    if (this.drawn) {
      gl.deleteProgram(this.drawn.program);
      gl.deleteFramebuffer(this.drawn.fb);
      gl.deleteTexture(this.drawn.target);
      gl.deleteVertexArray(this.drawn.vao);
      this.drawn = null;
    }
    [this.next, this.sweeps, this.read] = [0, 0, ""];
  }
}
