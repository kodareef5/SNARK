// Feedback pilots use ordinary client movement and E; graph edges select destinations, never positions or server state.
import { CRUISE_LAYOUT, cruisePoint, cruiseStatics } from "../../content/landmarks/cruise.ts";
import type { CruiseLayout, CruiseRoute } from "../../content/landmarks/cruise-layout.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { join } from "node:path";
import { STRUCT_UNITS, YAW_UNITS } from "../../shared/coords.ts";
import { BTN_USE, MODE_WALK, stanceEye } from "../../shared/sim/character.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import type { MapData } from "../../shared/world/mapfile.ts";
import type { StructureStore } from "../../shared/world/structures.ts";
import { joinPacks } from "../../shared/pack/join.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { LANDMARKS, readPacks } from "../../tools/art/source.ts";
import { buildPack } from "../../tools/pack/write.ts";
import { assertCruisePlaced } from "../../tools/cruise/preflight.ts";
import { corePack } from "./pack.ts";
import type { Harness } from "./net.ts";

export interface CruisePlacement { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }
const layout: CruiseLayout = CRUISE_LAYOUT;

const landmarkBytes = new Map<string, Uint8Array>(), joined = new Map<string, Pack>();
/** Separate landmark packs, joined in exactly the map's declared order after the unchanged core meshes. */
export function cruisePack(names: readonly string[] = ["cruise", "koru"]): Pack {
  const key = names.join("|"); const cached = joined.get(key); if (cached) return cached;
  let pack = corePack();
  for (const name of names) {
    let bytes = landmarkBytes.get(name);
    if (!bytes) { const art = readPacks(join(LANDMARKS, name)); bytes = buildPack(art.meshes, defaultPalette(), [], art.rigs); landmarkBytes.set(name, bytes); }
    pack = joinPacks(pack, parsePack(bytes));
  }
  joined.set(key, pack); return pack;
}

/** Resolve authored instances independently of other map rows. Ordinary port statics precede landmarks in real maps. */
export function cruiseRefs(map: Pick<MapData, "id" | "dims" | "statics">, structs: StructureStore, reg: Registry, placement: CruisePlacement): Uint32Array {
  const all = assertCruisePlaced(map, structs, reg), byPlacement = new Map<string, number>();
  const key = (s: { kind: string; x: number; y: number; z: number; yaw: number }) => `${s.kind}|${[s.x, s.y, s.z].map(v => Math.round(v * STRUCT_UNITS)).join(",")}|${s.yaw}`;
  let row = 0; for (const s of map.statics) byPlacement.set(key(s), all[row++]!);
  return Uint32Array.from(cruiseStatics(placement.x, placement.y, placement.z, placement.yaw), s => {
    const ref = byPlacement.get(key(s)); if (ref === undefined) throw new Error(`missing authored cruise instance ${key(s)}`); return ref;
  });
}

export function cruiseWalker(h: Harness, reg: Registry, placement: CruisePlacement, index = 0) {
  const s = h.sessions[index]!, pilot = h.pilots[index]!;
  const point = (p: readonly number[]) => cruisePoint(placement.x, placement.y, placement.z, placement.yaw, p);
  const world = (p: readonly number[], label: string, height = true) => {
    const [x, y, z] = p;
    const frames = Math.ceil(Math.hypot(x! - s.own.x, z! - s.own.z) / 4.5 * 120) + 150;
    pilot.pitch = pilot.buttons = pilot.moveX = 0;
    for (let frame = 0; frame < frames; frame++) {
      const left = Math.hypot(x! - s.own.x, z! - s.own.z);
      if (left < .08) break;
      pilot.yaw = Math.atan2(x! - s.own.x, z! - s.own.z); pilot.moveZ = Math.min(1, left * 2); h.run(1000 / 60);
      if (!capsuleFree(h.world, s.own.x, s.own.y, s.own.z, .4, height ? 2.6 : 1.8)) throw new Error(`${label}: blocked body/headroom at ${[s.own.x, s.own.y, s.own.z]}`);
    }
    pilot.moveZ = 0; h.run(100);
    if (Math.hypot(x! - s.own.x, z! - s.own.z) > .15 || (height && Math.abs(y! - s.own.y) > .2) || s.own.mode !== MODE_WALK) {
      throw new Error(`${label}: cannot walk to ${p}; stopped at ${[s.own.x, s.own.y, s.own.z]} mode${s.own.mode}, after ${(h.now / 60000).toFixed(2)} min, vitals ${Array.from(s.vitals.value)}, log ${s.log.slice(-2).map(l => l.text)}`);
    }
  };
  const local = (points: readonly (readonly number[])[], label: string) => points.forEach((p, i) => world(point(p), `${label}[${i}]`));
  const use = (p: readonly number[]): number => {
    const eye = s.own.y + stanceEye(reg.move[s.ownKind]!, s.own.stance);
    pilot.moveX = pilot.moveZ = 0;
    pilot.yaw = Math.atan2(p[0]! - s.own.x, p[2]! - s.own.z);
    pilot.pitch = Math.atan2(p[1]! - eye, Math.hypot(p[0]! - s.own.x, p[2]! - s.own.z));
    let code = -1; s.onResult = (seq, result) => { if (!seq) code = result; };
    pilot.buttons = BTN_USE; h.run(100); pilot.buttons = 0; h.run(400);
    return code;
  };
  return { world, local, point, use };
}

