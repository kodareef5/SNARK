// The ground of a map from its base layers: the land of the elevation model, the bed of the coastal model under the water
// the shoreline survey marks, bridges standing as causeways or fallen into fords, the authored broken spans and drowned
// streets, the wrecks, and the ruins of every building (heaps.ts). Heights are metres above the sea.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Base } from "./base.ts";
import { makeHeaps, readBuildings, PART_COURT, PART_FLOOR, PART_HEAP, PART_POOL, PART_SPILL, PART_WALL, type Heaps } from "./heaps.ts";
import { blur, distanceField, fbm, fillPolygon, hash3, regions, share } from "./raster.ts";

/** What a sample's ground is, for its colour and for what lives on it. */
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
} as const;

export interface District {
  readonly name: string;
  readonly style: string;
  readonly tall: number;
  readonly ring: readonly (readonly [number, number])[];
}

export interface World {
  readonly id: string;
  readonly label: string;
  readonly seaNavd88: number;
  readonly minY: number;
  readonly stepY: number;
  readonly districts: readonly District[];
  readonly spawns: readonly { name: string; at: [number, number]; face: [number, number]; ground: "sand" | "open" }[];
}

export interface Ground {
  readonly n: number;
  readonly height: Float32Array;
  readonly surface: Uint8Array;
  /** Per sample, its district counting from 1 in the world's list, or 0. */
  readonly district: Uint8Array;
  readonly heaps: Heaps;
  /** Metres from each land sample to the water, and from each water sample to the land. */
  readonly shore: Float32Array;
  /** Per sample of a container stack, which container it is, for its colour. */
  readonly container: Uint8Array;
  /** Metres from each sample to the nearest real beach. */
  readonly sand: Float32Array;
  readonly bridges: { standing: number; fords: number; gaps: number };
}

