import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSample } from "../../client/core/session.ts";
import { KORU, KORU_LAYOUT } from "../../content/landmarks/koru.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { withContent } from "../../shared/content/registry.ts";
import { RESULT_OBSTRUCTED } from "../../shared/net/protocol.ts";
import { BTN_SPRINT, BTN_USE, MODE_WALK, stanceEye } from "../../shared/sim/character.ts";
import { capsuleFree, restingAt } from "../../shared/world/collide.ts";
import { placeLandmark } from "../../shared/world/landmark.ts";
import { KORU_AT, KORU_QUAY, koruMapFile, koruPoint } from "../fixtures/koru.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = withContent(coreRegistry(), KORU.defs);
const worldPoint = koruPoint;
const map = koruMapFile();
const route = (id: string) => {
  const found = KORU_LAYOUT.routes.find(r => r.id === id);
  if (!found) throw new Error(`missing authored route ${id}`);
  return found.anchors;
};

/** Feedback drives normal input only: every metre of the arrival and every stair is walked by the native client/server. */
function walker(h: Harness, index = 0) {
  const s = h.sessions[index]!, pilot = h.pilots[index]!;
  const world = (p: readonly number[], label: string, height = true) => {
    const [x, y, z] = p as readonly [number, number, number];
    const distance = Math.hypot(x - s.own.x, z - s.own.z);
    const frames = Math.ceil(distance / 4.5 * 60 * 2) + 150;
    pilot.pitch = 0; pilot.buttons = 0; pilot.moveX = 0;
    for (let i = 0; i < frames; i++) {
      const left = Math.hypot(x - s.own.x, z - s.own.z);
      if (left < .08) break;
      pilot.yaw = Math.atan2(x - s.own.x, z - s.own.z); pilot.moveZ = Math.min(1, left * 2); h.run(1000 / 60);
      if (!capsuleFree(h.world, s.own.x, s.own.y, s.own.z, .4, 1.8)) throw new Error(`${label}: body entered solid space at ${[s.own.x, s.own.y, s.own.z]}`);
      if (height && !capsuleFree(h.world, s.own.x, s.own.y, s.own.z, .4, 2.6)) throw new Error(`${label}: less than 2.6 m headroom while walking at ${[s.own.x, s.own.y, s.own.z]}`);
    }
    pilot.moveZ = 0; h.run(100);
    if (Math.hypot(x - s.own.x, z - s.own.z) > .15 || (height && Math.abs(y - s.own.y) > .2)) {
      throw new Error(`${label}: cannot walk to ${p}; stopped at ${[s.own.x, s.own.y, s.own.z]}`);
    }
    if (height && !capsuleFree(h.world, s.own.x, s.own.y, s.own.z, .4, 2.6)) throw new Error(`${label}: less than 2.6 m native headroom`);
    expect(s.own.mode).toBe(MODE_WALK);
  };
  const local = (points: readonly (readonly number[])[], label: string) => points.forEach((p, i) => world(worldPoint(p), `${label}[${i}]`));
  return { world, local, route: (id: string, reverse = false) => local(reverse ? [...route(id)].reverse() : route(id), id) };
}

/** From the quay where a survivor arrives, over the gangway and aboard. */
function board(h: Harness, index = 0) {
  const walk = walker(h, index);
  walk.world(KORU_QUAY, "quay");
  walk.route("shore_to_arrival"); return walk;
}

function useAt(h: Harness, index: number, p: readonly number[]): number {
  const s = h.sessions[index]!, pilot = h.pilots[index]!, eye = s.own.y + stanceEye(reg.move[s.ownKind]!, s.own.stance);
  pilot.yaw = Math.atan2(p[0]! - s.own.x, p[2]! - s.own.z);
  pilot.pitch = Math.atan2(p[1]! - eye, Math.hypot(p[0]! - s.own.x, p[2]! - s.own.z));
  let code = -1; s.onResult = (seq, result) => { if (!seq) code = result; };
  pilot.buttons = BTN_USE; h.run(100); pilot.buttons = 0; h.run(350); return code;
}

