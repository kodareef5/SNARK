// A city's marinas laid out as places (tools/mapworld/README.md, "Marinas"): fixed timber docks reaching out from the
// bank along the piers OpenStreetMap maps there, or along one walkway this lays where it maps none; finger piers off
// them with a mooring pile at each tip, so that a slip is a real place; and boats in the slips, aligned with the
// fingers, a size that fits, bow-in mostly. Most of them are statics of the vessels' own hulls (content/docks.ts); a
// share are left for found vessels a survivor can take (tools/boat/sites.ts takes those slips), and a few are wrecks.
// Beside the other piers a share hold a boat or two alongside, and off a share of the marinas a few lie at anchor.
//
// Everything here is in lattice metres (tools/mapworld/base.ts Grid): x west, z north, a piece's yaw in degrees from
// north toward +x, so its +Z points along (sin, cos). Nothing here moves the ground or the water: a dock stands on what
// the ground is.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCK, DOCK_KINDS, MOORED_PAINTS, burningKind, mooredKind, type DockPart } from "../../content/docks.ts";
import { formMesh, hulkOf, waterlineOf, type HarbourWreckForm, type Waterline } from "../../content/vehicles/harbour-wrecks.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { hashString } from "../../shared/hash.ts";
import { boatRestY } from "../../shared/sim/boat.ts";
import { isBoatVehicle, type BoatVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { binKey } from "../mapworld/raster.ts";
import { extentOf, meets, middleOf, type Box } from "../mapworld/ruin-obstacles.ts";
import type { PublicPlace } from "../mapworld/labels.ts";
import { inRing, type Point } from "../mapworld/ruin-geometry.ts";
import { vocabulary } from "../mapworld/ruin-vocabulary.ts";
import type { Site, StaticPiece } from "../mapworld/statics.ts";
import { isFurniture } from "../mapworld/street-furniture.ts";
import { pathsOf, readWays, type Path } from "../mapworld/ways.ts";
import { HARBOURS, mappedBoatSites, pick, siteMix, type BoatSite, type DistrictAt, type Harbours } from "./sites.ts";
import { formWaterlines, type HarbourWreck } from "./wrecks.ts";

/**
 * How docks are laid out (`harbours.docks`). A pier way whose middle lies within `reach` of a marina's point, nearer it
 * than any other marina's, no longer than `longest`, over the water for `wet` of its length, and no wider than `widest`
 * unless it is an area no building stands in, is that marina's dock. One of `finger` metres or less whose end comes
 * within 6 m of a longer one of the marina's is a finger. A marina that has none, and whose point is not in a building,
 * gets one walkway from the bank nearest its point within `build.search`, as long as the open water lets it up to
 * `build.longest`, if that is `build.shortest` or more. `classes` are the slips a walkway's side is given, each its
 * finger's length and the vessels in it; `alongside` holds the big ones, moored along a walkway or across a T-head
 * at the end of a level stretch of `tee` metres or more. `gap` is the water between a hull and a finger or the
 * walkway; `fairway` the water past a slip's mouth kept clear, in its row's longest boat's lengths.
 */
export interface DockRules {
  reach: number; longest: number; widest: number; wet: number; finger: number;
  build: { search: number; longest: number; shortest: number };
  classes: Record<string, { finger?: number; vessels: string[] }>;
  gap: number; fairway: number; tee: number;
}
/**
 * What fills them (`harbours.moored`): `fill` of the slips hold a boat; of those `found` are found vessels (at least
 * `harbours.marina.least` and at most `most` a marina) and `wrecked` wrecks; `sternTo` lie stern-to. A chunk holds at
 * most `perChunk.boats` moored statics of at most `perChunk.meshes` meshes. `piers.share` of the other piers hold up to
 * `piers.most` boats alongside, of at most `piers.longest` metres. `anchored.share` of the marinas have `least` to
 * `most` boats at anchor `out` metres off, in water `depth` deep, heading into the wind, `heading` degrees, give or
 * take `swing`.
 */
/** Degrees off its berth's line a hull left to rot may lie, and the share of its topsides (keel to rail, less its draught) it has sunk by. */
const AWRY = 8;
const AWASH: readonly [number, number] = [0.2, 0.45];

export interface MooredRules {
  fill: number; found: number; sternTo: number; wrecked: number;
  /** `share` of the hulls left to rot burn where they lie, `most` of them a marina. */
  burning?: { share: number; most: number };
  perChunk: { boats: number; meshes: number };
  piers: { share: number; most: number; longest: number };
  anchored: { share: number; least: number; most: number; out: [number, number]; depth: [number, number]; heading: number; swing: number };
}

/** A slip as laid out: where its boat lies and which way, and whether a survivor can take it or it is scenery. */
export interface Slip {
  id: string; site: string; district: string; vessel: string; x: number; z: number; yaw: number;
  found: boolean; how: "slip" | "stern-to" | "alongside" | "tee" | "pier" | "anchored";
  /** Where a survivor stands on the dock beside it, or null at anchor; the run of dock it lies at, or "". */
  dock: { x: number; y: number; z: number } | null; run: string;
}
/** A run of dock modules, as the walk proof walks it: its modules' deck points, from its root. */
export interface DockRun { site: string; id: string; finger: boolean; points: { x: number; y: number; z: number }[]; landed: boolean; /** The runs whose decks it ran onto. */ joins: string[] }
/** An unbroken part of a run as it is laid: its modules' deck points, its level stretches over the water, and the range of the layout's pieces it put. */
interface RunPart {
  id: string; tag: string; points: DockRun["points"]; landed: boolean; joins: string[]; pieces: [number, number];
  /** The tags of the street furniture it came ashore over. */
  cleared: string[];
  stretches: { from: [number, number]; d: [number, number]; length: number; outer: boolean }[];
}
export interface MarinaLayout {
  pieces: StaticPiece[]; slips: Slip[]; runs: DockRun[]; wrecks: HarbourWreck[];
  /** The marinas whose wrecks are in their slips, which tools/boat/wrecks.ts sets none among. */
  slipped: Set<string>;
  /** Indices into the pieces given of the street furniture a dock came ashore over, which the build takes up. */
  cleared: number[];
  refused: Record<string, number>;
}
export interface MarinaGround {
  waterAt(x: number, z: number): number; groundAt(x: number, z: number): number;
  inside(x: number, z: number, reach: number): boolean;
  /** Whether the chunk at a point has room for another piece, and that one is set down there. */
  room(x: number, z: number): boolean; took(x: number, z: number): void;
  /** A piece set down there taken up again: its room is the chunk's once more. */
  gave(x: number, z: number): void;
  chunk(x: number, z: number): number;
}

const RAD = Math.PI / 180;
/** The room a survivor walks in over a dock's deck, which nothing else may stand in: a pier's deck over it, a building's overhang. */
const HEADROOM = 2.1;
/** How near a module's middle is to a run's line where the two meet: half a walkway, half a module and a margin. */
export const JOINT = DOCK.walk / 2 + DOCK.length / 2 + .6;
const yawOf = (dx: number, dz: number): number => ((Math.atan2(dx, dz) / RAD) % 360 + 360) % 360;
const round = (v: number, step = 1 / 64): number => Math.round(v / step) * step;

/** The harbours' rules a build follows: its vocabulary's, which extends the shared library's, or the library's. */
export const harboursOf = (site: Pick<Site, "world" | "source">): Harbours => site.world.heaps === false ? vocabulary(site.source).harbours : HARBOURS;

/** A site's marinas, in lattice metres. */
export function marinaSites(site: Pick<Site, "source" | "toLattice">): BoatSite[] {
  const file = join(site.source, "blocks/places.json");
  return existsSync(file) ? mappedBoatSites(JSON.parse(readFileSync(file, "utf8")) as PublicPlace[], {}, site.toLattice).filter((s) => s.waterfront === "marina") : [];
}

/** Each marina's docks of a site's mapped piers, as the bridge layer and the build both ask for them. */
export function marinaDocks(site: Site, rules?: DockRules): Map<string, Path[]> {
  // A site with no places, as a test's, has no marinas.
  const marinas = marinaSites(site);
  if (marinas.length === 0) return new Map();
  const { paths } = pathsOf(readWays(site.source), site.ground.grid);
  const built = (ring: readonly (readonly [number, number])[]): boolean => site.footprints.some(({ building: b }) => inRing(b.e, b.n, ring as Point[]));
  return marinaPaths(marinas, paths, (x, z) => site.groundAt(x, z) < site.waterAt(x, z) - .3, rules ?? harboursOf(site).docks, built);
}

/**
 * Which of a city's pier paths are marinas' docks, by marina. The bridge layer leaves them to this (tools/mapworld/
 * bridges.ts). A pier mapped as an area is its long axis: wider than `widest`, it is a dock and its slips drawn round as
 * one, unless a building stands in it (`built`, given its ring as mapped), as on a pier with sheds.
 */
export function marinaPaths(sites: readonly BoatSite[], paths: readonly Path[], wet: (x: number, z: number) => boolean, rules: DockRules, built: (ring: readonly (readonly [number, number])[]) => boolean = () => false): Map<string, Path[]> {
  const marinas = sites.filter((s) => s.waterfront === "marina"), out = new Map<string, Path[]>();
  const byWay = new Map<number, Path[]>();
  for (const p of paths) if (p.way.kind === "pier") { if (!byWay.has(p.way.id)) byWay.set(p.way.id, []); byWay.get(p.way.id)!.push(p); }
  for (const [, parts] of [...byWay.entries()].sort((a, b) => a[0] - b[0])) {
    const way = parts[0]!.way, points = parts.flatMap((p) => p.points);
    const length = parts.reduce((n, p) => n + p.points.slice(1).reduce((m, q, k) => m + Math.hypot(q[0] - p.points[k]![0], q[1] - p.points[k]![1]), 0), 0);
    if (length > rules.longest || points.length < 2 || (parts.some((p) => p.width > rules.widest) && (!way.closed || built(way.points)))) continue;
    const mx = points.reduce((n, p) => n + p[0], 0) / points.length, mz = points.reduce((n, p) => n + p[1], 0) / points.length;
    let near: BoatSite | null = null;
    for (const m of marinas) if (!near || Math.hypot(m.x - mx, m.z - mz) < Math.hypot(near.x - mx, near.z - mz)) near = m;
    if (!near || Math.hypot(mx - near.x, mz - near.z) > rules.reach || points.some(([x, z]) => Math.hypot(x - near!.x, z - near!.z) > rules.reach + rules.longest / 2)) continue;
    let wetCount = 0, all = 0;
    for (const p of parts) for (let k = 1; k < p.points.length; k++) {
      const [a, b] = [p.points[k - 1]!, p.points[k]!], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s <= len; s += 2) { all++; if (wet(a[0] + (b[0] - a[0]) * s / Math.max(len, 1e-6), a[1] + (b[1] - a[1]) * s / Math.max(len, 1e-6))) wetCount++; }
    }
    if (all === 0 || wetCount / all < rules.wet) continue;
    if (!out.has(near.id)) out.set(near.id, []);
    out.get(near.id)!.push(...parts);
  }
  return out;
}

