// Actual native body/armor/hair vertices at authored cruise bottlenecks, using selected feasible profiles
// and walking poses. This is sampled coverage, not a proof over all creator parameters or animation states.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CRUISE_COLLISION_INSTANCES, CRUISE_COLLISION_PROTOTYPES, CRUISE_LAYOUT } from "../../content/landmarks/cruise.ts";
import { cruiseAccessRoutes, cruiseTuple } from "../../content/landmarks/cruise-layout.ts";
import { STRUCT_UNITS, YAW_UNITS } from "../../shared/coords.ts";
import { SKIN } from "../../shared/world/collide.ts";
import { Solid, boxSolid, hullTable, partSolid } from "../../shared/world/convex.ts";
import { frame, frameOf } from "../../shared/world/frame.ts";
import { cruiseBodyVertices, type CruiseBodyPose, type CruiseBodyVertex } from "./cruise-body.ts";

interface FitSolid { id: string; support: boolean; min: number[]; max: number[]; planes: number[][] }
export interface CruiseFitSpot { readonly id: string; readonly feet: readonly number[]; readonly yaw: number }
export interface CruiseFitCase { readonly pose: CruiseBodyPose; readonly profile: number }
const sideways: CruiseBodyPose = { value: 0, mesh: "", sex: "m", speed: 4.5, direction: 11, pitch: 25, phase: 31 / 32 };
export const CRUISE_FIT_CASES: readonly CruiseFitCase[] = [
  { pose: sideways, profile: 34 }, { pose: sideways, profile: 41 }, { pose: { ...sideways, sex: "f" }, profile: 2 },
  { pose: { ...sideways, speed: 7.2, direction: 4, pitch: -31, phase: 13 / 32 }, profile: 31 },
  { pose: { ...sideways, direction: 5, pitch: 23, phase: .625 }, profile: 41 },
];
const CELL = 8;
let cells: Map<string, FitSolid[]> | undefined;
const poses = new Map<string, readonly CruiseBodyVertex[]>();

export function cruiseFitSources(): Record<string, string> {
  const files = ["content/landmarks/cruise-layout.json", "assets/source/landmarks/cruise/cruise.snpk",
    "assets/source/core/humans/human-bodies/human-bodies.snpk", "assets/source/core/humans/human-clips/human-clips.snpk",
    "tools/art/cruise-body.ts", "tools/art/cruise-fit.ts", "client/core/render/characters.ts",
    "shared/anim/pose.ts", "shared/anim/look.ts", "shared/anim/gait.ts", "shared/anim/skeleton.ts", "shared/anim/human.ts",
    "shared/world/convex.ts", "shared/world/frame.ts", "shared/world/collide.ts"];
  return Object.fromEntries(files.map(path => [path, createHash("sha256").update(readFileSync(resolve(import.meta.dir, "../..", path))).digest("hex")]));
}

