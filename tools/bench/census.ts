// What one view of a real city draws, counted, which load cannot move. At each view and tier: the near city's draws, its
// draws into the sun's maps (a caster once for each cascade it is drawn into), its triangles, the far city's draws and
// triangles, the city's blocks' past it (render/cityblocks.ts), and the whole frame's, at noon once nothing is left to
// make or put on the card; on a tier that sees past 4 km, the frame's again with its view brought to 4 km. The near store
// holds the 7 by 7 chunks round the camera's whole, as a client's does once the server has sent them (server/game.ts
// structRadius), and the far city draws the rest from the map's statics, its blocks from the map's tops. Trees, rocks
// and bushes are left out, and so is a landmark's content, as tools/bench/city.ts leaves it.
// tests/render/census.slow.test.ts pins the views the Miami slice holds whole (tests/fixtures/cityslice.ts), drawn with the
// grey boxes.
//
//   bun tools/bench/census.ts [file.snmap]         each view on a built map (var/maps/miami.snmap), with the core pack
//        [--views a,b] [--tiers high,ultra]        only those views, and only those setups
//   bun tools/bench/census.ts --slice              the slice's views as the test counts them
//   bun tools/bench/census.ts --slice --reserve    what the slice's near meshes hold and would keep for pieces to leave them
//   bun tools/bench/census.ts --small              the same of the small test city (tests/fixtures/nearclient.ts)
//   bun tools/bench/census.ts <file.snmap> --cut   the slice cut again from that map

