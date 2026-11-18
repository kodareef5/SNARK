// What one view of a real city draws, counted, which load cannot move. At each view and tier: the near city's draws, its
// draws into the sun's maps (a caster once for each cascade it is drawn into), its triangles, the far city's draws and
// triangles, and the whole frame's, at noon once nothing is left to make or put on the card. The near store holds the
// 7 by 7 chunks round the camera's whole, as a client's does once the server has sent them (server/game.ts structRadius),
// and the far city draws the rest from the map's statics. Trees, rocks and bushes are left out, and so is a landmark's
// content, as tools/bench/city.ts leaves it. tests/unit/census.slow.test.ts pins the views the Miami slice holds whole
// (tests/fixtures/cityslice.ts), drawn with the grey boxes.
//
//   bun tools/bench/census.ts [file.snmap]         each view on a built map (var/maps/miami.snmap), with the core pack
//   bun tools/bench/census.ts --slice              the slice's views as the test counts them
//   bun tools/bench/census.ts <file.snmap> --cut   the slice cut again from that map

import { readFileSync, writeFileSync } from "node:fs";
import { forTouch, tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { CITY_BUFFER } from "../../client/core/render/farcity.ts";
import { DRAW_RANGED, DRAW_TEXTURED, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { NODE_BUFFERS, Scene } from "../../client/core/render/scene.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, chunkCount, mapSizeX, mapSizeZ } from "../../shared/coords.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { CityStatics } from "../../shared/world/city.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { mapHeightfield, parseMap, type MapData } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { MIAMI_CUT, MIAMI_SLICE, cutSlice, miamiSlice } from "../../tests/fixtures/cityslice.ts";
import { farPack } from "../../tests/fixtures/farworld.ts";
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
 * assets/source/maps/miami/reports/farcity/views.json, over the hand-over and over the whole of downtown.
 */
export const CENSUS_VIEWS: readonly CensusView[] = [
  { name: "street-300", east: -2469, north: -639, up: 1.7, yaw: 1.6083, pitch: 0.02 },
  { name: "roof-300", east: -2467, north: -781, y: 44.3, yaw: 1.0683, pitch: -0.25 },
  { name: "air-300", east: -2469, north: -639, up: 150, yaw: 1.6083, pitch: -0.55 },
  { name: "air-handover", east: -2136, north: -1114, y: 140, yaw: 1.5708, pitch: -0.2978 },
  { name: "air-wide", east: -1836, north: -1564, y: 320, yaw: 1.1903, pitch: -0.2887 },
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
  /** The far city's draws and triangles. */
  far: number;
  farTriangles: number;
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
  const c: Counted = { near: 0, cast: 0, nearTriangles: 0, far: 0, farTriangles: 0, draws: p.drawCount, triangles: p.triangles };
  // Below NODE_BUFFERS a buffer is a chunk's of the near store.
  const near = (buffer: number): boolean => buffer !== TRANSIENT_BUFFER && buffer < NODE_BUFFERS;
  for (let d = 0; d < p.drawCount; d++) {
    const b = p.drawBuffer[d]!;
    if (b === CITY_BUFFER) {
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
  const cam = new Camera();
  /** Holds the chunks round (x, z) whole, each piece put as a client puts the map's, and lets go of the rest. */
  const hold = (x: number, z: number): void => {
    for (const c of [...structs.held]) structs.dropChunk(c);
    held.fill(0);
    const [cx, cz] = [Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)];
    for (let j = Math.max(0, cz - RADIUS); j <= Math.min(dims.chunksZ - 1, cz + RADIUS); j++) {
      for (let i = Math.max(0, cx - RADIUS); i <= Math.min(dims.chunksX - 1, cx + RADIUS); i++) {
        const c = j * dims.chunksX + i;
        const first = statics.first[c]!;
        for (let s = first; s < statics.first[c + 1]!; s++) {
          const k = statics.kind[s]!;
          structs.put(c, s - first, k, statics.x[s]!, statics.y[s]!, statics.z[s]!, statics.yaw[s]!, 0, reg.maxHp[k]!, 1);
        }
        structs.setVersion(c, 1);
        held[c] = 1;
      }
    }
  };
  /** A scene of the world on `setup`, `height` pixels high, that makes what it is asked for in the frame it is asked. */
  const scene = (setup: Setup, height = setup.size[1]): Scene => {
    const s = new Scene({ mapId: map.id, dims, hf, structs, far: { cells: new FarStore(), complete }, city: { statics, complete } }, reg, pack);
    asTextured(s);
    [s.assets.tier, s.viewHeight] = [setup.tier, height];
    s.city!.makeMs = Infinity;
    s.near!.pieces = Infinity;
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
        if (f > 3 && p.uploads.length + p.assetUploads.length + p.texUploads.length === 0 && city.stats.behind === 0 && city.stats.made === 0 && s.near!.stats.waiting === 0) return counted(s, p);
      }
      throw new Error(`${view.name} on ${setup.name}: still making after ${SETTLE} frames`);
    },
  };
}

export type CensusWorld = ReturnType<typeof censusWorld>;

/** Each view on each setup, a section a view; and what the frame leaves out as hidden (render/hide.ts), counted again without. */
export function census(section: Section, record: Row, w: CensusWorld, views: readonly CensusView[], what: string): void {
  const k = (n: number): string => (n / 1000).toFixed(1);
  for (const view of views) {
    const [x, y, z] = placeOf(w.centre, w.hf, view);
    section(`What ${view.name} draws on ${what}, at (${x.toFixed(0)}, ${y.toFixed(1)}, ${z.toFixed(0)}): near city draws, cast, triangles; far city draws, triangles; the frame's; what was hidden`);
    for (const setup of SETUPS) {
      const c = w.count(view, setup);
      const all = w.count(view, setup, (scene) => void (scene.hide = false));
      record(setup.name, c.near, `draws, ${c.cast} cast, ${k(c.nearTriangles)} k; far ${c.far}, ${k(c.farTriangles)} k; frame ${c.draws}, ${k(c.triangles)} k; hidden ${all.draws - c.draws} draws, ${k(all.triangles - c.triangles)} k`);
    }
  }
}

/** The census on a built map, as the game draws it with the core pack. */
export function benchCensus(section: Section, record: Row, path: string): void {
  const map = parseMap(new Uint8Array(readFileSync(path)), false);
  census(section, record, censusWorld(map, centreOf(map), coreRegistry(), parsePack(corePackBytes())), CENSUS_VIEWS, map.id);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const section: Section = (title) => console.log(`\n${title}`);
  const record: Row = (name, value, unit) => console.log(`  ${name.padEnd(16)} ${String(value).padStart(6)} ${unit}`);
  const path = args.find((a) => !a.startsWith("--")) ?? "var/maps/miami.snmap";
  if (args.includes("--slice")) {
    const slice = miamiSlice();
    census(section, record, censusWorld(slice.map, slice.centre, coreRegistry(), farPack()), SLICE_VIEWS, `the Miami slice (${slice.map.statics.length} statics, grey boxes)`);
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
  } else benchCensus(section, record, path);
}
