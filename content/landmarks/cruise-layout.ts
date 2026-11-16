// Types and authoring invariants for the one JSON consumed by native content and the mesh exporter.
import { shapeHalf, type ShapeLook } from "../../shared/content/defs.ts";
import { MAX_LOOK_PARTS, MAX_SHAPE_BOXES, MAX_STRUCTURE_HALF } from "../../shared/content/registry.ts";
import { hullOf } from "../../shared/world/convex.ts";

export type CruisePoint = readonly number[];
export interface CruiseBounds { readonly min: CruisePoint; readonly max: CruisePoint }
export interface CruiseParts {
  readonly boxes?: readonly { readonly at: CruisePoint; readonly half: CruisePoint }[];
  readonly hulls?: readonly { readonly points: readonly CruisePoint[] }[];
}
export interface CruisePrototype extends CruiseParts {
  readonly id: string; readonly mesh: string; readonly category: string; readonly color: number;
  readonly visualBounds: CruiseBounds; readonly look?: CruiseParts; readonly opens?: string;
}
export interface CruiseInstance {
  readonly id: string; readonly prototype: string; readonly at: CruisePoint; readonly yaw: number;
  readonly deck: string; readonly section: string; readonly placed: boolean;
}
export interface CruiseDeck {
  readonly id: string; readonly index: number; readonly floorY: number; readonly ceilingY: number | null;
  readonly outlines: readonly (readonly CruisePoint[])[];
  readonly voids: readonly { readonly id: string; readonly kind: string; readonly polygon: readonly CruisePoint[] }[];
}
export interface CruiseNode { readonly id: string; readonly at: CruisePoint; readonly deck: string; readonly kind: string }
export interface CruiseRoute {
  readonly id: string; readonly kind: string; readonly from: string; readonly to: string;
  readonly anchors: readonly CruisePoint[]; readonly clearWidth: number; readonly clearHeight: number;
}
export interface CruiseDoor {
  readonly id: string; readonly instanceId: string; readonly closedPrototype: string; readonly openPrototype: string;
  readonly hinge: CruisePoint; readonly clearWidth: number; readonly clearHeight: number;
}
export interface CruiseStair {
  readonly id: string; readonly fromDeck: string; readonly toDeck: string; readonly instances: readonly string[];
  readonly opening: CruiseBounds; readonly route: string;
}
export interface CruiseLayout {
  readonly schema: number; readonly id: string; readonly phase: string;
  readonly frame: { readonly units: string; readonly up: string; readonly forward: string; readonly port: string; readonly waterline: number; readonly yawUnits: string };
  readonly dimensions: { readonly lengthOverall: number; readonly minZ: number; readonly maxZ: number; readonly waterlineBeam: number; readonly deckhouseBeam: number; readonly bridgeBeam: number };
  readonly clearances: { readonly doorWidth: number; readonly doorHeight: number; readonly minimumHeadroom: number; readonly publicStairWidth: number; readonly stairLandingClearWidth: number; readonly stairLandingClearDepth: number };
  readonly decks: readonly CruiseDeck[]; readonly prototypes: readonly CruisePrototype[]; readonly instances: readonly CruiseInstance[];
  readonly graph: { readonly nodes: readonly CruiseNode[] }; readonly routes: readonly CruiseRoute[];
  readonly stairs: readonly CruiseStair[]; readonly doors: readonly CruiseDoor[];
  readonly rooms: readonly { readonly id: string; readonly label: string; readonly deck: string; readonly section: string; readonly bounds: CruiseBounds; readonly entry: CruisePoint; readonly routeTarget: CruisePoint }[];
  readonly portals: readonly { readonly id: string; readonly from: string; readonly to: string; readonly at: CruisePoint; readonly normal: CruisePoint; readonly clearWidth: number; readonly clearHeight: number; readonly kind: string }[];
  readonly docking: { readonly shipLanding: CruisePoint; readonly shoreLanding: CruisePoint; readonly shoreApproach: CruisePoint; readonly arrival: CruisePoint; readonly clearWidth: number; readonly deck: string; readonly seaDatum: number };
  readonly views: readonly { readonly id: string; readonly at: CruisePoint; readonly target: CruisePoint; readonly deck: string; readonly section: string; readonly mode: string }[];
}

