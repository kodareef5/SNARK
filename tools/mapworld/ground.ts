import type { EyeColor, TideEyeSite } from "../../shared/world/tide-eye.ts";
// The ground of a map from its base layers: the land of the elevation model, the bed of the coastal model under the water
// the shoreline survey marks, water passages under mapped bridges, authored broken spans and drowned streets.
// Footprints reserve the city floor; statics supply its ruins. Heights are metres above the sea.

import { BEACH_LAND, BEACH_SEA, shapeBeach } from "./beach.ts";
import { existsSync, readFileSync } from "node:fs";
import { GROUND_CLASS } from "../../shared/world/vehicle-surface.ts";
import { join } from "node:path";
import { cutBridgeWater, pathsOf, readWays } from "./ways.ts";
import type { Base, Grid } from "./base.ts";
import { makeHeaps, readBuildings, PART_COURT, PART_FLOOR, PART_HEAP, PART_POOL, PART_SPILL, PART_WALL, type Heaps } from "./heaps.ts";
import { carveLakes, readLakes, type LakeRules, type Lakes } from "./lakes.ts";
import { blur, distanceField, fbm, fillPolygon, hash3, regions, share } from "./raster.ts";

/** What a sample's ground is, for its colour and for what lives on it. */
import type { LandmarkSite } from "./landmarks.ts";

export const S = {
  CHANNEL: 1,
  DEEP: 2,
  FLAT: 3,
  SHALLOW: 4,
  POOL: 5,
  WET_SAND: 6,
  BEACH: 7,
  DUNE: 8,
  HIGHWAY: 9,
  STREET: 10,
  DECK: 11,
  FORD: 12,
  HEAP: 13,
  SPILL: 14,
  WALL: 15,
  FLOOR: 16,
  COURT: 17,
  OPEN: 18,
  GREEN: 19,
  CANOPY: 20,
  MANGROVE: 21,
  MARSH: 22,
  WRECK: 23,
  YARD: 24,
  CONTAINER: 25,
  /** Dry ground that grows no green: desert pavement and scrub, where a city's succession names its land cover dry. */
  DESERT: 26,
  /** An airfield's runways, taxiways and aprons (roads.png value 6): paved, and no street. */
  PAVED: 27,
  /** Where people walk beside a street (use.png, tools/mapdata/streets.py): kerb to the building line. */
  SIDEWALK: 28,
  /** A street where people cross it: still a street to anything driven. */
  CROSSWALK: 29,
  /** A footway, path, cycleway or steps away from a street. */
  WALKWAY: 30,
  /** A square or a pedestrian street drawn as an area. */
  PLAZA: 31,
  /** A parking lot's ground off its aisles, where its stalls are. */
  LOT: 32,
} as const;

/** What use.png's values say the ground is used for (tools/mapdata/streets.py, USE). */
const USE = { SIDEWALK: 1, CROSSING: 2, PATH: 3, PLAZA: 4, LOT: 5, PARK: 6, PITCH: 7 } as const;

export interface District {
  readonly name: string;
  readonly style: string;
  readonly tall: number;
  readonly ring: readonly (readonly [number, number])[];
}