/** Boxes of pieces near the places, to keep clear of: each piece's own box, turned as it is. */
class Boxes {
  private bins = new Map<number, { box: Box; tag: string }[]>();
  /** Tags of boxes taken away, which nothing meets any more. */
  readonly gone = new Set<string>();
  add(box: Box, tag: string): void {
    const r = Math.hypot(box.size[0], box.size[2]) / 2 + 1;
    for (let z = Math.floor((box.z - r) / 32); z <= Math.floor((box.z + r) / 32); z++) for (let x = Math.floor((box.x - r) / 32); x <= Math.floor((box.x + r) / 32); x++) {
      const k = binKey(x, z); if (!this.bins.has(k)) this.bins.set(k, []); this.bins.get(k)!.push({ box, tag });
    }
  }
  /** Whether any box but those whose tag `skip` names meets this one grown by `gap`. */
  hits(box: Box, gap = 0, skip?: (tag: string) => boolean): boolean {
    const r = Math.hypot(box.size[0], box.size[2]) / 2 + gap;
    for (let z = Math.floor((box.z - r) / 32); z <= Math.floor((box.z + r) / 32); z++) for (let x = Math.floor((box.x - r) / 32); x <= Math.floor((box.x + r) / 32); x++) {
      for (const q of this.bins.get(binKey(x, z)) ?? []) if (!skip?.(q.tag) && !this.gone.has(q.tag) && meets(box, q.box, gap)) return true;
    }
    return false;
  }
  /** The tags of the boxes this one meets that `which` picks. */
  tags(box: Box, which: (tag: string) => boolean): Set<string> {
    const r = Math.hypot(box.size[0], box.size[2]) / 2, out = new Set<string>();
    for (let z = Math.floor((box.z - r) / 32); z <= Math.floor((box.z + r) / 32); z++) for (let x = Math.floor((box.x - r) / 32); x <= Math.floor((box.x + r) / 32); x++) {
      for (const q of this.bins.get(binKey(x, z)) ?? []) if (which(q.tag) && !this.gone.has(q.tag) && meets(box, q.box)) out.add(q.tag);
    }
    return out;
  }
}

/** A piece's box as it stands, from its kind's extent, or its registry half extents where the kit does not know the kind. */
function pieceBox(p: StaticPiece, reg: Registry): Box | null {
  try {
    const { size } = extentOf(p.kind), m = middleOf(p);
    return { x: m.x, y: m.y, z: m.z, yaw: p.yaw, size };
  } catch {
    const k = reg.index.get(p.kind);
    return k === undefined ? null : { x: p.x, y: p.y, z: p.z, yaw: p.yaw, size: [reg.halfX[k]! * 2, reg.halfY[k]! * 2, reg.halfZ[k]! * 2] };
  }
}

/** A box along a line: its middle `along` metres from `o` in `d` and `across` metres to its right, at height y. */
const lineBox = (o: readonly [number, number], d: readonly [number, number], along: number, across: number, y: number, size: readonly [number, number, number], turned = false): Box => {
  // The right of +Z, as a piece's +X is: (cos, -sin) of its yaw, that is (dz, -dx).
  const x = o[0] + d[0] * along + d[1] * across, z = o[1] + d[1] * along - d[0] * across;
  return { x, y, z, yaw: turned ? yawOf(d[1], -d[0]) : yawOf(d[0], d[1]), size };
};