export function makeGround(base: Base, world: World, log: (line: string) => void): Ground {
  const n = base.n;
  const N = n * n;
  const cell = base.info.spacing_m;
  const half = base.info.size_m / 2;
  const sea = world.seaNavd88;
  const water = base.bytes("water");
  const roads = base.bytes("roads");
  const biome = base.bytes("biome");
  const canopy = base.bytes("painted_canopy");
  const flooded = base.bytes("flooded_streets");
  const gaps = base.bytes("bridge_gaps");
  const wrecks = base.bytes("wrecks");
  const dem = base.elevation();
  const bathy = blur(base.bathymetry(), n, n, 2, 3);
  const height = new Float32Array(N);
  const surface = new Uint8Array(N);

  // Distances across the shoreline, and for water which land is nearest.
  const nearLand = new Int32Array(N);
  const toLand = distanceField((i) => water[i] === 0, n, n, nearLand);
  const toWater = distanceField((i) => water[i] === 1, n, n);
  const shore = new Float32Array(N);
  for (let i = 0; i < N; i++) shore[i] = Math.sqrt(water[i] ? toLand[i]! : toWater[i]!) * cell;
  // How much of the ground round each sample is beach, and how far each is from one.
  const beach = share((i) => biome[i] === 6, n, n, 20);
  const toBeach = distanceField((i) => biome[i] === 6 && beach[i]! > 0.25, n, n);
  const sand = new Float32Array(N);
  for (let i = 0; i < N; i++) sand[i] = Math.sqrt(toBeach[i]!) * cell;

  // The land's own lie, with the survey's centimetre noise smoothed out over a sample or two: it is not seen, and it is
  // most of what a map file would otherwise spend its bytes on.
  const raw = new Float32Array(N);
  const weight = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (water[i]) continue;
    raw[i] = Number.isNaN(dem[i]!) ? bathy[i]! : dem[i]!;
    weight[i] = 1;
  }
  const radius = 1;
  const sum = radius > 0 ? blur(raw, n, n, radius, 2) : raw;
  const part = radius > 0 ? blur(weight, n, n, radius, 2) : weight;
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
      height[i] = Math.min(shallowest, Math.max(deepest, bathy[i]! - sea));
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

  // Bridges: a long one stands as a causeway on its piers, a short one has fallen into a ford, and a marked span is gone.
  const span = (i: number): boolean => water[i] === 1 && (roads[i] === 3 || roads[i] === 5 || gaps[i] === 1);
  const { label, count } = regions(span, n, n);
  const box = Array.from({ length: count + 1 }, () => [Infinity, -Infinity, Infinity, -Infinity, 0]);
  for (let i = 0; i < N; i++) {
    const l = label[i]!;
    if (!l) continue;
    const c = i % n;
    const r = (i - c) / n;
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
    const c = i % n;
    const r = (i - c) / n;
    let sum = 0;
    let m = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const j = (r + dr) * n + c + dc;
        if (r + dr < 0 || r + dr >= n || c + dc < 0 || c + dc >= n || water[j]) continue;
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
    const c = i % n;
    const r = (i - c) / n;
    for (const [dc, dr, step] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]] as const) {
      if (r + dr < 0 || r + dr >= n || c + dc < 0 || c + dc >= n) continue;
      const j = (r + dr) * n + c + dc;
      if (label[j] !== label[i] || gaps[j]) continue;
      const d = along[i]! + step * cell;
      if (d < along[j]!) {
        along[j] = d;
        from[j] = from[i]!;
        queue[tail++] = j;
      }
    }
  }
  let decks = 0;
  let fords = 0;
  for (let i = 0; i < N; i++) {
    const l = label[i]!;
    if (!l || gaps[i]) continue;
    const c = i % n;
    const r = (i - c) / n;
    if (standing(l) && along[i]! < Infinity) {
      const rise = Math.min(5.5, 1.2 + length[l]! / 160);
      height[i] = from[i]! + Math.min(rise, along[i]! * 0.06);
      surface[i] = S.DECK;
      decks++;
    } else if (!standing(l)) {
      height[i] = -0.45 + 0.25 * fbm(c * cell, r * cell, 4, 31);
      surface[i] = S.FORD;
      fords++;
    }
  }
  // At a broken span the deck has slumped into the water from each end, and the middle is open.
  const deckNear = new Int32Array(N);
  const toDeck = distanceField((i) => surface[i] === S.DECK, n, n, deckNear);
  let gapCount = 0;
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

  // Districts, by their rings, a later one over an earlier.
  const district = new Uint8Array(N);
  const toCol = (e: number): number => (e + half) / cell;
  const toRow = (no: number): number => (half - no) / cell;
  world.districts.forEach((d, k) => {
    const ring = d.ring.map(([lon, lat]) => base.tm.forward(lon, lat));
    ring.push(ring[0]!);
    fillPolygon([ring], toCol, toRow, n, n, (col, row) => (district[row * n + col] = k + 1));
  });

  // The ruins.
  const buildings = readBuildings(JSON.parse(readFileSync(join(base.folder, "base", "buildings.geojson"), "utf8")));
  const road = new Uint8Array(N);
  for (let i = 0; i < N; i++) road[i] = roads[i] === 1 || roads[i] === 2 ? 1 : 0;
  const heaps = makeHeaps({
    grid: { n, half, cell },
    buildings,
    districtOf: (e, no) => {
      const col = Math.round(toCol(e));
      const row = Math.round(toRow(no));
      const k = col >= 0 && row >= 0 && col < n && row < n ? district[row * n + col]! : 0;
      const d = k > 0 ? world.districts[k - 1]! : null;
      return { index: k, tall: d?.tall ?? 0.1, industrial: d?.style === "industrial" };
    },
    ground: height,
    road,
    water,
  });
  const PART_SURFACE: Record<number, number> = { [PART_HEAP]: S.HEAP, [PART_SPILL]: S.SPILL, [PART_WALL]: S.WALL, [PART_FLOOR]: S.FLOOR, [PART_POOL]: S.POOL, [PART_COURT]: S.COURT };
  for (let i = 0; i < N; i++) {
    const p = heaps.part[i]!;
    if (p === 0 || water[i]) continue;
    height[i] = height[i]! + heaps.lift[i]!;
    surface[i] = PART_SURFACE[p]!;
  }
  log(`ground: ${heaps.ruins.length} ruins, the tallest crest ${Math.max(...heaps.ruins.map((r) => r.crest)).toFixed(1)} m`);

  // Streets the sea has come into stand under a hand's depth of water at their edges and a knee's in the middle.
  const dry = distanceField((i) => flooded[i] === 0, n, n);
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
    const c = i % n;
    const r = (i - c) / n;
    const e = -half + c * cell;
    const no = half - r * cell;
    let best = hulls[0]!;
    for (const h of hulls) if (Math.hypot(e - h.center![0], no - h.center![1]) < Math.hypot(e - best.center![0], no - best.center![1])) best = h;
    const a = (best.angle_degrees! * Math.PI) / 180;
    const t = ((e - best.center![0]) * Math.cos(a) + (no - best.center![1]) * Math.sin(a)) / best.length_m!;
    height[i] = t > 0.3 ? 0.6 + 1.2 * (t - 0.3) : -1.05 + 0.3 * fbm(c * cell, r * cell, 3, 55);
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
    if (h < 0) {
      surface[i] = S.POOL;
      continue;
    }
    const b = biome[i]!;
    const rd = roads[i]!;
    if (rd === 2) surface[i] = S.HIGHWAY;
    else if (rd === 1) surface[i] = S.STREET;
    else if (b === 6) surface[i] = shore[i]! < 7 ? S.WET_SAND : canopy[i] ? S.DUNE : S.BEACH;
    else if (b === 4) surface[i] = S.MANGROVE;
    else if (b === 5) surface[i] = S.MARSH;
    else if (canopy[i]) surface[i] = S.CANOPY;
    else if (b === 3) surface[i] = S.GREEN;
    else surface[i] = styleOf(i) === "industrial" ? S.YARD : S.OPEN;
  }
  // The port's yards are rows of containers along the island, one or two high, some gone, with lanes between.
  const container = new Uint8Array(N);
  const port = world.districts.findIndex((d) => d.name === "The Port") + 1;
  let stacks = 0;
  if (port > 0) {
    const ring = world.districts[port - 1]!.ring.map(([lon, lat]) => base.tm.forward(lon, lat));
    const angle = Math.atan2(ring[1]![1] - ring[0]![1], ring[1]![0] - ring[0]![0]);
    const [ca, sa] = [Math.cos(angle), Math.sin(angle)];
    for (let i = 0; i < N; i++) {
      if (surface[i] !== S.YARD || district[i] !== port || shore[i]! < 8) continue;
      const c = i % n;
      const r = (i - c) / n;
      const e = -half + c * cell;
      const no = half - r * cell;
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
  return { n, height, surface, district, heaps, shore, container, sand, bridges: { standing: decks, fords, gaps: gapCount } };
}