function geometry(): Map<string, FitSolid[]> {
  if (cells) return cells;
  const grid = new Map<string, FitSolid[]>(), prototypes = CRUISE_COLLISION_PROTOTYPES;
  const byId = new Map(prototypes.map((p, i) => [p.id, i]));
  const hulls = hullTable(prototypes.length, i => (prototypes[i]!.hulls ?? []).map(h => ({ corners: h.points.map(cruiseTuple) })));
  const open = new Map(CRUISE_LAYOUT.doors.map(d => [d.instanceId, d.openPrototype]));
  const add = (id: string, solid: Solid, support: boolean) => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], planes: number[][] = [];
    for (let v = 0; v < solid.corners; v++) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a]!, solid.at[v * 3 + a]!); max[a] = Math.max(max[a]!, solid.at[v * 3 + a]!); }
    for (let f = 0; f < solid.faces; f++) {
      const n = Array.from(solid.face.subarray(f * 3, f * 3 + 3)); let lo = Infinity, hi = -Infinity;
      for (let v = 0; v < solid.corners; v++) { const d = n.reduce((s, x, a) => s + x * solid.at[v * 3 + a]!, 0); lo = Math.min(lo, d); hi = Math.max(hi, d); }
      planes.push([...n, lo, hi]);
    }
    const entry = { id, support, min, max, planes };
    for (let x = Math.floor(min[0]! / CELL); x <= Math.floor(max[0]! / CELL); x++)
      for (let y = Math.floor(min[1]! / CELL); y <= Math.floor(max[1]! / CELL); y++)
        for (let z = Math.floor(min[2]! / CELL); z <= Math.floor(max[2]! / CELL); z++) {
          const key = `${x},${y},${z}`, list = grid.get(key); if (list) list.push(entry); else grid.set(key, [entry]);
        }
  };
  for (const instance of CRUISE_COLLISION_INSTANCES) {
    if (!instance.placed) continue;
    const index = byId.get(open.get(instance.id) ?? instance.prototype)!, p = prototypes[index]!;
    const yaw = Math.round(instance.yaw * YAW_UNITS / 360), origin = instance.at.map((v: number) => Math.round(v * STRUCT_UNITS) / STRUCT_UNITS);
    frameOf(yaw); const c = frame.cos, s = frame.sin, stretch = frame.stretch;
    (p.boxes ?? []).forEach((b, part) => {
      const solid = new Solid(); boxSolid(origin[0]! + (c * b.at[0]! + s * b.at[2]!) * stretch, origin[1]! + b.at[1]!, origin[2]! + (-s * b.at[0]! + c * b.at[2]!) * stretch, c, s, b.half[0]! * stretch, b.half[1]!, b.half[2]! * stretch, solid);
      add(`${instance.id}/box${part}`, solid, p.sourceParts?.boxes[part]?.support ?? (p.category === "floor" || (p.category === "stairs" && p.art?.kind === "landing" && part === 0)));
    });
    for (let part = hulls.start[index]!; part < hulls.start[index + 1]!; part++) {
      const solid = new Solid(); partSolid(hulls, part, yaw, origin[0]!, origin[1]!, origin[2]!, solid);
      add(`${instance.id}/hull${part - hulls.start[index]!}`, solid, p.sourceParts?.hulls[part - hulls.start[index]!]!?.support ?? (p.category === "floor" || (p.category === "stairs" && part === hulls.start[index]!)));
    }
  }
  cells = grid; return grid;
}

export function cruiseFitSpots(): CruiseFitSpot[] {
  const spots: CruiseFitSpot[] = [];
  const byNode = cruiseAccessRoutes(CRUISE_LAYOUT.routes);
  for (const room of CRUISE_LAYOUT.rooms) {
    let nearest = Infinity, yaw = 0;
    // A room's explicit graph association selects its own approach, without an all-room connector search or X-facing assumption.
    for (const route of byNode.get(room.node) ?? []) for (let i = 1; i < route.anchors.length; i++) {
      const a = route.anchors[i - 1]!, b = route.anchors[i]!, dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, dz = b[2]! - a[2]!;
      const length = dx * dx + dy * dy + dz * dz;
      if (dx * dx + dz * dz < .000001) continue;
      const p = room.entry, t = Math.max(0, Math.min(1, ((p[0]! - a[0]!) * dx + (p[1]! - a[1]!) * dy + (p[2]! - a[2]!) * dz) / length));
      const distance = Math.hypot(p[0]! - a[0]! - t * dx, p[1]! - a[1]! - t * dy, p[2]! - a[2]! - t * dz);
      if (distance < nearest) { nearest = distance; yaw = Math.atan2(dx, dz); }
    }
    if (!Number.isFinite(nearest)) throw new Error(`${room.id}: no authored approach to its entry`);
    spots.push({ id: `${room.id} jamb`, feet: room.entry, yaw }, { id: `${room.id} exit`, feet: room.entry, yaw: yaw + Math.PI });
  }
  const nodes = new Map(CRUISE_LAYOUT.graph.nodes.map(n => [n.id, n])), rooms = new Map(CRUISE_LAYOUT.rooms.map(r => [r.id, r]));
  const decks = new Map(CRUISE_LAYOUT.decks.map(d => [d.id, d]));
  for (const portal of CRUISE_LAYOUT.portals) {
    const deck = rooms.get(portal.to)?.deck ?? nodes.get(portal.to)?.deck ?? rooms.get(portal.from)?.deck ?? nodes.get(portal.from)?.deck;
    if (!deck) throw new Error(`${portal.id}: portal has no occupied deck`);
    const feet = [portal.at[0]!, decks.get(deck)!.floorY, portal.at[2]!], yaw = Math.atan2(portal.normal[0]!, portal.normal[2]!);
    spots.push({ id: `${portal.id} portal`, feet, yaw }, { id: `${portal.id} portal return`, feet, yaw: yaw + Math.PI });
  }
  for (const stair of CRUISE_LAYOUT.stairs) {
    const route = CRUISE_LAYOUT.routes.find(r => r.id === stair.route)!;
    for (let index = 0; index < route.anchors.length; index++) {
      const a = route.anchors[index === 0 ? 0 : index - 1]!, b = route.anchors[index === 0 ? 1 : index]!;
      spots.push({ id: `${stair.id}[${index}]`, feet: route.anchors[index]!, yaw: Math.atan2(b[0]! - a[0]!, b[2]! - a[2]!) });
    }
  }
  for (const id of ["pool_under", "aquadome"]) {
    const room = CRUISE_LAYOUT.rooms.find(r => r.id === id);
    if (room) spots.push({ id, feet: room.routeTarget, yaw: 0 });
  }
  return spots;
}