/**
 * The marinas laid out among `pieces`, every static set down so far, in `ground`'s lattice metres. `keep` are boxes
 * nothing here may stand in: the bridges' swim lanes, under their decks.
 */
export function layMarinas(sites: readonly BoatSite[], docks: ReadonlyMap<string, Path[]>, piers: readonly Path[], rules: Harbours, reg: Registry, pieces: readonly StaticPiece[], ground: MarinaGround, districtAt: DistrictAt, made: (mesh: string) => boolean, keep: readonly Box[] = []): MarinaLayout {
  const D = rules.docks, M = rules.moored, out: MarinaLayout = { pieces: [], slips: [], runs: [], wrecks: [], slipped: new Set(), refused: {}, cleared: [] };
  const refuse = (why: string): void => { out.refused[why] = (out.refused[why] ?? 0) + 1; };
  const defOf = (id: string): BoatVehicleDefinition => {
    const def = reg.vehicle[reg.index.get(id) ?? -1];
    if (!def || !isBoatVehicle(def)) throw new Error(`harbours weighs ${id}, which is not a vessel of the content`);
    return def;
  };
  const lengthOf = (id: string): number => defOf(id).spec.halfLength * 2, beamOf = (id: string): number => defOf(id).spec.halfWidth * 2;
  for (const c of Object.values(D.classes)) for (const v of c.vessels) defOf(v);

  // What stands near the places: one pass over the statics, keeping those in a 64 m bin within reach of one.
  const near = new Set<number>(), reachOf = D.reach + 80;
  const mark = (x: number, z: number, r: number): void => {
    for (let bz = Math.floor((z - r) / 64); bz <= Math.floor((z + r) / 64); bz++) for (let bx = Math.floor((x - r) / 64); bx <= Math.floor((x + r) / 64); bx++) near.add(binKey(bx, bz));
  };
  const civilian = sites.filter((s) => s.kind === "civilian" && s.waterfront);
  for (const s of civilian) if (s.waterfront === "marina") mark(s.x, s.z, Math.max(reachOf, D.build.search + D.build.longest + 40, M.anchored.out[1] + 40));
  for (const p of piers) for (const q of p.points) mark(q[0], q[1], 40);
  // A street's furniture where a dock comes ashore gives way to it (a lamp, a bench, a rail): tagged with its index.
  const boxes = new Boxes();
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    if (!near.has(binKey(Math.floor(p.x / 64), Math.floor(p.z / 64)))) continue;
    const box = pieceBox(p, reg);
    if (box) boxes.add(box, isFurniture(p.kind) ? `furn:${i}` : "");
  }
  for (const b of keep) boxes.add(b, "");
  const isFurn = (t: string): boolean => t.startsWith("furn:");

  const water = (x: number, z: number): number => ground.waterAt(x, z);
  const depth = (x: number, z: number): number => ground.waterAt(x, z) - ground.groundAt(x, z);
  const boatsIn = new Map<number, number>(), meshesIn = new Map<number, Set<string>>(), burningIn = new Map<string, number>();
  let waterlines: ReadonlyMap<string, Waterline> | undefined;
  /** Whether a moored static of this mesh may be set down in the chunk at a point: its room, and the caps on boats and meshes. */
  const chunkTakes = (x: number, z: number, mesh: string): boolean => {
    const c = ground.chunk(x, z), set = meshesIn.get(c);
    return ground.room(x, z) && (boatsIn.get(c) ?? 0) < M.perChunk.boats && (set?.has(mesh) || (set?.size ?? 0) < M.perChunk.meshes);
  };
  const put = (p: StaticPiece, mesh?: string): void => {
    out.pieces.push(p); ground.took(p.x, p.z);
    if (mesh) {
      const c = ground.chunk(p.x, p.z);
      boatsIn.set(c, (boatsIn.get(c) ?? 0) + 1);
      if (!meshesIn.has(c)) meshesIn.set(c, new Set()); meshesIn.get(c)!.add(mesh);
    }
  };
  const hull = (id: string, x: number, z: number, yaw: number, grow: number): Box => {
    const def = defOf(id), y = boatRestY(def.spec, water(x, z));
    return { x, y: y + def.spec.height / 2, z, yaw, size: [def.spec.halfWidth * 2 + grow * 2, def.spec.height, def.spec.halfLength * 2 + grow * 2] };
  };
  /** Whether a hull floats there: the water under its middle, ends and corners deep enough for its draught and a margin. */
  const floats = (id: string, x: number, z: number, yaw: number, margin: number): boolean => {
    const def = defOf(id), hl = def.spec.halfLength, hw = def.spec.halfWidth, c = Math.cos(yaw * RAD), s = Math.sin(yaw * RAD);
    for (const [u, v] of [[0, 0], [0, hl], [0, -hl], [hw, hl * .6], [-hw, hl * .6], [hw, -hl * .6], [-hw, -hl * .6]] as const) {
      const px = x + u * c + v * s, pz = z - u * s + v * c;
      if (!ground.inside(px, pz, 4) || depth(px, pz) < def.spec.draft + margin) return false;
    }
    return true;
  };

  /**
   * A boat set down in a slip, alongside or at anchor, where it floats clear: a moored static, or now and then a wreck.
   * `tag` names the dock it lies against, which its hull may touch, or is null for none: the boxes of ordinary pieces and
   * swim lanes have no tag, which a boat at anchor once skipped as its own. Returns whether one was set down.
   */
  const moor = (site: BoatSite, district: string, id: string, vessel: string, x: number, z: number, yaw: number, how: Slip["how"], dock: Slip["dock"], tag: string | null, run: string): boolean => {
    const def = defOf(vessel);
    // Tied up by hand: a degree or two off its line, a hand's breadth off its berth's middle.
    const h = hashString(id, 1359), slack = how === "anchored" ? 0 : 1;
    yaw = ((yaw + slack * ((h % 7) - 3) * .5) % 360 + 360) % 360;
    const shift = slack * (((h >>> 8) % 5) - 2) * .04, across = (yaw + 90) * RAD;
    x += Math.sin(across) * shift; z += Math.cos(across) * shift;
    if (!floats(vessel, x, z, yaw, 0)) { refuse("shallow"); return false; }
    if (boxes.hits(hull(vessel, x, z, yaw, .3), 0, tag === null ? undefined : (t) => t === tag)) { refuse("blocked"); return false; }
    // A slip the found vessels' hash would take is left a hull, so more wrecks leave as many boats to find.
    const wreck = how !== "anchored" && reg.index.has(hulkOf(vessel)) && hashString(id, 1301) / 4294967296 < M.wrecked && hashString(id, 1341) / 4294967296 >= M.found;
    const form: HarbourWreckForm = depth(x, z) <= def.spec.height * .7 && depth(x, z) >= def.spec.draft + .3 && hashString(id, 1303) & 1 ? "sunk" : "damaged";
    const wreckMesh = made(formMesh(vessel, form)) ? formMesh(vessel, form) : vessel;
    // Where its chunk has its meshes already, the wreck is a hull left to rot, not an empty slip.
    if (wreck && chunkTakes(x, z, wreckMesh)) {
      const kind = made(formMesh(vessel, form)) ? hulkOf(vessel, form) : hulkOf(vessel), mesh = wreckMesh;
      // Afloat it rides low with water in it, at its form's own waterline, as the harbours' other wrecks do.
      const y = form === "sunk" ? ground.groundAt(x, z) : water(x, z) - waterlineOf(def.spec.draft, def.beltline, kind === hulkOf(vessel, form) ? (waterlines ??= formWaterlines()).get(vessel) : undefined);
      put({ kind, x, y, z, yaw }, mesh);
      out.wrecks.push({ kind, x, y, z, yaw, vessel, form, site: site.id, district, offshore: false });
      boxes.add(hull(vessel, x, z, yaw, .2), `boat:${id}`);
      return true;
    }
    if (!chunkTakes(x, z, vessel)) { refuse("chunk"); return false; }
    const paint = pick(MOORED_PAINTS[vessel]!, hashString(id, 1307));
    // A third lie as nobody would leave a boat: off their berth's line by up to `AWRY` degrees, where the hull still
    // floats clear, and low in the water with their deck near it. The slip keeps its own line, for a found vessel.
    let lies = yaw, sunk = 0;
    const state = hashString(id, 1361);
    if (state % 3 === 0) {
      const turned = ((yaw + ((state >>> 4) % 2 ? 1 : -1) * (AWRY / 2 + ((state >>> 8) % 100) / 100 * AWRY / 2)) % 360 + 360) % 360;
      if (how !== "anchored" && floats(vessel, x, z, turned, 0) && !boxes.hits(hull(vessel, x, z, turned, .3), 0, tag === null ? undefined : (t) => t === tag)) lies = turned;
      sunk = Math.max(0, Math.min((def.spec.height - def.spec.draft) * (AWASH[0] + ((state >>> 16) % 100) / 100 * (AWASH[1] - AWASH[0])), depth(x, z) - def.spec.draft - .05));
    }
    // A few burn, afloat at their own height so the fire stands on a deck.
    const burns = M.burning !== undefined && hashString(id, 1363) / 4294967296 < M.burning.share && (burningIn.get(site.id) ?? 0) < M.burning.most && reg.index.has(burningKind(vessel));
    if (burns) burningIn.set(site.id, (burningIn.get(site.id) ?? 0) + 1);
    put({ kind: burns ? burningKind(vessel) : mooredKind(vessel, paint), x, y: boatRestY(def.spec, water(x, z)) - (burns ? 0 : sunk), z, yaw: lies }, vessel);
    boxes.add(hull(vessel, x, z, lies, .2), `boat:${id}`);
    out.slips.push({ id, site: site.id, district, vessel, x, z, yaw, found: false, how, dock, run });
    return true;
  };

  // The runs a survivor reaches on foot, by marina and run: only their slips hold found vessels. And the pieces of the
  // runs it does not, taken up again.
  const walkable = new Set<string>(), gone = new Set<number>();
  // The street furniture each run came ashore over, by its tag, and how many runs still standing did.
  const clearedBy = new Map<string, number>();
  /** A run taken up: its pieces, its boxes, its chunks' room and the furniture it cleared that no other run did. */
  const takeUp = (run: RunPart): void => {
    for (let i = run.pieces[0]; i < run.pieces[1]; i++) { gone.add(i); ground.gave(out.pieces[i]!.x, out.pieces[i]!.z); }
    boxes.gone.add(run.tag);
    for (const t of run.cleared) {
      const n = clearedBy.get(t)! - 1;
      clearedBy.set(t, n);
      if (n === 0) boxes.gone.delete(t);
    }
  };
  // Each marina in turn, in the order of its id's hash.
  const order = civilian.filter((s) => s.waterfront === "marina").sort((a, b) => hashString(a.id) - hashString(b.id) || a.id.localeCompare(b.id));
  for (const site of order) {
    // A marina whose point is off the map, a cut's or the city's, is laid out by the map that holds it.
    if (!ground.inside(site.x, site.z, 0)) continue;
    const district = districtAt(site.x, site.z), dname = district?.name ?? "";
    const mix = siteMix(site, rules, district, lengthOf);
    if (mix.length === 0) continue;
    const H = round(water(site.x, site.z) + DOCK.height);
    const lines: { id: string; points: [number, number][]; finger: boolean }[] = [];
    const mapped = docks.get(site.id) ?? [];
    for (const [i, p] of mapped.entries()) lines.push({ id: `${p.way.id}${mapped.filter((q) => q.way.id === p.way.id).length > 1 ? `.${i}` : ""}`, points: p.points.map((q) => [q[0], q[1]]), finger: false });
    if (lines.length === 0 && !site.building) {
      const made = walkwayFrom(site, ground, boxes, D, H);
      if (made) lines.push({ id: "built", points: made, finger: false }); else refuse("no bank");
    }
    if (lines.length === 0) continue;
    // Longest first; a short one that meets another is a finger.
    const lengthOfLine = (l: { points: [number, number][] }): number => l.points.slice(1).reduce((n, p, k) => n + Math.hypot(p[0] - l.points[k]![0], p[1] - l.points[k]![1]), 0);
    lines.sort((a, b) => lengthOfLine(b) - lengthOfLine(a) || a.id.localeCompare(b.id));
    for (const l of lines) {
      const ends = [l.points[0]!, l.points.at(-1)!];
      // A finger mapped as an area is its long axis, which ends a few metres short of the walkway's line.
      l.finger = lengthOfLine(l) <= D.finger && lines.some((o) => o !== l && lengthOfLine(o) > lengthOfLine(l) && o.points.some((q, k) => k > 0 && ends.some((e) => segmentDistance(e, o.points[k - 1]!, q) < 6)));
    }
    let slips = 0;
    const tagOf = (run: string): string => `dock:${site.id}:${run}`;
    type Stretch = { run: string; from: [number, number]; d: [number, number]; length: number; outer: boolean };
    const laid: { id: string; finger: boolean; record: DockRun; stretches: Stretch[]; part: RunPart }[] = [];
    for (const l of lines) {
      // The land end first: the end whose ground stands higher.
      let pts = l.points;
      if (ground.groundAt(pts[0]![0], pts[0]![1]) < ground.groundAt(pts.at(-1)![0], pts.at(-1)![1])) pts = [...pts].reverse();
      for (const run of layRun(l.id, pts, l.finger ? "finger" : "walk", H, tagOf(l.id))) {
        // A part all ashore, its way out to the water broken, leads nowhere: it is taken up.
        if (run.points.every((p) => depth(p.x, p.z) <= .2)) { takeUp(run); continue; }
        const record: DockRun = { site: site.id, id: run.id, finger: l.finger, points: run.points, landed: run.landed, joins: run.joins };
        laid.push({ id: run.id, finger: l.finger, record, stretches: run.stretches.map((s) => ({ ...s, run: run.id })), part: run });
      }
    }
    // Two runs are one dock where either ran onto the other's deck.
    const joined = (a: (typeof laid)[number], b: (typeof laid)[number]): boolean => a.record.joins.includes(b.id) || b.record.joins.includes(a.id);
    // Which runs a survivor walks onto from the land: those on it, and those that meet a reached run's deck. A run
    // neither reaches is joined by a walkway to the nearest land or reached run within 30 m, if there is one; one
    // still out of reach is taken up again, with nothing moored at it.
    const reached = new Set<string>(laid.filter((r) => r.record.landed).map((r) => r.id));
    // A module meets a run when its middle is within a walkway's half width and a module's half length of the run's
    // line: a finger's end at a walkway's side, two walkways crossing.
    const meetsReached = (p: { x: number; z: number }): boolean => laid.some((o) => reached.has(o.id) && o.record.points.some((q, k) => segmentDistance([p.x, p.z], [q.x, q.z], [o.record.points[Math.min(k + 1, o.record.points.length - 1)]!.x, o.record.points[Math.min(k + 1, o.record.points.length - 1)]!.z]) < JOINT));
    const spread = (): void => {
      for (let grew = true; grew;) {
        grew = false;
        for (const r of laid) if (!reached.has(r.id) && (laid.some((o) => reached.has(o.id) && joined(r, o)) || r.record.points.some(meetsReached))) { reached.add(r.id); grew = true; }
      }
    };
    spread();
    for (const r of laid) {
      if (reached.has(r.id)) continue;
      const joint = joinRun(r.record.points, (x, z) => depth(x, z) <= .2 || meetsReached({ x, z }), tagOf(r.id));
      if (!joint) { refuse("unreached run"); continue; }
      // An unbroken one, or none: a link with a module left out reaches nothing, and is taken up.
      const parts = layRun(`${r.id}/link`, joint, "walk", H, tagOf(`${r.id}/link`)), link = parts[0];
      if (parts.length !== 1 || !link) { for (const p of parts) takeUp(p); refuse("unreached run"); continue; }
      out.runs.push({ site: site.id, id: link.id, finger: false, points: link.points, landed: link.landed, joins: [...link.joins, r.id] });
      reached.add(r.id);
      spread();
    }
    for (const r of laid) {
      if (!reached.has(r.id)) { takeUp(r.part); continue; }
      out.runs.push(r.record);
      walkable.add(`${site.id}:${r.id}`);
    }
    const stretches: Stretch[] = laid.filter((r) => !r.finger && reached.has(r.id)).flatMap((r) => r.stretches);
    for (const r of laid.filter((r) => r.finger && reached.has(r.id))) {
      // Boats alongside a mapped finger, either side, bow toward its root.
      for (const s of r.stretches) for (const side of [1, -1]) {
        const id = `${site.id}#${r.id}/${side}`;
        if (hashString(id, 1311) / 4294967296 >= M.fill) continue;
        const vessel = drawSized(mix, id, s.length + 3);
        if (!vessel) continue;
        // Its stern at the finger's tip, its bow toward the root.
        const along = Math.max(lengthOf(vessel) / 2, s.length - lengthOf(vessel) / 2), across = side * (DOCK.finger / 2 + D.gap + beamOf(vessel) / 2);
        const b = lineBox(s.from, s.d, along, across, 0, [0, 0, 0]), dock = lineBox(s.from, s.d, along, 0, H, [0, 0, 0]);
        if (moor(site, dname, id, vessel, b.x, b.z, yawOf(-s.d[0], -s.d[1]), "alongside", { x: dock.x, y: H, z: dock.z }, tagOf(r.id), r.id)) slips++;
      }
    }
    // Slips off each side of each walkway's level stretch over the water, a class a side, fingers between them.
    for (const s of stretches) for (const side of [1, -1]) {
      const sideId = `${site.id}#${s.run}@${s.from[0].toFixed(0)},${s.from[1].toFixed(0)}/${side}`;
      const cls = drawClass(mix, sideId);
      if (!cls) continue;
      const [, c] = cls, pool = c.vessels.filter((v) => mix.some(([m]) => m === v));
      const weighed = pool.map((v) => [v, mix.find(([m]) => m === v)![1]] as const);
      if (!c.finger) {
        // The big ones alongside the walkway, end to end.
        let t = 2;
        for (let k = 0; t < s.length - 2; k++) {
          const id = `${sideId}#${k}`, vessel = pick(weighed, hashString(id, 1313));
          const len = lengthOf(vessel);
          if (t + len > s.length - 1) break;
          const across = side * (DOCK.walk / 2 + D.gap + beamOf(vessel) / 2), b = lineBox(s.from, s.d, t + len / 2, across, 0, [0, 0, 0]);
          const dock = lineBox(s.from, s.d, t + len / 2, side * (DOCK.walk / 2 - .5), H, [0, 0, 0]);
          if (hashString(id, 1311) / 4294967296 < M.fill && moor(site, dname, id, vessel, b.x, b.z, yawOf(s.d[0], s.d[1]) + (hashString(id, 1317) & 1 ? 180 : 0), "alongside", { x: dock.x, y: H, z: dock.z }, tagOf(s.run), s.run)) slips++;
          t += len + 3;
        }
        continue;
      }
      const pitch = Math.max(...pool.map(beamOf)) + D.gap * 2 + DOCK.finger, F = c.finger, longest = Math.max(...pool.map(lengthOf));
      // A finger at each pitch, if it stands over the water and clear; a slip between two that stand.
      let last: number | null = null;
      for (let k = 0, t = DOCK.finger / 2 + .5; t <= s.length - DOCK.finger / 2 - .5; k++, t += pitch) {
        const fingerTag = tagOf(`${s.run}/f${side}/${k}`);
        const stands = layFinger(s.from, s.d, t, side, F, H, fingerTag, tagOf(s.run));
        if (stands && last !== null && Math.abs(t - last - pitch) < .01) {
          const id = `${sideId}#${k}`, between = t - pitch / 2;
          if (hashString(id, 1311) / 4294967296 < M.fill) {
            const vessel = pick(weighed, hashString(id, 1319));
            const len = lengthOf(vessel), sternTo = hashString(id, 1321) / 4294967296 < M.sternTo;
            // Tied up to the finger its survivor boards from, the slip's water past its other side.
            const across = side * (DOCK.walk / 2 + D.gap + len / 2), b = lineBox(s.from, s.d, t - DOCK.finger / 2 - D.gap - beamOf(vessel) / 2, across, 0, [0, 0, 0]);
            // Its mouth's water: past its row's longest, the share of the fairway it keeps, which the row across shares.
            const mouth = lineBox(s.from, s.d, between, side * (DOCK.walk / 2 + D.gap + longest + longest * D.fairway / 2), H - 1, [pitch, 2, longest * D.fairway], true);
            // Bow-in its bow points at the walkway; a survivor boards from the finger beside it, halfway along it.
            const inward = yawOf(-side * s.d[1], side * s.d[0]);
            const dock = lineBox(s.from, s.d, t, side * (DOCK.walk / 2 + Math.min(F, len) / 2), H, [0, 0, 0]);
            if (depth(mouth.x, mouth.z) < .5 || boxes.hits(mouth, 0, (tag) => tag.startsWith("fair:"))) refuse("fairway");
            else if (moor(site, dname, id, vessel, b.x, b.z, sternTo ? inward + 180 : inward, sternTo ? "stern-to" : "slip", { x: dock.x, y: H, z: dock.z }, fingerTag, s.run)) { slips++; boxes.add(mouth, `fair:${id}`); }
          }
        }
        last = stands ? t : null;
      }
    }
    // A T-head at a walkway's outer end over deep water, a big boat across its face.
    for (const s of stretches.filter((r) => r.outer && r.length >= D.tee)) {
      const id = `${site.id}#${s.run}/tee`, big = (D.classes.alongside?.vessels ?? []).filter((v) => mix.some(([m]) => m === v));
      const vessel = big.length ? pick(big.map((v) => [v, mix.find(([m]) => m === v)![1]] as const), hashString(id, 1323)) : drawSized(mix, id, 18);
      if (!vessel) continue;
      const len = lengthOf(vessel), half = Math.ceil((len / 2 + 1.5) / DOCK.length) * DOCK.length;
      const end: [number, number] = [s.from[0] + s.d[0] * s.length, s.from[1] + s.d[1] * s.length];
      const across: [number, number] = [s.d[1], -s.d[0]];
      const tee: Box[] = [];
      for (let t = -half + DOCK.length / 2; t < half; t += DOCK.length) tee.push(lineBox(end, across, t, -(DOCK.walk / 2), H - DOCK.deck / 2, [DOCK.walk, DOCK.deck, DOCK.length]));
      if (tee.some((b) => depth(b.x, b.z) < 1 || boxes.hits({ ...b, y: H + (HEADROOM - DOCK.deck) / 2, size: [b.size[0], DOCK.deck + HEADROOM, b.size[2]] }, .3, (tag) => tag === tagOf(s.run)) || !ground.room(b.x, b.z))) { refuse("tee"); continue; }
      for (const b of tee) { put({ kind: DOCK_KINDS.walk, x: b.x, y: H, z: b.z, yaw: b.yaw }); boxes.add(b, tagOf(`${s.run}/tee`)); }
      out.runs.push({ site: site.id, id: `${s.run}/tee`, finger: false, points: tee.map((b) => ({ x: b.x, y: H, z: b.z })), landed: false, joins: [s.run] });
      const b = lineBox(end, s.d, DOCK.walk + D.gap + beamOf(vessel) / 2, 0, 0, [0, 0, 0]), dock = lineBox(end, s.d, DOCK.walk - .6, 0, H, [0, 0, 0]);
      if (moor(site, dname, id, vessel, b.x, b.z, yawOf(across[0], across[1]) + (hashString(id, 1317) & 1 ? 180 : 0), "tee", { x: dock.x, y: H, z: dock.z }, tagOf(`${s.run}/tee`), s.run)) slips++;
    }
    if (slips > 0) out.slipped.add(site.id);
    // A few at anchor off it, all heading into the wind.
    const anchored = M.anchored;
    if (hashString(site.id, 1327) / 4294967296 < anchored.share) {
      const want = anchored.least + hashString(site.id, 1329) % Math.max(1, anchored.most - anchored.least + 1);
      let set = 0;
      for (let k = 0; k < want * 6 && set < want; k++) {
        const id = `${site.id}#anchor${k}`, h = hashString(id, 1331);
        const angle = (h % 360) * RAD, r = anchored.out[0] + (hashString(id, 1333) / 4294967296) * (anchored.out[1] - anchored.out[0]);
        const x = site.x + Math.sin(angle) * r, z = site.z + Math.cos(angle) * r, d = depth(x, z);
        if (d < anchored.depth[0] || d > anchored.depth[1]) continue;
        const vessel = drawSized(mix, id, 24);
        if (!vessel) continue;
        const yaw = anchored.heading + ((hashString(id, 1337) % (2 * anchored.swing + 1)) - anchored.swing);
        if (moor(site, dname, id, vessel, x, z, yaw, "anchored", null, null, "")) set++;
      }
    }
  }

  if (gone.size) out.pieces = out.pieces.filter((_, i) => !gone.has(i));
  // Choose each marina's found vessels among its filled slips, the rest staying scenery: by a hash, between the bounds.
  // (A found vessel's slip holds no static: those set down above are taken back out for it.)
  const bySite = new Map<string, Slip[]>();
  for (const s of out.slips) if (s.how !== "anchored") { if (!bySite.has(s.site)) bySite.set(s.site, []); bySite.get(s.site)!.push(s); }
  const taken = new Set<string>();
  for (const list of bySite.values()) {
    const ranked = list.filter((s) => s.dock && walkable.has(`${s.site}:${s.run}`) && floats(s.vessel, s.x, s.z, s.yaw, .2)).sort((a, b) => hashString(a.id, 1339) - hashString(b.id, 1339) || a.id.localeCompare(b.id));
    const share = ranked.filter((s) => hashString(s.id, 1341) / 4294967296 < M.found);
    const want = Math.min(rules.marina.most, Math.max(rules.marina.least, share.length), ranked.length);
    for (const s of [...share, ...ranked.filter((s) => !share.includes(s))].slice(0, want)) { s.found = true; taken.add(s.id); }
  }
  if (taken.size) {
    const drop = new Set(out.slips.filter((s) => taken.has(s.id)).map((s) => `${s.x},${s.z}`));
    out.pieces = out.pieces.filter((p) => !(p.kind.startsWith("core:zzzzhull_") && drop.has(`${p.x},${p.z}`)));
  }

  // Beside the other piers: a share hold a boat or two alongside, toward their outer ends, off one side.
  for (const p of [...piers].sort((a, b) => a.way.id - b.way.id)) {
    const id = `pier/${p.way.id}@${p.points[0]![0].toFixed(0)},${p.points[0]![1].toFixed(0)}`;
    if (hashString(id, 1343) / 4294967296 >= M.piers.share || p.points.length < 2) continue;
    let pts = p.points;
    if (ground.groundAt(pts[0]![0], pts[0]![1]) < ground.groundAt(pts.at(-1)![0], pts.at(-1)![1])) pts = [...pts].reverse();
    const [a, b] = [pts.at(-2)!, pts.at(-1)!], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 8) continue;
    const d: [number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const site: BoatSite = { id, kind: "civilian", x: b[0], z: b[1], radius: 48, waterfront: "pier" };
    const district = districtAt(b[0], b[1]), mix = siteMix(site, rules, district, lengthOf).filter(([v]) => lengthOf(v) <= M.piers.longest);
    if (!mix.length) continue;
    const side = hashString(id, 1347) & 1 ? 1 : -1, want = 1 + hashString(id, 1349) % M.piers.most;
    let t = len - 1.5;
    for (let k = 0; k < want; k++) {
      const vid = `${id}#${k}`, vessel = pick(mix, hashString(vid, 1351)), l = lengthOf(vessel);
      if (t - l < 2) break;
      const across = side * (p.width / 2 + D.gap + beamOf(vessel) / 2), at = lineBox(a, d, t - l / 2, across, 0, [0, 0, 0]);
      moor(site, district?.name ?? "", vid, vessel, at.x, at.z, yawOf(d[0], d[1]) + (hashString(vid, 1317) & 1 ? 180 : 0), "pier", null, null, "");
      t -= l + 2;
    }
  }
  out.cleared = [...clearedBy].filter(([, n]) => n > 0).map(([t]) => Number(t.slice(5)));
  return out;

  /**
   * One run of modules along a line from its land end, each 3 m: its deck at the dock's height over the water and at
   * least 0.1 m over the ground, never more than a ramp's fall from one module's end to the next, so it comes down from
   * the bank on ramps. Modules a piece already stands in are left out. Its level stretches over the water are its slips'.
   */
  function layRun(id: string, points: readonly [number, number][], part: "walk" | "finger", H: number, tag: string): RunPart[] {
    const modules: { x: number; z: number; d: [number, number]; at: number; seg: number; pitch: number }[] = [];
    // A main walkway mapped to end short of the bank reaches back to it, up to 12 m, so a survivor walks on from the land.
    const [p0, p1] = [points[0]!, points[1]!], l0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (part === "walk" && l0 > 0 && depth(p0[0], p0[1]) > .2) {
      const back: [number, number] = [(p0[0] - p1[0]) / l0, (p0[1] - p1[1]) / l0];
      for (let r = 1; r <= 12; r++) {
        const q: [number, number] = [p0[0] + back[0] * r, p0[1] + back[1] * r];
        if (depth(q[0], q[1]) <= .2) { points = [[q[0] + back[0] * 1.5, q[1] + back[1] * 1.5], ...points]; break; }
      }
    }
    let run = 0;
    for (let k = 1; k < points.length; k++) {
      const [a, b] = [points[k - 1]!, points[k]!], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1) continue;
      const d: [number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n = Math.max(1, Math.ceil(len / DOCK.length - .05));
      for (let i = 0; i < n; i++) {
        const t = (i + .5) * len / n;
        modules.push({ x: a[0] + d[0] * t, z: a[1] + d[1] * t, d, at: run + t, seg: k, pitch: len / n });
      }
      run += len;
    }
    if (modules.length === 0) return [];
    // Each module's ends' heights: the dock's over the water, and over the land 0.1 m over the ground, so it meets low
    // land on ramps as it meets a high bank; then no more than a fall apart, raised where they are, and set on the
    // fall's steps from the dock's height.
    const ends = new Float64Array(modules.length + 1);
    const at = (i: number): [number, number] => {
      const m = modules[Math.min(i, modules.length - 1)]!, sign = i < modules.length ? -1 : 1;
      return [m.x + m.d[0] * sign * DOCK.length / 2, m.z + m.d[1] * sign * DOCK.length / 2];
    };
    for (let i = 0; i <= modules.length; i++) {
      const [x, z] = at(i);
      ends[i] = depth(x, z) > .2 ? Math.max(H, ground.groundAt(x, z) + .1) : ground.groundAt(x, z) + .1;
    }
    for (let pass = 0; pass < 2; pass++) for (let i = 1; i <= modules.length; i++) {
      const j = pass ? modules.length - i : i, k = pass ? j + 1 : j - 1;
      ends[j] = Math.max(ends[j]!, ends[k]! - DOCK.fall);
    }
    for (let i = 0; i <= modules.length; i++) ends[i] = H + Math.ceil((ends[i]! - H) / DOCK.fall - 1e-6) * DOCK.fall;
    for (let i = 1; i <= modules.length; i++) ends[i] = Math.min(ends[i]!, ends[i - 1]! + DOCK.fall), ends[i] = Math.max(ends[i]!, ends[i - 1]! - DOCK.fall);
    const width = part === "walk" ? DOCK.walk : DOCK.finger;
    // A module left out breaks the run: each unbroken part is a run of its own (the second `<id>~1`), reached or not as
    // itself, its modules under its own tag.
    const parts: RunPart[] = [];
    const fresh = (): RunPart => {
      const k = parts.length;
      return { id: k ? `${id}~${k}` : id, tag: k ? `${tag}~${k}` : tag, points: [], stretches: [], landed: false, joins: [], pieces: [out.pieces.length, out.pieces.length], cleared: [] };
    };
    let now = fresh();
    const joins = new Set<string>();
    const breakRun = (): void => {
      if (now.points.length) { now.joins = [...joins]; now.pieces[1] = out.pieces.length; parts.push(now); }
      joins.clear();
      now = fresh();
    };
    let level: { from: number; to: number; d: [number, number]; seg: number } | null = null;
    const close = (): void => {
      if (level && level.to > level.from) {
        // From the first module's back edge to the last's front edge, as they stand: a pitch apart, overlapping.
        const m = modules[level.from]!;
        now.stretches.push({ from: [m.x - m.d[0] * DOCK.length / 2, m.z - m.d[1] * DOCK.length / 2], d: level.d, length: (level.to - level.from) * m.pitch + DOCK.length, outer: level.to === modules.length - 1 });
      }
      level = null;
    };
    for (let i = 0; i < modules.length; i++) {
      const m = modules[i]!, lo = ends[i]!, hi = ends[i + 1]!, y = (lo + hi) / 2;
      const ramp = Math.abs(lo - hi) > 1e-6, kind = ramp ? DOCK_KINDS.ramp : DOCK_KINDS[part as DockPart];
      // A ramp falls toward its +Z: along the line where its far end is lower.
      const yaw = ramp && hi > lo ? yawOf(-m.d[0], -m.d[1]) : yawOf(m.d[0], m.d[1]);
      const box: Box = { x: m.x, y: y - DOCK.deck / 2, z: m.z, yaw, size: [width, DOCK.deck, DOCK.length] };
      // Ashore, a street's furniture in its way gives way to it; anything else it stands in leaves it out.
      const dry = depth(m.x, m.z) < .2;
      // The deck and a survivor's headroom over it: nothing may stand in either, but another run of this marina's docks,
      // which it runs onto (the two one dock there, and the walk going on across it), and ashore a street's furniture.
      const inner: Box = { ...box, y: y + (HEADROOM - DOCK.deck) / 2, size: [width - .6, DOCK.deck + HEADROOM, DOCK.length - .6] };
      const mine = tag.slice(0, tag.lastIndexOf(":") + 1), onto = boxes.tags(inner, (t) => t.startsWith(mine) && t !== now.tag);
      if (!ground.inside(m.x, m.z, 4) || !ground.room(m.x, m.z) || boxes.hits(inner, 0, (t) => t.startsWith(mine) || (dry && isFurn(t)))) { refuse(dry ? "module on land" : "module"); close(); breakRun(); continue; }
      for (const t of onto) joins.add(t.slice(mine.length));
      if (dry) for (const t of boxes.tags({ ...box, y: box.y + 1, size: [width + .4, DOCK.deck + 2, DOCK.length] }, isFurn)) { boxes.gone.add(t); clearedBy.set(t, (clearedBy.get(t) ?? 0) + 1); now.cleared.push(t); }
      if (dry) now.landed = true;
      // Modules overlap where a line's length is not a whole number of them, and where a run meets another: every other
      // one stands a sixty-fourth lower, and one that runs onto another run a thirty-second, so no two decks share a plane.
      put({ kind, x: round(m.x), y: round(y) - (i % 2) / 64 - (onto.size ? 1 / 32 : 0), z: round(m.z), yaw: round(yaw, 1 / 16) });
      boxes.add(box, now.tag);
      now.points.push({ x: m.x, y, z: m.z });
      const flat = !ramp && Math.abs(lo - H) < 1e-6 && depth(m.x, m.z) > 1;
      if (flat && level && level.seg === m.seg && level.to === i - 1) level.to = i;
      else { close(); if (flat) level = { from: i, to: i, d: m.d, seg: m.seg }; }
    }
    close();
    breakRun();
    return parts;
  }

  /** A finger `t` metres along a stretch, off its `side`, `length` metres out from the walkway's edge, its pile at the tip. */
  function layFinger(from: [number, number], d: [number, number], t: number, side: number, length: number, H: number, tag: string, parent: string): boolean {
    const n = Math.max(1, Math.round(length / DOCK.length)), boxesOf: Box[] = [];
    for (let j = 0; j < n; j++) {
      const across = side * (DOCK.walk / 2 + DOCK.length * (j + .5));
      const b = lineBox(from, d, t, across, H - DOCK.deck / 2, [DOCK.finger, DOCK.deck, DOCK.length], true);
      // The finger's +Z out from the walkway.
      boxesOf.push({ ...b, yaw: yawOf(d[1] * side, -d[0] * side) });
    }
    const tip = lineBox(from, d, t, side * (DOCK.walk / 2 + n * DOCK.length - DOCK.pile / 2 - .05), H, [DOCK.pile, 4, DOCK.pile]);
    const room = (b: Box): Box => ({ ...b, y: H + (HEADROOM - DOCK.deck) / 2, size: [b.size[0], DOCK.deck + HEADROOM, b.size[2]] });
    if (boxesOf.some((b) => depth(b.x, b.z) < .6 || !ground.room(b.x, b.z) || boxes.hits(room(b), .2, (q) => q === parent || q === tag))) return false;
    for (const b of boxesOf) { put({ kind: DOCK_KINDS.finger, x: round(b.x), y: round(H), z: round(b.z), yaw: round(b.yaw, 1 / 16) }); boxes.add(b, tag); }
    if (ground.room(tip.x, tip.z)) put({ kind: DOCK_KINDS.pile, x: round(tip.x), y: round(H), z: round(tip.z), yaw: 0 });
    return true;
  }

  /**
   * A walkway joining a run to what `reaches` (the land, or a reached run's deck) within 30 m, square off one of
   * its modules or straight on from an end: from just past the place reached to the run's middle line, or null.
   */
  function joinRun(points: DockRun["points"], reaches: (x: number, z: number) => boolean, tag: string): [number, number][] | null {
    let best: { length: number; line: [number, number][] } | null = null;
    for (let k = 0; k < points.length; k++) {
      const p = points[k]!, q = points[Math.min(k + 1, points.length - 1)]!, o = points[Math.max(k - 1, 0)]!;
      const dx = q.x - o.x, dz = q.z - o.z, l = Math.hypot(dx, dz);
      if (l < 1e-6) continue;
      const along: [number, number] = [dx / l, dz / l];
      // Square off any module; from an end, also straight on and half a right angle either side of it, round
      // whatever stands where the run meets the bank.
      const end = k === 0 ? [-along[0], -along[1]] : k === points.length - 1 ? along : null;
      const s = Math.SQRT1_2;
      const ways: [number, number][] = [[along[1], -along[0]], [-along[1], along[0]], ...(end ? [[end[0]!, end[1]!], [(end[0]! + end[1]!) * s, (end[1]! - end[0]!) * s], [(end[0]! - end[1]!) * s, (end[1]! + end[0]!) * s]] as [number, number][] : [])];
      for (const [ux, uz] of ways) for (let r = 1.5; r <= 30 && (!best || r < best.length); r += .5) {
        const x = p.x + ux * r, z = p.z + uz * r;
        if (boxes.hits({ x, y: p.y + (HEADROOM - DOCK.deck) / 2, z, yaw: yawOf(ux, uz), size: [DOCK.walk - .6, DOCK.deck + HEADROOM, .5] }, 0, (t) => t === tag || t.startsWith("dock:") || isFurn(t))) break;
        if (reaches(x, z)) { best = { length: r, line: [[x + ux * 1.5, z + uz * 1.5], [p.x, p.z]] }; break; }
      }
    }
    return best?.line ?? null;
  }

  /** A slip class for a walkway's side, by the summed weights of the site's vessels in each. */
  function drawClass(mix: readonly [string, number][], id: string): readonly [string, DockRules["classes"][string]] | null {
    const rows = Object.entries(D.classes).map(([name, c]) => [[name, c], c.vessels.reduce((n, v) => n + (mix.find(([m]) => m === v)?.[1] ?? 0), 0)] as const).filter(([, w]) => w > 0);
    return rows.length ? pick(rows, hashString(id, 1353)) : null;
  }
  /** A vessel of the site's weights no longer than `longest`, or null. */
  function drawSized(mix: readonly [string, number][], id: string, longest: number): string | null {
    const rows = mix.filter(([v]) => lengthOf(v) <= longest);
    return rows.length ? pick(rows, hashString(id, 1357)) : null;
  }
}