import { readFileSync, writeFileSync } from "node:fs";
import { forTouch, tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { HeldTops } from "../../client/core/render/blocks.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { CITY_BUFFER, CITY_SLOTS } from "../../client/core/render/farcity.ts";
import { DRAW_DETAILS, DRAW_RANGED, DRAW_TEXTURED, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { NODE_BUFFERS, Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, chunkCount, mapSizeX, mapSizeZ } from "../../shared/coords.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { CityStatics } from "../../shared/world/city.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { mapHeightfield, parseMap, type MapData } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { MIAMI_CUT, MIAMI_SLICE, cutSlice, miamiSlice } from "../../tests/fixtures/cityslice.ts";
import { farPack } from "../../tests/fixtures/farworld.ts";
import { smallCity } from "../../tests/fixtures/nearclient.ts";
import { corePackBytes } from "../../tests/fixtures/pack.ts";
import { coreRegistry } from "../../tests/fixtures/world.ts";
import { asTextured } from "./base.ts";
import { VIEW } from "./budget.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

/** A place in metres east and north of its map's centre, so that it stays where it is on a map widened round it. */
export interface Place {
  readonly name: string;
  readonly east: number;
  readonly north: number;
  /** Metres over the ground or the sea under it, whichever is higher; or, given `y`, metres over the datum. */
  readonly up?: number;
  readonly y?: number;
}

export interface CensusView extends Place {
  /** As the camera holds them, in radians: yaw 0 looks north and a quarter turn west, pitch is up. */
  readonly yaw: number;
  readonly pitch: number;
}

/** Where `p` stands, in the metres of a world that has its map's centre at `centre`. +X is west and +Z north. */
export function placeOf(centre: readonly [number, number], hf: Heightfield, p: Place): [number, number, number] {
  const [x, z] = [centre[0] - p.east, centre[1] + p.north];
  return [x, p.y ?? Math.max(hf.heightAt(x, z), hf.seaLevel) + (p.up ?? 0), z];
}

/** A whole map's centre in its own metres. */
export const centreOf = (map: MapData): [number, number] => [mapSizeX(map.dims) / 2, mapSizeZ(map.dims) / 2];

/**
 * Downtown Miami: at eye height 300 m into the grid looking west along the street (the GPU bench's street), on a 42 m
 * roof beside it, 150 m over that street, and the far city's two views from the air of
 * assets/source/maps/miami/look/farcity-views.json, over the hand-over and over the whole of downtown. In metres from
 * the 16 km map's centre: on the 8 km map they were 3,328 m further west and 2,368 m further north.
 */
export const CENSUS_VIEWS: readonly CensusView[] = [
  { name: "street-300", east: 859, north: -3007, up: 1.7, yaw: 1.6083, pitch: 0.02 },
  { name: "roof-300", east: 861, north: -3149, y: 44.3, yaw: 1.0683, pitch: -0.25 },
  { name: "air-300", east: 859, north: -3007, up: 150, yaw: 1.6083, pitch: -0.55 },
  { name: "air-handover", east: 1192, north: -3482, y: 140, yaw: 1.5708, pitch: -0.2978 },
  { name: "air-wide", east: 1492, north: -3932, y: 320, yaw: 1.1903, pitch: -0.2887 },
  // Over downtown looking north-west along the city, from 300 m and from 1,000 m, to the end of ultra's view: past the
  // far city's reach the city is blocks.
  { name: "sky-300", east: 859, north: -3007, y: 300, yaw: Math.PI / 4, pitch: -0.12 },
  { name: "sky-1000", east: 859, north: -3007, y: 1000, yaw: Math.PI / 4, pitch: -0.2 },
];
/** The views whose near window the Miami slice holds whole. */
export const SLICE_VIEWS = CENSUS_VIEWS.slice(0, 3);

export interface Setup {
  readonly name: string;
  readonly tier: Tier;
  /** CSS pixels, as the page gives the scene. */
  readonly size: readonly [number, number];
}

const DESKTOP = [1920, 1080] as const;
export const SETUPS: readonly Setup[] = [
  { name: "lowpoly", tier: tierOf("lowpoly"), size: DESKTOP },
  { name: "medium, touch", tier: forTouch(tierOf("medium"), true), size: [VIEW[0], VIEW[1]] },
  { name: "medium", tier: tierOf("medium"), size: DESKTOP },
  { name: "high", tier: tierOf("high"), size: DESKTOP },
  { name: "ultra", tier: tierOf("ultra"), size: DESKTOP },
];

export interface Counted {
  /** The near city's draws, its draws into the sun's maps, and its triangles. */
  near: number;
  cast: number;
  nearTriangles: number;
  /** The far city's draws and triangles, and the city's blocks'. */
  far: number;
  farTriangles: number;
  blocks: number;
  blockTriangles: number;
  /** The whole frame's, the ground's among them. */
  draws: number;
  triangles: number;
}

/** Chunks either side of the camera's that a client holds whole (server/game.ts structRadius). */
const RADIUS = 3;
/** Frames a view may take to have nothing left to make. */
const SETTLE = 240;

function counted(scene: Scene, p: FramePacket): Counted {
  const tris = scene.assets.table.tris;
  const c: Counted = { near: 0, cast: 0, nearTriangles: 0, far: 0, farTriangles: 0, blocks: 0, blockTriangles: 0, draws: p.drawCount, triangles: p.triangles };
  // Below NODE_BUFFERS a buffer is a chunk's of the near store.
  const near = (buffer: number): boolean => buffer !== TRANSIENT_BUFFER && buffer < NODE_BUFFERS;
  for (let d = 0; d < p.drawCount; d++) {
    // Detail cards use their own instance data and leave the draw buffer at zero.
    if ((p.drawFlags[d]! & DRAW_DETAILS) !== 0) continue;
    const b = p.drawBuffer[d]!;
    if (b === CITY_BUFFER && p.drawSlot[d]! < CITY_SLOTS) {
      c.blocks++;
      c.blockTriangles += p.drawIndexCount[d]! / 3;
    } else if (b === CITY_BUFFER) {
      c.far++;
      c.farTriangles += p.drawIndexCount[d]! / 3;
    } else if (near(b)) {
      c.near++;
      c.nearTriangles += ((p.drawFlags[d]! & (DRAW_TEXTURED | DRAW_RANGED)) !== 0 ? p.drawIndexCount[d]! / 3 : tris[p.drawMesh[d]!]![p.drawLod[d]!]!) * p.drawInstances[d]!;
    }
  }
  for (let e = 0; e < p.casterCount; e++) if (near(p.casterBuffer[e]!)) for (let m = p.casterCascades[e]!; m > 0; m >>= 1) c.cast += m & 1;
  return c;
}

/** A client's world on `map`, which has the centre of the map its views are given on at `centre`. */
export function censusWorld(map: MapData, centre: readonly [number, number], reg: Registry, pack: Pack) {
  const { dims } = map;
  const hf = mapHeightfield(map);
  const statics = new CityStatics(dims, map.statics, reg);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const held = new Uint8Array(chunkCount(dims));
  const complete = (c: number): boolean => held[c] === 1;
  const tops = new HeldTops(dims);
  if (map.tops) tops.take(map.tops);
  const cam = new Camera();
  /** Holds the chunks round (x, z) whole, each piece put as a client puts the map's, and lets go of the rest. */
  const hold = (x: number, z: number): void => {
    for (const c of [...structs.held]) structs.dropChunk(c);
    held.fill(0);
    const [cx, cz] = [Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)];
    for (let j = Math.max(0, cz - RADIUS); j <= Math.min(dims.chunksZ - 1, cz + RADIUS); j++) {
      for (let i = Math.max(0, cx - RADIUS); i <= Math.min(dims.chunksX - 1, cx + RADIUS); i++) {
        const c = j * dims.chunksX + i;
        const t = statics.rows(c), first = t?.from(c) ?? 0;
        for (let s = first; t && s < t.to(c); s++) {
          const k = t.kind[s]!;
          structs.put(c, s - first, k, t.x[s]!, t.y[s]!, t.z[s]!, t.yaw[s]!, 0, reg.maxHp[k]!, 1);
        }
        structs.setVersion(c, 1);
        held[c] = 1;
      }
    }
  };
  /** A scene of the world on `setup`, `height` pixels high, that makes what it is asked for in the frame it is asked. */
  const scene = (setup: Setup, height = setup.size[1]): Scene => {
    const s = new Scene({ mapId: map.id, dims, hf, structs, far: { cells: new FarStore(), complete }, city: { statics, complete }, ...(map.tops ? { tops: { tops } } : {}) }, reg, pack);
    asTextured(s);
    [s.assets.tier, s.viewHeight] = [setup.tier, height];
    s.city!.makeMs = Infinity;
    s.near!.pieces = Infinity;
    if (s.blocks) s.blocks.here = Infinity;
    return s;
  };
  return {
    map, hf, statics, centre, hold, scene, pack,
    /** What `view` draws on `setup`, in a scene of its own that `set` may change, once nothing is left to make or put on the card. */
    count(view: CensusView, setup: Setup, set?: (scene: Scene) => void): Counted {
      [cam.x, cam.y, cam.z] = placeOf(centre, hf, view);
      [cam.yaw, cam.pitch, cam.aspect] = [view.yaw, view.pitch, setup.size[0] / setup.size[1]];
      hold(cam.x, cam.z);
      const s = scene(setup);
      const city = s.city!;
      set?.(s);
      for (let f = 0; f < SETTLE; f++) {
        s.now += 1000 / 60;
        const p = s.build(cam, null);
        if (f > 3 && p.uploads.length + p.assetUploads.length + p.texUploads.length === 0 && city.stats.behind === 0 && city.stats.made === 0 && s.near!.stats.waiting === 0 && (s.blocks?.stats.made ?? 0) === 0) return counted(s, p);
      }
      throw new Error(`${view.name} on ${setup.name}: still making after ${SETTLE} frames`);
    },
  };
}

export type CensusWorld = ReturnType<typeof censusWorld>;

/**
 * Each view on each setup, a section a view; what the frame leaves out as hidden (render/hide.ts), counted again without;
 * and on a tier that sees past 4 km, the frame with its view brought to 4 km.
 */
export function census(section: Section, record: Row, w: CensusWorld, views: readonly CensusView[], what: string, setups: readonly Setup[] = SETUPS): void {
  const k = (n: number): string => (n / 1000).toFixed(1);
  for (const view of views) {
    const [x, y, z] = placeOf(w.centre, w.hf, view);
    section(`What ${view.name} draws on ${what}, at (${x.toFixed(0)}, ${y.toFixed(1)}, ${z.toFixed(0)}): near city draws, cast, triangles; far city draws, triangles; blocks draws, triangles; the frame's; what was hidden; the frame's at 4 km`);
    for (const setup of setups) {
      const c = w.count(view, setup);
      const all = w.count(view, setup, (scene) => void (scene.hide = false));
      const short = setup.tier.viewDistance > 4000 ? w.count(view, setup, (scene) => void (scene.viewDistance = 4000)) : null;
      record(setup.name, c.near, `draws, ${c.cast} cast, ${k(c.nearTriangles)} k; far ${c.far}, ${k(c.farTriangles)} k; blocks ${c.blocks}, ${k(c.blockTriangles)} k; frame ${c.draws}, ${k(c.triangles)} k; hidden ${all.draws - c.draws} draws, ${k(all.triangles - c.triangles)} k${short ? `; at 4 km ${short.draws}, ${k(short.triangles)} k, blocks ${short.blocks}, ${k(short.blockTriangles)} k` : ""}`);
    }
  }
}

/** Bytes a vertex of a near mesh took before each face carried its piece and its holder, a byte more where a chunk wore a material made from a recipe. */
const PLAIN_VERTEX = 8;

/**
 * What the near meshes of `w`'s chunks hold for a piece to leave one without a remake (render/nearcity.ts): of the
 * busiest chunk, of the one that grew most and over them all, the faces shown, those of merged boxes, the merged boxes and
 * their pieces, the faces kept that another piece hid and that a merged box's members would show, and the bytes on the
 * card against those of the faces shown alone, as they were before.
 */
export function reserve(section: Section, record: Row, w: CensusWorld, what: string): void {
  const near = w.scene(SETUPS[3]!).near!;
  const { dims } = w.map;
  const sum = { pieces: 0, shown: 0, merged: 0, groups: 0, members: 0, hidden: 0, fallback: 0, own: 0, buried: 0, bytes: 0 };
  type Counts = ReturnType<typeof near.census>;
  let busiest: (Counts & { chunk: number }) | null = null, worst: (Counts & { chunk: number }) | null = null;
  const before = (c: Pick<Counts, "shown">): number => c.shown * 4 * PLAIN_VERTEX;
  for (let chunk = 0; chunk < chunkCount(dims); chunk++) {
    if (w.statics.in(chunk) === 0) continue;
    const c = near.census(w.statics, chunk, w.hf, 4);
    for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += c[k];
    if (!busiest || c.bytes > busiest.bytes) busiest = { ...c, chunk };
    if (before(c) > 100_000 && (!worst || c.bytes / before(c) > worst.bytes / before(worst))) worst = { ...c, chunk };
  }
  const rows = (name: string, c: Counts): void => {
    const faces = c.shown + c.hidden + c.fallback;
    record(`${name}: pieces in the mesh`, c.pieces, "");
    record(`${name}: faces shown`, c.shown, `(${c.shown * 4} vertices), ${c.merged} of them a merged box's`);
    record(`${name}: merged boxes`, c.groups, `of ${c.members} pieces, ${(c.members / Math.max(1, c.groups)).toFixed(1)} a box`);
    record(`${name}: faces kept that another piece hid`, c.hidden, `; ${c.own} its own piece hid and ${c.buried} the ground, never kept`);
    record(`${name}: faces kept that a merged box's members would show`, c.fallback, "");
    record(`${name}: bytes of the faces shown alone, ${PLAIN_VERTEX} a vertex, as before`, before(c), "");
    record(`${name}: bytes on the card`, c.bytes, `(${faces * 4} vertices at ${c.bytes / (faces * 4)}), ${(c.bytes / before(c)).toFixed(2)} times those`);
  };
  section(`What the near meshes of ${what} hold, and keep for a piece to leave one without a remake`);
  if (busiest) rows(`busiest chunk ${busiest.chunk}`, busiest);
  if (worst && worst.chunk !== busiest?.chunk) rows(`chunk ${worst.chunk}, which grew most`, worst);
  rows("every chunk", sum);
}

/** The census on a built map, as the game draws it with the core pack: `views` and `setups` by name, every one if not given. */
export function benchCensus(section: Section, record: Row, path: string, views?: readonly string[], named?: readonly string[]): void {
  const map = parseMap(new Uint8Array(readFileSync(path)), false);
  const setups = SETUPS.filter((s) => !named || named.includes(s.name));
  census(section, record, censusWorld(map, centreOf(map), coreRegistry(), parsePack(corePackBytes())), CENSUS_VIEWS.filter((v) => !views || views.includes(v.name)), map.id, setups);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const section: Section = (title) => console.log(`\n${title}`);
  const record: Row = (name, value, unit) => console.log(`  ${name.padEnd(16)} ${String(value).padStart(6)} ${unit}`);
  const listed = (flag: string): string[] | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1]!.split(",") : undefined);
  const path = args.find((a, i) => !a.startsWith("--") && !["--views", "--tiers"].includes(args[i - 1] ?? "")) ?? "var/maps/miami.snmap";
  if (args.includes("--slice")) {
    const slice = miamiSlice();
    const world = censusWorld(slice.map, slice.centre, coreRegistry(), farPack());
    if (args.includes("--reserve")) reserve(section, record, world, `the Miami slice (${slice.map.statics.length} statics)`);
    else census(section, record, world, SLICE_VIEWS, `the Miami slice (${slice.map.statics.length} statics, grey boxes)`);
  } else if (args.includes("--small")) {
    const map = smallCity();
    reserve(section, record, censusWorld(map, centreOf(map), coreRegistry(), farPack()), `the small test city (${map.statics.length} statics)`);
  } else if (args.includes("--cut")) {
    const map = parseMap(new Uint8Array(readFileSync(path)), false);
    const reg = coreRegistry();
    const structure = (id: string): boolean => {
      const k = reg.index.get(id);
      return k !== undefined && reg.defs[k]?.type === "structure";
    };
    const bytes = cutSlice(map, MIAMI_CUT.cx, MIAMI_CUT.cz, MIAMI_CUT.side, structure);
    writeFileSync(MIAMI_SLICE, bytes);
    console.log(`${MIAMI_SLICE}: ${bytes.length} bytes`);
  } else benchCensus(section, record, path, listed("--views"), listed("--tiers"));
}