/** Authored path edges plus short, supported clear connectors. This only chooses normal walking destinations. */
function navigator(h: Harness, index = 0) {
  const walk = walker(h, index), s = h.sessions[index]!, nodes: number[][] = [], byPoint = new Map<string, number>();
  const add = (p: readonly number[]) => {
    const key = p.join(","), old = byPoint.get(key); if (old !== undefined) return old;
    const id = nodes.length; byPoint.set(key, id); nodes.push([...p]); return id;
  };
  for (const r of KORU_LAYOUT.routes) for (const p of r.anchors) add(p);
  const edges = nodes.map(() => new Set<number>());
  const link = (a: number, b: number) => { edges[a]!.add(b); edges[b]!.add(a); };
  const openRoutes = new Set<string>();
  const authored = () => {
    for (const r of KORU_LAYOUT.routes) {
      if ("requiresOpen" in r && r.requiresOpen && !openRoutes.has(r.requiresOpen)) continue;
      for (let i = 1; i < r.anchors.length; i++) link(add(r.anchors[i - 1]!), add(r.anchors[i]!));
    }
  };
  authored();
  for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
    const from = nodes[a]!, to = nodes[b]!, length = Math.hypot(from[0]! - to[0]!, from[2]! - to[2]!);
    if (Math.abs(from[1]! - to[1]!) > .01 || length > 14) continue;
    let clear = true;
    for (let t = 0, n = Math.ceil(length / .2); t <= n; t++) {
      const f = n ? t / n : 0, p = worldPoint(from.map((v, axis) => v + (to[axis]! - v) * f));
      const y = restingAt(h.world, p[0], p[1] + .1, p[2], .4, 1.8, .2, .71);
      if (!Number.isFinite(y) || Math.abs(y - p[1]) > .15 || !capsuleFree(h.world, p[0], y, p[2], .4, 2.6)) { clear = false; break; }
    }
    if (clear) link(a, b);
  }
  let at = add(route("shore_to_arrival").at(-1)!);
  const reach = (p: readonly number[], label: string) => {
    const target = add(p), prev = new Int32Array(nodes.length).fill(-1), queue = [at]; prev[at] = at;
    for (let i = 0; i < queue.length && prev[target] === -1; i++) for (const next of edges[queue[i]!]!) {
      if (prev[next] !== -1) continue; prev[next] = queue[i]!; queue.push(next);
    }
    if (prev[target] === -1) throw new Error(`${label}: no supported route from ${nodes[at]} to ${p}`);
    const path: number[] = []; for (let n = target; n !== at; n = prev[n]!) path.push(n);
    walk.local(path.reverse().map(n => nodes[n]!), `${label} approach`); at = target;
  };
  const open = (kind: string) => {
    if (openRoutes.has(kind)) return;
    const module = KORU_LAYOUT.modules.find(m => m.id === kind)!, box = module.boxes[0]!;
    const p = worldPoint(module.origin.map((v, axis) => v + box.at[axis]!)), code = useAt(h, index, p);
    const desired = reg.index.get(`${kind}_open`)!;
    const opened = h.world.structs.chunks.some(t => t && t.kind.subarray(0, t.high).includes(desired));
    if (!opened) throw new Error(`${kind}: E failed (${code}) from ${[s.own.x, s.own.y, s.own.z]} aiming ${p}`);
    openRoutes.add(kind); authored();
  };
  const visit = (id: string, reverse = false) => {
    const r = KORU_LAYOUT.routes.find(r => r.id === id)!;
    const points = reverse ? [...r.anchors].reverse() : r.anchors;
    reach(points[0]!, id);
    if ("requiresOpen" in r && r.requiresOpen) open(r.requiresOpen);
    walk.local(points, id); at = add(points.at(-1)!);
  };
  return { visit, reach };
}