/** The distance from a point to a segment. */
function segmentDistance(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}

/**
 * A walkway for a marina that maps none: from the bank nearest its point, out along the bearing with the most open water
 * before it, from 4 m inland to 20 m short of the far side or of anything in the way, at most `build.longest`.
 */
function walkwayFrom(site: BoatSite, ground: MarinaGround, boxes: Boxes, D: DockRules, H: number): [number, number][] | null {
  const depth = (x: number, z: number): number => ground.waterAt(x, z) - ground.groundAt(x, z);
  let best: { score: number; line: [number, number][] } | null = null;
  for (let k = 0; k < 32; k++) {
    const a = (k * Math.PI) / 16, d: [number, number] = [Math.sin(a), Math.cos(a)];
    // From the point out to the first water a metre deep with land behind it.
    let bank = -1;
    for (let r = 0; r <= D.build.search; r += 2) {
      const x = site.x + d[0] * r, z = site.z + d[1] * r;
      if (!ground.inside(x, z, 8)) break;
      if (depth(x, z) > 1 && r >= 2 && depth(site.x + d[0] * (r - 4), site.z + d[1] * (r - 4)) < .2) { bank = r; break; }
    }
    if (bank < 0) continue;
    let open = 0;
    for (let r = 0; r <= D.build.longest + 20; r += 2) {
      const x = site.x + d[0] * (bank + r), z = site.z + d[1] * (bank + r);
      const box: Box = { x, y: H, z, yaw: 0, size: [DOCK.walk + 12, 2, 2] };
      if (!ground.inside(x, z, 8) || depth(x, z) < 1.2 || boxes.hits(box)) break;
      open = r;
    }
    const length = Math.min(D.build.longest, open - 20);
    if (length < D.build.shortest) continue;
    const score = length - bank * .5;
    if (!best || score > best.score) best = { score, line: [[site.x + d[0] * (bank - 4), site.z + d[1] * (bank - 4)], [site.x + d[0] * (bank + length), site.z + d[1] * (bank + length)]] };
  }
  return best?.line ?? null;
}