export const cruiseTuple = (p: CruisePoint): readonly [number, number, number] => [p[0]!, p[1]!, p[2]!];
export function cruiseParts(source: CruiseParts): ShapeLook {
  return { boxes: source.boxes?.map(b => ({ at: cruiseTuple(b.at), half: cruiseTuple(b.half) })),
    hulls: source.hulls?.map(h => ({ corners: h.points.map(cruiseTuple) })) };
}

/** Linear instance/graph validation; native bounds and convex-part checks run once per reusable prototype. */
export function cruiseLayoutFaults(layout: CruiseLayout): string[] {
  const faults: string[] = [];
  const bad = (label: string, message: string) => faults.push(`${label}: ${message}`);
  const point = (p: CruisePoint, label: string, size = 3): boolean => {
    const valid = p.length === size && p.every(Number.isFinite);
    if (!valid) bad(label, `must be ${size} finite coordinates`);
    return valid;
  };
  const bounds = (b: CruiseBounds, label: string) => {
    if (point(b.min, `${label}.min`) && point(b.max, `${label}.max`) && b.min.some((v, a) => v > b.max[a]!)) bad(label, "inverted bounds");
  };
  const index = <T extends { readonly id: string }>(items: readonly T[], label: string): Map<string, T> => {
    const found = new Map<string, T>();
    for (const item of items) {
      if (!item.id || found.has(item.id)) bad(label, `empty or duplicate id ${item.id}`);
      found.set(item.id, item);
    }
    return found;
  };
  const same = (a: CruisePoint, b: CruisePoint) => a.length === 3 && b.length === 3 && a.every((v, i) => Math.abs(v - b[i]!) <= .002);
  const clearance = (width: number, height: number, label: string, minimum = 1.6) => {
    if (!(width >= minimum && Number.isFinite(width) && height >= 2.6 && Number.isFinite(height))) bad(label, `requires at least ${minimum} m width and 2.6 m headroom`);
  };
  const frame = layout.frame;
  if (layout.schema !== 1 || frame.units !== "metres" || frame.up !== "+Y" || frame.forward !== "+Z" || frame.port !== "+X" || frame.waterline !== 0 || frame.yawUnits !== "degrees") bad("frame", "requires schema 1, metre ship frame and degree instance yaw");
  const d = layout.dimensions;
  if ([d.lengthOverall, d.minZ, d.maxZ, d.waterlineBeam, d.deckhouseBeam, d.bridgeBeam].some(n => !Number.isFinite(n)) ||
    d.lengthOverall !== 365 || d.maxZ - d.minZ !== d.lengthOverall || d.waterlineBeam !== 48.5 || d.deckhouseBeam !== 57.8 || d.bridgeBeam !== 65.8) bad("dimensions", "must retain the published 365 m length and three distinct measured beams");
  const c = layout.clearances;
  clearance(c.doorWidth, c.doorHeight, "clearances.door");
  clearance(c.publicStairWidth, c.minimumHeadroom, "clearances.stairs", 1.8);
  if (!(c.stairLandingClearWidth >= 4 && c.stairLandingClearDepth >= 2)) bad("clearances.landings", "requires at least 4 by 2 m clear turns");
  const decks = index(layout.decks, "decks"), prototypes = index(layout.prototypes, "prototypes"), instances = index(layout.instances, "instances");
  const nodes = index(layout.graph.nodes, "graph.nodes"), routes = index(layout.routes, "routes"), rooms = index(layout.rooms, "rooms");
  index(layout.portals, "portals"); index(layout.stairs, "stairs"); index(layout.doors, "doors"); index(layout.views, "views");
  const deck = (id: string, label: string) => { if (!decks.has(id)) bad(label, `unknown deck ${id}`); };
  for (const deck of layout.decks) {
    if (!/^(?:[2-9]|1[0-24-9]|20)$/.test(deck.id)) bad(deck.id, "invalid published deck label");
    if (!(deck.floorY > 0 && Number.isFinite(deck.floorY)) || (deck.ceilingY !== null && !(Number.isFinite(deck.ceilingY) && deck.ceilingY - deck.floorY >= 2.6))) bad(`deck ${deck.id}`, "occupied floor must be above sea with native headroom");
    for (const polygon of [...deck.outlines, ...deck.voids.map(v => v.polygon)]) {
      if (polygon.length < 3) bad(`deck ${deck.id}`, "outline or void needs at least three points");
      polygon.forEach(p => point(p, `deck ${deck.id} polygon`, 2));
    }
  }
  for (const p of layout.prototypes) {
    if (!/^core:cruise_[a-z0-9_]+$/.test(p.id) || !p.mesh) bad(p.id, "prototype needs a stable cruise content id and mesh");
    if (!Number.isInteger(p.color) || p.color < 0 || p.color > 255) bad(p.id, "invalid palette index");
    bounds(p.visualBounds, `${p.id}.visualBounds`);
    const forms: [CruiseParts, number, string][] = [[p, MAX_SHAPE_BOXES, "collision"]];
    if (p.look) forms.push([p.look, MAX_LOOK_PARTS, "look"]);
    for (const [parts, maximum, label] of forms) {
      const count = (parts.boxes?.length ?? 0) + (parts.hulls?.length ?? 0);
      if (count < 1 || count > maximum) bad(p.id, `${label} needs 1 to ${maximum} parts`);
      for (const b of parts.boxes ?? []) if (point(b.at, `${p.id}.${label}.at`) && point(b.half, `${p.id}.${label}.half`)) {
        if (b.half.some((v, a) => !(v > 0 && Math.abs(b.at[a]!) + v <= MAX_STRUCTURE_HALF))) bad(p.id, `${label} box exceeds native ±${MAX_STRUCTURE_HALF} m bounds`);
      }
      for (const h of parts.hulls ?? []) {
        if (!h.points.every(v => point(v, `${p.id}.${label}.hull`))) continue;
        const made = hullOf({ corners: h.points.map(cruiseTuple) });
        if (typeof made === "string") bad(p.id, made);
        if (h.points.some(v => v.some(n => Math.abs(n) > MAX_STRUCTURE_HALF))) bad(p.id, `${label} hull exceeds native bounds`);
      }
    }
    const collision = cruiseParts(p), half = shapeHalf(collision.boxes ?? [], collision.hulls, p.look ? cruiseParts(p.look) : undefined);
    if (half.some((v, a) => Math.max(Math.abs(p.visualBounds.min[a]!), Math.abs(p.visualBounds.max[a]!)) > v + .003)) bad(p.id, "visual bounds exceed collision/look coverage");
    if (p.opens && (p.opens === p.id || prototypes.get(p.opens)?.opens !== p.id || p.category !== "door" || prototypes.get(p.opens)?.category !== "door")) bad(p.id, "door prototypes must be reciprocal door states");
  }
  const placements = new Set<string>();
  for (const i of layout.instances) {
    if (!prototypes.has(i.prototype)) bad(i.id, `unknown prototype ${i.prototype}`);
    point(i.at, `${i.id}.at`); deck(i.deck, i.id);
    if (!Number.isFinite(i.yaw) || !i.section || typeof i.placed !== "boolean") bad(i.id, "requires finite degree yaw, section and placed flag");
    if (i.placed) {
      const key = `${i.prototype}|${i.at.join(",")}|${((i.yaw % 360) + 360) % 360}`;
      if (placements.has(key)) bad(i.id, "duplicate placed prototype transform");
      placements.add(key);
    }
  }
  const doorInstances = new Set<string>();
  for (const door of layout.doors) {
    const i = instances.get(door.instanceId);
    if (!i?.placed || i.prototype !== door.closedPrototype || prototypes.get(door.closedPrototype)?.opens !== door.openPrototype || prototypes.get(door.openPrototype)?.opens !== door.closedPrototype) bad(door.id, "needs one placed closed leaf with reciprocal state prototypes");
    if (doorInstances.has(door.instanceId)) bad(door.id, "door instance appears more than once");
    doorInstances.add(door.instanceId); point(door.hinge, `${door.id}.hinge`); clearance(door.clearWidth, door.clearHeight, door.id);
    if (i && !same(i.at, door.hinge)) bad(door.id, "hinge must equal the leaf instance origin");
  }
  for (const i of layout.instances) if (i.placed && prototypes.get(i.prototype)?.opens && !doorInstances.has(i.id)) bad(i.id, "placed door lacks independent door record");
  const edges = new Map<string, string[]>();
  for (const node of layout.graph.nodes) { point(node.at, `${node.id}.at`); deck(node.deck, node.id); edges.set(node.id, []); }
  for (const r of layout.routes) {
    const from = nodes.get(r.from), to = nodes.get(r.to);
    if (!from || !to) bad(r.id, "route names an unknown graph node");
    if (r.anchors.length < 2) bad(r.id, "route needs at least two anchors");
    r.anchors.forEach(p => point(p, `${r.id}.anchor`));
    if (from && !same(r.anchors[0] ?? [], from.at)) bad(r.id, "first anchor does not meet its from node");
    if (to && !same(r.anchors.at(-1) ?? [], to.at)) bad(r.id, "last anchor does not meet its to node");
    clearance(r.clearWidth, r.clearHeight, r.id, r.kind === "stairs" ? 1.8 : 1.6);
    edges.get(r.from)?.push(r.to); edges.get(r.to)?.push(r.from);
  }
  const start = layout.graph.nodes.find(n => same(n.at, layout.docking.shoreLanding));
  if (!start) bad("docking", "shore landing needs a graph node");
  const visited = new Set<string>(), queue = start ? [start.id] : [];
  for (let i = 0; i < queue.length; i++) { const id = queue[i]!; if (visited.has(id)) continue; visited.add(id); for (const next of edges.get(id) ?? []) if (!visited.has(next)) queue.push(next); }
  for (const node of layout.graph.nodes) if (!visited.has(node.id)) bad(node.id, "graph node is unreachable from the quay");
  for (const r of layout.rooms) { deck(r.deck, r.id); bounds(r.bounds, r.id); point(r.entry, `${r.id}.entry`); point(r.routeTarget, `${r.id}.routeTarget`); }
  for (const p of layout.portals) {
    if (![p.from, p.to].every(id => nodes.has(id) || rooms.has(id))) bad(p.id, "portal names an unknown room or graph node");
    point(p.at, `${p.id}.at`); point(p.normal, `${p.id}.normal`); clearance(p.clearWidth, p.clearHeight, p.id);
  }
  for (const s of layout.stairs) {
    deck(s.fromDeck, s.id); deck(s.toDeck, s.id); bounds(s.opening, `${s.id}.opening`);
    const r = routes.get(s.route);
    if (!r || nodes.get(r.from)?.deck !== s.fromDeck || nodes.get(r.to)?.deck !== s.toDeck) bad(s.id, "stair route must connect its source and destination decks");
    if (!s.instances.length || s.instances.some(id => !instances.get(id)?.placed)) bad(s.id, "stair parts must be placed instances");
  }
  for (const name of ["shipLanding", "shoreLanding", "shoreApproach", "arrival"] as const) point(layout.docking[name], `docking.${name}`);
  deck(layout.docking.deck, "docking"); clearance(layout.docking.clearWidth, 2.6, "docking");
  if (layout.docking.seaDatum !== 0) bad("docking", "sea datum must remain zero");
  for (const v of layout.views) { point(v.at, `${v.id}.at`); point(v.target, `${v.id}.target`); deck(v.deck, v.id); }
  return faults;
}