/** Sole/tread contact is excluded; overhead slabs, guards, jambs, open door leaves and furnishings remain solid. */
export function auditCruiseFit(spots: readonly CruiseFitSpot[] = cruiseFitSpots(), cases: readonly CruiseFitCase[] = CRUISE_FIT_CASES) {
  const grid = geometry(), collisions: { spot: string; solid: string; pose: CruiseBodyPose; vertex: CruiseBodyVertex }[] = [];
  let points = 0;
  for (const spot of spots) {
    const feet = spot.feet, near = new Set<FitSolid>();
    for (let x = Math.floor((feet[0]! - 2) / CELL); x <= Math.floor((feet[0]! + 2) / CELL); x++)
      for (let y = Math.floor(feet[1]! / CELL); y <= Math.floor((feet[1]! + 3) / CELL); y++)
        for (let z = Math.floor((feet[2]! - 2) / CELL); z <= Math.floor((feet[2]! + 2) / CELL); z++)
          for (const solid of grid.get(`${x},${y},${z}`) ?? []) if (!(solid.support && solid.min[1]! <= feet[1]! + .5)) near.add(solid);
    const c = Math.cos(spot.yaw), s = Math.sin(spot.yaw);
    for (const sample of cases) {
      const key = JSON.stringify(sample); let vertices = poses.get(key);
      if (!vertices) { const made: CruiseBodyVertex[] = []; cruiseBodyVertices(sample.pose, v => made.push(v), [sample.profile]); poses.set(key, vertices = made); }
      const hit = new Set<string>();
      for (const vertex of vertices) {
        points++; const p = vertex.at, at = [feet[0]! + c * p[0]! + s * p[2]!, feet[1]! + p[1]!, feet[2]! - s * p[0]! + c * p[2]!];
        for (const solid of near) {
          if (hit.has(solid.id) || at.some((v, axis) => v <= solid.min[axis]! + SKIN || v >= solid.max[axis]! - SKIN)) continue;
          if (solid.planes.every(n => { const d = n[0]! * at[0]! + n[1]! * at[1]! + n[2]! * at[2]!; return d > n[3]! + SKIN && d < n[4]! - SKIN; })) {
            hit.add(solid.id); collisions.push({ spot: spot.id, solid: solid.id, pose: sample.pose, vertex: { ...vertex, at } });
          }
        }
      }
    }
  }
  return { scope: "Selected feasible actual body/armor/hair profiles at centred authored paths on the current native rig and poses; sampled coverage, no full creator/animation interval or combat/jump/wall-pressed claim",
    sources: cruiseFitSources(), cases, spots: spots.length, poses: cases.length, points, collisions };
}

if (import.meta.main) {
  const out = resolve(import.meta.dir, "../..", process.argv[2] ?? "var/cruise-preview/fit.json"), report = auditCruiseFit();
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ out, spots: report.spots, points: report.points, collisions: report.collisions.length }));
  if (report.collisions.length) process.exitCode = 1;
}