export interface World {
  readonly bridgeGapLayer?: string;
  readonly containerDistrict?: string;
  readonly ruins?: { report: string; yardDistricts: string[] };
  readonly id: string;
  readonly label: string;
  /** False for a frame with no sea: the map file then has no water, and heights are still over seaNavd88. */
  readonly sea?: boolean;
  readonly seaNavd88: number;
  readonly minY: number;
  readonly stepY: number;
  readonly districts: readonly District[];
  readonly spawns: readonly { name: string; at: [number, number]; face: [number, number]; ground: "sand" | "open" }[];
  /** Where survivors leave for another server: each obelisk near a place, its terminal turned toward another (places.ts). */
  readonly obelisks?: readonly { name: string; color?: EyeColor; form?: TideEyeSite["form"]; at: [number, number]; face: [number, number] }[];
  /** Metres round a spawn point with no beach region in reach within which the jungle's regions take the beach's table. */
  readonly easyAroundSpawns?: number;
  /** A dry city: its open ground and courts are tinted gravel and dust, its weeds dry (a desert's). */
  readonly dryGround?: boolean;
  /** Whether each footprint is raised into a heap of rubble (heaps.ts), the stand-in for block ruins. On unless false. */
  readonly heaps?: boolean;
  readonly containerHeaps?: boolean;
  /** How the perched lakes are made water standing above the sea (lakes.ts); false leaves them marsh. */
  readonly lakes?: LakeRules | false;
  /** The landmarks it places (tools/mapworld/landmarks.ts). */
  readonly landmarks?: readonly LandmarkSite[];
  /** Sectors of room it leaves to grow into north and west: its display origin is that far past the default. */
  readonly room?: { readonly north?: number; readonly west?: number };
}

export interface Ground {
  readonly grid: Grid;
  readonly height: Float32Array;
  readonly surface: Uint8Array;
  /** Per sample, its district counting from 1 in the world's list, or 0. */
  readonly district: Uint16Array;
  readonly heaps: Heaps;
  /** Metres from each land sample to the water, and from each water sample to the land. */
  readonly shore: Float32Array;
  /** Marine samples in the sandy swash zone, kept sparse until the tint is baked. */
  readonly beachBed?: ReadonlySet<number>;
  /** Per sample of a container stack, which container it is, for its colour. */
  readonly container: Uint8Array;
  /** Metres from each sample to the nearest real beach. */
  readonly sand: Float32Array;
  /** The sea's water, 1 a sample. Lakes are in `lakes`. */
  readonly water: Uint8Array;
  readonly gaps: Uint8Array;
  readonly bridges: { standing: number; fords: number; gaps: number; cutSamples: number };
  /** Water standing above the sea, or null where the map has none. */
  readonly lakes: Lakes | null;
}

/** What each surface is to a wheel (shared/world/vehicle-surface.ts GROUND_CLASS); a surface not named is plain ground. */
const CLASS_OF: Readonly<Record<number, number>> = {
  [S.STREET]: GROUND_CLASS.ASPHALT, [S.HIGHWAY]: GROUND_CLASS.ASPHALT, [S.CROSSWALK]: GROUND_CLASS.ASPHALT, [S.LOT]: GROUND_CLASS.ASPHALT, [S.PAVED]: GROUND_CLASS.ASPHALT,
  [S.SIDEWALK]: GROUND_CLASS.PAVING, [S.PLAZA]: GROUND_CLASS.PAVING, [S.DECK]: GROUND_CLASS.PAVING, [S.COURT]: GROUND_CLASS.PAVING, [S.FLOOR]: GROUND_CLASS.PAVING,
  [S.WALKWAY]: GROUND_CLASS.GRAVEL, [S.YARD]: GROUND_CLASS.GRAVEL, [S.DESERT]: GROUND_CLASS.GRAVEL, [S.SPILL]: GROUND_CLASS.GRAVEL,
  [S.BEACH]: GROUND_CLASS.SAND, [S.DUNE]: GROUND_CLASS.SAND, [S.WET_SAND]: GROUND_CLASS.SAND,
  [S.POOL]: GROUND_CLASS.MUD, [S.MARSH]: GROUND_CLASS.MUD, [S.MANGROVE]: GROUND_CLASS.MUD, [S.FORD]: GROUND_CLASS.MUD, [S.FLAT]: GROUND_CLASS.MUD,
};

/**
 * The ground's class each two samples a side, from every even sample's surface, in the samples' own order: what the
 * map file's ground parts carry for a wheel (MapData.ground). A street is two samples wide or more, so a cell of 4 m
 * holds its class where it lies.
 */