/** Explicit adjacency is built once in O(nodes + routes); no geometric all-pairs connector search. */
export function cruiseNavigator(h: Harness, reg: Registry, placement: CruisePlacement, refs: Uint32Array, index = 0) {
  const walk = cruiseWalker(h, reg, placement, index), instances = layout.instances.filter(i => i.placed);
  const doors = new Map(layout.doors.map(d => [d.instanceId, d])), byInstance = new Map(instances.map((i, n) => [i.id, n]));
  const routes = new Map(layout.routes.map(r => [r.id, r])), edges = new Map(layout.graph.nodes.map(n => [n.id, [] as { route: CruiseRoute; reverse: boolean; to: string }[]]));
  for (const route of layout.routes) { edges.get(route.from)!.push({ route, reverse: false, to: route.to }); edges.get(route.to)!.push({ route, reverse: true, to: route.from }); }
  let at = layout.graph.nodes.find(n => n.at.every((v, a) => Math.abs(v - layout.docking.shoreLanding[a]!) < .002))!.id;
  const open = (instanceId: string) => {
    const door = doors.get(instanceId), row = byInstance.get(instanceId);
    if (!door || row === undefined) throw new Error(`missing native door ${instanceId}`);
    const ref = refs[row]!, t = h.world.structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 65535;
    const current = t.kind[slot]!, desired = reg.index.get(door.openPrototype)!;
    if (current === desired) return;
    if (current !== reg.index.get(door.closedPrototype)) throw new Error(`${instanceId}: unexpected leaf state ${current}`);
    const instance = instances[row]!, p = layout.prototypes.find(p => p.id === door.closedPrototype)!;
    const box = p.boxes?.[0]; if (!box) throw new Error(`${instanceId}: leaf needs an authored solid aim point`);
    const aimLocal = cruisePoint(instance.at[0]!, instance.at[1]!, instance.at[2]!, Math.round(instance.yaw * YAW_UNITS / 360), box.at);
    const code = walk.use(walk.point(aimLocal));
    if (t.kind[slot] !== desired) throw new Error(`${instanceId}: native E failed with result ${code}`);
  };
  const traverse = (route: CruiseRoute, reverse = false) => {
    const from = reverse ? route.to : route.from, to = reverse ? route.from : route.to;
    if (at !== from) throw new Error(`${route.id}: expected graph node ${from}, at ${at}`);
    if ("requiresOpen" in route && typeof route.requiresOpen === "string") open(route.requiresOpen);
    walk.local(reverse ? [...route.anchors].reverse() : route.anchors, route.id); at = to;
  };
  const reach = (target: string) => {
    const queue = [at], prev = new Map<string, { from: string; route: CruiseRoute; reverse: boolean }>();
    for (let n = 0; n < queue.length && !prev.has(target) && target !== at; n++) for (const e of edges.get(queue[n]!) ?? []) {
      if (e.to === at || prev.has(e.to)) continue;
      prev.set(e.to, { from: queue[n]!, route: e.route, reverse: e.reverse }); queue.push(e.to);
    }
    const path: { route: CruiseRoute; reverse: boolean }[] = [];
    for (let node = target; node !== at;) { const p = prev.get(node); if (!p) throw new Error(`no authored path to ${target}`); path.push(p); node = p.from; }
    for (const p of path.reverse()) traverse(p.route, p.reverse);
  };
  const visit = (id: string, reverse = false) => { const r = routes.get(id); if (!r) throw new Error(`missing route ${id}`); reach(reverse ? r.to : r.from); traverse(r, reverse); };
  const tour = () => {
    const seen = new Set<string>();
    const visitNode = (node: string) => {
      for (const edge of edges.get(node) ?? []) {
        if (seen.has(edge.route.id)) continue;
        seen.add(edge.route.id); traverse(edge.route, edge.reverse);
        visitNode(edge.to); traverse(edge.route, !edge.reverse);
      }
    };
    visitNode(at); return seen;
  };
  return { ...walk, reach, visit, open, tour, at: () => at };
}