test("Koru is its full 125 m and 17.2 m beam, walked as statics of at most 16 parts each, with public paired cabin doors", () => {
  expect(KORU_LAYOUT.dimensions.bowspritTip[2]! - KORU_LAYOUT.dimensions.hullMinZ).toBe(125);
  expect(KORU_LAYOUT.dimensions.beam).toBe(17.2);
  expect(KORU_LAYOUT.decks.map(d => d.floorY)).toEqual([.75, 3.75, 6.75, 9.75]);
  const { statics } = placeLandmark(KORU, KORU_AT.x, KORU_AT.y, KORU_AT.z, KORU_AT.yaw);
  expect(statics.length).toBe(KORU_LAYOUT.modules.length - KORU_LAYOUT.doors.length);
  const hullAndSpar: number[][] = [], hull: number[][] = [];
  for (const module of KORU_LAYOUT.modules) {
    expect(module.boxes.length + module.hulls.length).toBeLessThanOrEqual(16);
    const kind = reg.index.get(module.id)!;
    expect([module.id, reg.role[kind]]).toEqual([module.id, -1]);
    if (!module.placed || (module.category !== "hull" && module.category !== "bowsprit")) continue;
    const points = module.hulls.flatMap(h => h.points);
    for (const box of module.boxes) for (let corner = 0; corner < 8; corner++) points.push(box.at.map((v, axis) => v + box.half[axis]! * (corner & (1 << axis) ? 1 : -1)));
    for (const p of points) {
      const at = koruPoint(module.origin.map((v, axis) => v + p[axis]!));
      hullAndSpar.push(at);
      if (module.category === "hull") hull.push(at);
    }
  }
  // The placed collision itself, apart from the dimensions written above.
  expect(Math.max(...hullAndSpar.map(p => p[2]!)) - Math.min(...hullAndSpar.map(p => p[2]!))).toBeCloseTo(125, 2);
  expect(Math.max(...hull.map(p => p[0]!)) - Math.min(...hull.map(p => p[0]!))).toBeCloseTo(17.2, 2);
});

test("a survivor walks from the quay over the gangway and through all four decks without a correction", () => {
  const h = new Harness({}, 31, 60, { dev: true, clips: NO_CLIPS, rigs: [], map });
  try {
    const s = h.join("visitor"); h.run(700); const before = s.stats.corrections, walk = board(h);
    walk.local(route("main_spine").slice(2, 7), "main spine to grand stairs");
    walk.local(route("connector_grand_1").slice(0, 3), "main grand approach");
    walk.route("stair_grand_1");
    walk.local([route("stair_grand_2")[0]!], "upper grand approach"); walk.route("stair_grand_2");
    expect(s.own.y).toBeCloseTo(9.75, 1);
    walk.route("stair_grand_2", true);
    walk.local([route("stair_grand_1").at(-1)!], "upper descent approach"); walk.route("stair_grand_1", true);
    walk.local([route("stair_grand_0").at(-1)!], "main descent approach"); walk.route("stair_grand_0", true);
    expect(s.own.y).toBeCloseTo(.75, 1);
    walk.route("stair_grand_0");
    walk.local([...route("connector_grand_1")].reverse(), "main return connector");
    walk.local([...route("main_spine").slice(2, 7)].reverse(), "main return spine");
    walk.route("shore_to_arrival", true);
    expect(s.stats.corrections - before).toBe(0);
  } finally { h.host.shutdown(); }
});

test("every authored stairway, room and circulation route is reachable on foot with normal E cabin doors", () => {
  const h = new Harness({}, 32, 60, { dev: true, clips: NO_CLIPS, rigs: [], map });
  try {
    const s = h.join("explorer"); h.run(700); board(h); const nav = navigator(h), before = s.stats.corrections;
    for (const r of KORU_LAYOUT.routes) { nav.visit(r.id); if (r.kind === "stairs") nav.visit(r.id, true); }
    expect(s.stats.corrections - before).toBe(0);
  } finally { h.host.shutdown(); }
});

test("gangway rails stop an ordinary sprint into the harbour on both sides", () => {
  const h = new Harness({}, 34, 60, { dev: true, clips: NO_CLIPS, rigs: [], map });
  try {
    const s = h.join("dock visitor", { latencyMs: 50 }); h.run(1000); const walk = walker(h), pilot = h.pilots[0]!;
    walk.world(KORU_QUAY, "quay");
    const middle = route("shore_to_arrival")[1]!, at = worldPoint(middle);
    walk.local([middle], "gangway middle"); const before = s.stats.corrections;
    for (const side of [1, -1]) {
      pilot.yaw = side > 0 ? 0 : Math.PI; pilot.moveZ = 1; pilot.buttons = BTN_SPRINT; h.run(1500);
      pilot.moveZ = pilot.buttons = 0; h.run(300);
      expect(s.own.mode).toBe(MODE_WALK); expect(s.own.y).toBeCloseTo(at[1], 2);
      expect(Math.abs(s.own.z - at[2])).toBeGreaterThan(.5); expect(Math.abs(s.own.z - at[2])).toBeLessThan(.62);
      expect(s.own.z).toBe(h.world.ents.z[h.ent(s)]!); walk.local([middle], "gangway recenter");
    }
    expect(s.stats.corrections - before).toBe(0);
  } finally { h.host.shutdown(); }
});