export function groundClasses(g: Ground): Uint8Array {
  const { nx, nz } = g.grid;
  const gx = (nx + 1) >> 1;
  const out = new Uint8Array(gx * ((nz + 1) >> 1));
  for (let r = 0; r < nz; r += 2) for (let c = 0; c < nx; c += 2) out[(r >> 1) * gx + (c >> 1)] = CLASS_OF[g.surface[r * nx + c]!] ?? GROUND_CLASS.GROUND;
  return out;
}

export function makeGround(base: Base, world: World, log: (line: string) => void): Ground {
  const { grid } = base;
  const { nx, nz, cell, west, north } = grid;
  const N = nx * nz;
  const sea = world.seaNavd88;
  const water = base.bytes("water");
  const roads = base.bytes("roads");
  const biome = base.bytes("biome");
  const canopy = base.bytes("painted_canopy");
  const flooded = base.bytes("flooded_streets");
  const gaps = world.bridgeGapLayer ? base.bytes(world.bridgeGapLayer) : new Uint8Array(N);
  const wrecks = base.bytes("wrecks");
  // A folder made before the streets stage has no use.png: its ground is as it was.
  const use = existsSync(join(base.folder, "base", "use.png")) ? base.bytes("use") : new Uint8Array(N);
  const dem = base.elevation();
  const model = base.bathymetry();
  const bathy = model ? blur(model, nx, nz, 2, 3) : null;
  const height = new Float32Array(N);
  const surface = new Uint8Array(N);

  // Distances across the shoreline, and for water which land is nearest.
  const nearLand = new Int32Array(N);
  const toLand = distanceField((i) => water[i] === 0, nx, nz, nearLand);
  const toWater = distanceField((i) => water[i] === 1, nx, nz);
  const shore = new Float32Array(N);
  for (let i = 0; i < N; i++) shore[i] = Math.sqrt(water[i] ? toLand[i]! : toWater[i]!) * cell;
  // How much of the ground round each sample is beach, and how far each is from one.
  const beach = share((i) => biome[i] === 6, nx, nz, 20);
  const toBeach = distanceField((i) => biome[i] === 6 && beach[i]! > 0.25, nx, nz);
  const sand = new Float32Array(N);
  for (let i = 0; i < N; i++) sand[i] = Math.sqrt(toBeach[i]!) * cell;

  // The land's own lie, with the survey's centimetre noise smoothed out over a sample or two: it is not seen, and it is
  // most of what a map file would otherwise spend its bytes on.
  const raw = new Float32Array(N);
  const weight = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (water[i]) continue;
    if (Number.isNaN(dem[i]!) && !bathy) throw new Error(`sample ${i % nx}, ${Math.floor(i / nx)} has no elevation and the map no coastal model`);
    raw[i] = Number.isNaN(dem[i]!) ? bathy![i]! : dem[i]!;
    weight[i] = 1;
  }
  const radius = 1;
  const sum = radius > 0 ? blur(raw, nx, nz, radius, 2) : raw;
  const part = radius > 0 ? blur(weight, nx, nz, radius, 2) : weight;
  const land = new Float32Array(N);
  for (let i = 0; i < N; i++) land[i] = water[i] ? 0 : sum[i]! / Math.max(1e-6, part[i]!);

  let pools = 0;
  for (let i = 0; i < N; i++) {
    if (water[i]) {
      // Gently down from a beach or a mangrove shore, steeply from a seawall, and always deep enough to be water.
      const b = biome[nearLand[i]!]!;
      const gentle = b === 6 || b === 4 || b === 5;
      const d = shore[i]!;
      // Deep enough to swim within a few metres of a seawall and a few tens of a beach; farther out a shoal may rise again.
      const reach = gentle ? 30 : 10;
      const least = 0.3 + Math.min(d, reach) * (gentle ? 0.035 : 0.1);
      const shallowest = -(d <= reach ? least : Math.max(0.3, least - (d - reach) * 0.02));
      const deepest = -(0.4 + d * (gentle ? 0.08 : 0.6));
      height[i] = bathy ? Math.min(shallowest, Math.max(deepest, bathy[i]! - sea)) : shallowest;
      continue;
    }
    let h = land[i]! - sea;
    if (h < 0.12) {
      const b = biome[i]!;
      if (b === 5 || b === 4) {
        // Hollows of the marsh hold a little water, never more than wades.
        h = Math.max(h, -0.55);
        pools++;
      } else h = 0.12;
    }
    height[i] = h;
  }
  log(`ground: land and bed, ${pools} samples of marsh pool`);

  // Lakes above the sea, their beds carved under their own surfaces where the lidar has them flat.
  const built = base.bytes("buildings");
  const lakes = readLakes(base, world.lakes, sea, world.minY, world.stepY, dem, (i) => built[i]! > 0);
  if (lakes) {
    const deepest = carveLakes(lakes, world.lakes, height, grid);
    const left = lakes.made.filter((m) => m.left);
    log(`ground: ${lakes.made.length - left.length} lakes as ${lakes.bodies.length} bodies of water, to ${deepest.toFixed(1)} m deep; ${left.length} left marsh${left.map((m) => ` (${m.name || m.id}: ${m.left})`).join("")}`);
  }

  const ways = readWays(base.folder);
  let decks = 0; let fords = 0; let gapCount = 0; let cutSamples = 0;
  if (ways.length === 0) {
    // Bridges: a long one stands as a causeway on its piers, a short one has fallen into a ford, and a marked span is gone.
    const span = (i: number): boolean => water[i] === 1 && (roads[i] === 3 || roads[i] === 5 || gaps[i] === 1);
    const { label, count } = regions(span, nx, nz);
    const box = Array.from({ length: count + 1 }, () => [Infinity, -Infinity, Infinity, -Infinity, 0]);
    for (let i = 0; i < N; i++) {
      const l = label[i]!;
      if (!l) continue;
      const c = i % nx;
      const r = (i - c) / nx;
      const bx = box[l]!;
      bx[0] = Math.min(bx[0]!, c);
      bx[1] = Math.max(bx[1]!, c);
      bx[2] = Math.min(bx[2]!, r);
      bx[3] = Math.max(bx[3]!, r);
      bx[4]!++;
    }
    const length = box.map((bx) => (bx[4]! > 0 ? Math.hypot(bx[1]! - bx[0]!, bx[3]! - bx[2]!) * cell : 0));
    const standing = (l: number): boolean => length[l]! >= 120 && box[l]![4]! >= 30;
    // Walk out along each standing bridge from the land at its ends, carrying the height it left the land at.
    const along = new Float32Array(N).fill(Infinity);
    const from = new Float32Array(N);
    const queue = new Int32Array(N);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < N; i++) {
      const l = label[i]!;
      if (!l || !standing(l) || gaps[i]) continue;
      const c = i % nx;
      const r = (i - c) / nx;
      let sum = 0;
      let m = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const j = (r + dr) * nx + c + dc;
          if (r + dr < 0 || r + dr >= nz || c + dc < 0 || c + dc >= nx || water[j]) continue;
          sum += height[j]!;
          m++;
        }
      }
      if (m === 0) continue;
      along[i] = 0;
      from[i] = Math.max(0.6, sum / m);
      queue[tail++] = i;
    }
    while (head < tail) {
      const i = queue[head++]!;
      const c = i % nx;
      const r = (i - c) / nx;
      for (const [dc, dr, step] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]] as const) {
        if (r + dr < 0 || r + dr >= nz || c + dc < 0 || c + dc >= nx) continue;
        const j = (r + dr) * nx + c + dc;
        if (label[j] !== label[i] || gaps[j]) continue;
        const d = along[i]! + step * cell;
        if (d < along[j]!) {
          along[j] = d;
          from[j] = from[i]!;
          queue[tail++] = j;
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const l = label[i]!;
      if (!l || gaps[i]) continue;
      const c = i % nx;
      const r = (i - c) / nx;
      if (standing(l) && along[i]! < Infinity) {
        const rise = Math.min(5.5, 1.2 + length[l]! / 160);
        height[i] = from[i]! + Math.min(rise, along[i]! * 0.06);
        surface[i] = S.DECK;
        decks++;
      } else if (!standing(l)) {
        height[i] = -0.45 + 0.25 * fbm(c * cell + grid.noiseWest, r * cell + grid.noiseNorth, 4, 31);
        surface[i] = S.FORD;
        fords++;
      }
    }
    // At a broken span the deck has slumped into the water from each end, and the middle is open.
    const deckNear = new Int32Array(N);
    const toDeck = distanceField((i) => surface[i] === S.DECK, nx, nz, deckNear);
    for (let i = 0; i < N; i++) {
      if (!gaps[i] || !water[i]) continue;
      gapCount++;
      const j = deckNear[i]!;
      if (j < 0) continue;
      const slump = height[j]! - Math.sqrt(toDeck[i]!) * cell * 0.9;
      if (slump > height[i]!) {
        height[i] = slump;
        surface[i] = S.FORD;
      }
    }
    log(`ground: ${count} bridge pieces, ${decks} deck samples standing, ${fords} fallen into fords, ${gapCount} samples of broken span`);

  } else {
    cutSamples = cutBridgeWater(pathsOf(ways, grid).paths, height, water, grid);
    for (let i = 0; i < N; i++) if (gaps[i] && water[i]) gapCount++;
    log(`ground: static bridge beds, ${cutSamples} samples cut, ${gapCount} authored gap samples retained`);
  }

  // Districts, by their rings, a later one over an earlier.
  // Two bytes a sample: a big map's districts run past 255 (Tampa's 16 km has 233), and the 256th was district 0.
  const district = new Uint16Array(N);
  const toCol = (e: number): number => (e - west) / cell;
  const toRow = (no: number): number => (north - no) / cell;
  world.districts.forEach((d, k) => {
    const ring = d.ring.map(([lon, lat]) => base.tm.forward(lon, lat));
    ring.push(ring[0]!);
    fillPolygon([ring], toCol, toRow, nx, nz, (col, row) => (district[row * nx + col] = k + 1));
  });

  // The ruins.
  const facts = JSON.parse(readFileSync(join(base.folder, "base", "buildings_attributes.json"), "utf8")) as { fields: string[]; rows: (number | string | null)[][] };
  const [idAt, heightAt, useAt] = ["OBJECTID", "HEIGHT", "OCC_CLS"].map((f) => facts.fields.indexOf(f)) as [number, number, number];
  const about = new Map(facts.rows.map((r) => [r[idAt] as number, { height: (r[heightAt] as number | null) ?? null, use: (r[useAt] as string | null) ?? null }]));
  const buildings = readBuildings(JSON.parse(readFileSync(join(base.folder, "base", "buildings.geojson"), "utf8")), about);
  const road = new Uint8Array(N);
  for (let i = 0; i < N; i++) road[i] = roads[i] === 1 || roads[i] === 2 ? 1 : 0;
  const heaps = makeHeaps({
    grid,
    buildings,
    districtOf: (e, no) => {
      const col = Math.round(toCol(e));
      const row = Math.round(toRow(no));
      const k = col >= 0 && row >= 0 && col < nx && row < nz ? district[row * nx + col]! : 0;
      const d = k > 0 ? world.districts[k - 1]! : null;
      return { index: k, tall: d?.tall ?? 0.1, industrial: d?.style === "industrial" };
    },
    ground: height,
    road,
    water,
  });
  const PART_SURFACE: Record<number, number> = { [PART_HEAP]: S.HEAP, [PART_SPILL]: S.SPILL, [PART_WALL]: S.WALL, [PART_FLOOR]: S.FLOOR, [PART_POOL]: S.POOL, [PART_COURT]: S.COURT };
  // The heaps are a stand-in until ruins are built of blocks: with them off, each footprint is left as its bare slab.
  const raise = world.heaps !== false;
  for (let i = 0; i < N; i++) {
    const p = heaps.part[i]!;
    if (p === 0 || water[i]) continue;
    if (!raise) {
      if (p !== PART_SPILL && p !== PART_COURT) surface[i] = S.FLOOR;
      continue;
    }
    height[i] = height[i]! + heaps.lift[i]!;
    surface[i] = PART_SURFACE[p]!;
  }
  log(raise ? `ground: ${heaps.ruins.length} ruins raised as heaps, the tallest crest ${Math.max(...heaps.ruins.map((r) => r.crest)).toFixed(1)} m` : `ground: ${heaps.ruins.length} footprints left as bare slabs`);

  // Streets the sea has come into stand under a hand's depth of water at their edges and a knee's in the middle.
  const dry = distanceField((i) => flooded[i] === 0, nx, nz);
  for (let i = 0; i < N; i++) {
    if (!flooded[i] || water[i]) continue;
    const depth = 0.12 + Math.min(0.35, Math.sqrt(dry[i]!) * cell * 0.08);
    height[i] = Math.min(height[i]!, -depth);
    surface[i] = S.POOL;
  }

  // Wrecks: a hull a wader can stand on, its bow or stern above the water, where metal can be had.
  const changes = JSON.parse(readFileSync(join(base.folder, "base", "future_changes.geojson"), "utf8")) as { features: { properties: { kind: string; center?: [number, number]; length_m?: number; angle_degrees?: number } }[] };
  const hulls = changes.features.filter((f) => f.properties.kind === "submerged_wreck").map((f) => f.properties);
  for (let i = 0; i < N; i++) {
    if (!wrecks[i]) continue;
    const c = i % nx;
    const r = (i - c) / nx;
    const e = west + c * cell;
    const no = north - r * cell;
    let best = hulls[0]!;
    for (const h of hulls) if (Math.hypot(e - h.center![0], no - h.center![1]) < Math.hypot(e - best.center![0], no - best.center![1])) best = h;
    const a = (best.angle_degrees! * Math.PI) / 180;
    const t = ((e - best.center![0]) * Math.cos(a) + (no - best.center![1]) * Math.sin(a)) / best.length_m!;
    height[i] = t > 0.3 ? 0.6 + 1.2 * (t - 0.3) : -1.05 + 0.3 * fbm(c * cell + grid.noiseWest, r * cell + grid.noiseNorth, 3, 55);
    surface[i] = S.WRECK;
  }

  // What each sample is, where the steps above have not said.
  const styleOf = (i: number): string => world.districts[district[i]! - 1]?.style ?? "";
  for (let i = 0; i < N; i++) {
    if (surface[i] !== 0) continue;
    const h = height[i]!;
    if (water[i]) {
      // Off a beach the bed is sand well out; elsewhere it is seagrass on the flats and mud in the deeps.
      const sandy = beach[nearLand[i]!]! > 0.25 && shore[i]! < 250 && h > -7;
      surface[i] = h < -7 ? S.CHANNEL : sandy ? S.SHALLOW : h < -3 ? S.DEEP : h < -1.2 ? S.FLAT : S.SHALLOW;
      continue;
    }
    const lake = lakes ? lakes.body[i]! : 0;
    if (lake !== 0) {
      const d = h - lakes!.bodies[lake - 1]!.surface;
      surface[i] = d < -7 ? S.CHANNEL : d < -3 ? S.DEEP : d < -1.2 ? S.FLAT : S.SHALLOW;
      continue;
    }
    if (h < 0) {
      surface[i] = S.POOL;
      continue;
    }
    const b = biome[i]!;
    const rd = roads[i]!;
    const u = use[i]!;
    if (rd === 2 || rd === 1) surface[i] = u === USE.CROSSING ? S.CROSSWALK : rd === 2 ? S.HIGHWAY : S.STREET;
    else if (rd === 6) surface[i] = S.PAVED;
    // Off the roads, what a person walks on before what grows there.
    else if (u === USE.SIDEWALK || u === USE.CROSSING) surface[i] = S.SIDEWALK;
    else if (u === USE.PATH) surface[i] = S.WALKWAY;
    else if (u === USE.PLAZA) surface[i] = S.PLAZA;
    else if (u === USE.LOT) surface[i] = S.LOT;
    // A beach is sand though it lies in a park (Virginia Key Beach Park): OpenStreetMap draws both, and with the park
    // first a beach park was lawn and a spawn point on its sand found none. Mangrove and marsh are not drawn but made by
    // a rule (prepare.py: growth near the coast), so a park drawn over them stands: put first they took 12% of Tampa's
    // park ground and 21% of Miami's. What is paved (above) stands over all of it.
    else if (b === 6) surface[i] = shore[i]! < 7 ? S.WET_SAND : canopy[i] ? S.DUNE : S.BEACH;
    else if (u === USE.PARK || u === USE.PITCH) surface[i] = canopy[i] && u === USE.PARK ? S.CANOPY : S.GREEN;
    else if (b === 4) surface[i] = S.MANGROVE;
    else if (b === 5) surface[i] = S.MARSH;
    else if (canopy[i]) surface[i] = S.CANOPY;
    else if (b === 3) surface[i] = S.GREEN;
    else if (b === 10) surface[i] = S.DESERT;
    else surface[i] = styleOf(i) === "industrial" ? S.YARD : S.OPEN;
  }
  // The port's yards are rows of containers along the island, one or two high, some gone, with lanes between.
  const container = new Uint8Array(N);
  const port = world.districts.findIndex((d) => d.name === world.containerDistrict) + 1;
  let stacks = 0;
  if (port > 0 && world.containerHeaps !== false) {
    const ring = world.districts[port - 1]!.ring.map(([lon, lat]) => base.tm.forward(lon, lat));
    const angle = Math.atan2(ring[1]![1] - ring[0]![1], ring[1]![0] - ring[0]![0]);
    const [ca, sa] = [Math.cos(angle), Math.sin(angle)];
    for (let i = 0; i < N; i++) {
      if (surface[i] !== S.YARD || district[i] !== port || shore[i]! < 8) continue;
      const c = i % nx;
      const r = (i - c) / nx;
      const e = west + c * cell;
      const no = north - r * cell;
      const u = e * ca + no * sa;
      const v = -e * sa + no * ca;
      const row = Math.floor(v / 14);
      const seg = Math.floor(u / 28);
      if (v - row * 14 >= 8 || u - seg * 28 >= 24) continue;
      const pick = hash3(row, seg, 0x2c);
      if (pick % 100 >= 55) continue;
      const high = pick % 7 < 2 ? 2 : 1;
      height[i] = height[i]! + 2.6 * high;
      surface[i] = S.CONTAINER;
      container[i] = (pick >>> 8) & 255;
      stacks++;
    }
  }
  log(`ground: ${Math.round(stacks * 4)} square metres of container stacks`);
  const beachBed = new Set<number>();
  if (world.sea !== false) {
    const count = shapeBeach(height, nx, nz, cell, i => {
      const s = surface[i]!;
      if (s === S.BEACH || s === S.WET_SAND || s === S.DUNE) return BEACH_LAND;
      return s === S.SHALLOW && water[i] && !roads[i] && !built[i] && !gaps[i] && !lakes?.body[i] ? BEACH_SEA : 0;
    }, i => beachBed.add(i));
    log(`ground: graded ${count} sandy foreshore samples`);
  }
  return { grid, height, surface, district, heaps, shore, beachBed, container, sand, water, gaps, bridges: { standing: decks, fords, gaps: gapCount, cutSamples }, lakes };
}