test("delayed peers walk onto separate yacht decks, see the correct floor, and retain elevated positions after server restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-koru-")), opts = { dev: true, clips: NO_CLIPS, rigs: [], map, dbPath: join(dir, "world.db") };
  const link = { latencyMs: 70, jitterMs: 12, loss: .02 }, names = ["lower guest", "main guest", "upper guest", "sun guest"];
  let h = new Harness({}, 33, 60, opts);
  try {
    const peers = names.map(name => h.join(name, link)); h.run(1300);
    const before = peers.map(s => s.stats.corrections);
    for (let i = 0; i < peers.length; i++) {
      const walk = board(h, i);
      if (i === 1) continue;
      walk.route("connector_aft_1");
      if (i === 0) walk.route("stair_aft_0", true);
      else {
        walk.route("stair_aft_1");
        if (i === 3) walk.route("stair_aft_2");
      }
      walk.route(`connector_aft_${i}`, true);
    }
    // A real cabin leaf opens with E, cannot close through its visitor, and replicates to guests on the other decks.
    const nav = navigator(h, 1), doorRoute = route("room_vip_port"); nav.visit("room_vip_port");
    nav.reach(doorRoute[1]!, "VIP doorway");
    const openDoor = KORU_LAYOUT.modules.find(m => m.id === "koru:door_vip_port_open")!, box = openDoor.boxes[0]!;
    expect(useAt(h, 1, worldPoint(openDoor.origin.map((v, axis) => v + box.at[axis]!)))).toBe(RESULT_OBSTRUCTED);
    nav.reach(route("shore_to_arrival").at(-1)!, "main guest return");
    h.run(500);
    const openKind = reg.index.get(openDoor.id)!;
    for (const s of peers) expect(s.world!.structs.chunks.some(t => t && t.kind.subarray(0, t.high).includes(openKind))).toBe(true);
    for (let i = 0; i < peers.length; i++) {
      const s = peers[i]!, own = h.ent(s), seen = new RemoteSample(); s.sampleRemote(seen);
      expect(s.own.y).toBeCloseTo(KORU_LAYOUT.decks[i]!.floorY, 2);
      expect(s.own.y).toBe(h.world.ents.y[own]!);
      expect(s.stats.corrections - before[i]!).toBe(0);
      for (let j = 0; j < peers.length; j++) if (i !== j) {
        const at = seen.id.indexOf(h.ent(peers[j]!)); expect(at).toBeGreaterThanOrEqual(0);
        expect(seen.y[at]!).toBeCloseTo(KORU_LAYOUT.decks[j]!.floorY, 2);
      }
    }
    const saved = peers.map(s => [s.own.x, s.own.y, s.own.z]), count = h.world.structs.count;
    h.host.shutdown(); h = new Harness({}, 33, 60, opts);
    expect(h.world.structs.count).toBe(count);
    const savedDoor = h.world.structs.chunks.flatMap(t => t ? Array.from(t.kind.subarray(0, t.high), (kind, slot) => ({ kind, slot, t })) : []).find(r => r.kind === openKind)!;
    expect(savedDoor).toBeDefined(); expect(savedDoor.t.owner[savedDoor.slot]).toBe(0); expect(reg.role[openKind]).toBe(-1);
    const back = names.map(name => h.join(name, link)); h.run(1300);
    for (let i = 0; i < back.length; i++) {
      const s = back[i]!; expect(s.own.mode).toBe(MODE_WALK);
      expect(Math.hypot(s.own.x - saved[i]![0]!, s.own.y - saved[i]![1]!, s.own.z - saved[i]![2]!)).toBeLessThan(.01);
      expect(capsuleFree(h.world, s.own.x, s.own.y, s.own.z, .4, 2.6)).toBe(true);
    }
  } finally { h.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
