import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { COMPACT_SPECIES, COMPACT_VEHICLE } from "../../content/vehicles/compact.ts";
import { placeFree } from "../../server/place.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { nodesOf } from "../fixtures/gather.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

const made = compileContent([...CORE_CONTENT, { ...COMPACT_SPECIES, id: "test:heavy-car", aliases: [], mass: 2200,
  vehicle: { ...COMPACT_VEHICLE, id: "test:heavy-car", spec: { ...COMPACT_VEHICLE.spec, mass: 2200 } } }]);
if (!made.registry) throw new Error(made.errors.join("\n"));
const registry = made.registry;
const fast = loadConfig({ gus: "[ServerSettings]\nResourcesRespawnPeriodMultiplier=0.001", game: "" }).rules;

function mapOf(kind = "core:tree", chunk = 6) {
  const first = new Uint32Array(17); for (let i = chunk + 1; i < first.length; i++) first[i] = 1;
  return writeMap(flatMap(4, { nodes: [{ kinds: [kind], first, kind: new Uint8Array([0]), x: new Uint16Array([24 * 1024]), z: new Uint16Array([28 * 1024]), yaw: new Uint16Array([0]) }],
    spawns: [{ name: "Driver", x: chunk % 4 * 64 + 24, z: Math.floor(chunk / 4) * 64 + 16, yaw: 0 }] }));
}
function camp(kind = "core:tree", chunk = 6, heavy = false, options = {}) {
  const h = new Harness({}, 19, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: mapOf(kind, chunk), ...options }, registry);
  const s = h.join("tree-driver"); h.run(400); const c = h.client(s)!, a = h.world.ents, tree = nodesOf(h, kind, 0, 0)[0]!;
  const car = h.host.spawnVehicle(heavy ? "test:heavy-car" : "core:compact", tree.x, tree.z - 8, 0);
  expect(car).toBeGreaterThanOrEqual(0);
  a.setPosition(c.ent, tree.x + 1.6, 0, tree.z - 7.88); h.world.history.discontinuity(c.ent);
  expect(h.host.urban.mount(c, car)).toBe(RESULT_OK); h.run(900); expect(c.drive).toBe(car);
  const vehicle = h.host.records.byPid.get(a.pid[car]!)!, driver = h.host.records.byPid.get(c.pid)!, harvest = h.host.harvest!;
  const hp = () => h.host.survival.value(vehicle, V_HEALTH), crewHp = () => h.host.survival.value(driver, V_HEALTH);
  const tick = (throttle = 0) => { c.inputs.set(h.world.tick + 1, 0, throttle, 0, 0, 0); h.server.tick(); };
  return { h, s, c, a, car, tree, vehicle, driver, harvest, hp, crewHp, tick };
}

test("a fast native car fractures a small tree, pays momentum and hull health, and awards no harvest or occupant harm", () => {
  const s = camp(), { h, a, car, tree, harvest } = s;
  try {
    const inventory = [h.host.items.inv(s.driver).item.slice(), h.host.items.inv(s.driver).count.slice()], xp = s.driver.xp, hp = s.hp(), crew = s.crewHp();
    a.vz[car] = 20; let when = -1, before = 0, after = 0;
    for (let i = 0; i < 45; i++) {
      const speed = Math.hypot(a.vx[car]!, a.vy[car]!, a.vz[car]!); s.tick();
      if (when < 0 && harvest.crushed(tree.chunk, tree.index)) { when = i; before = speed; after = Math.hypot(a.vx[car]!, a.vy[car]!, a.vz[car]!); }
    }
    expect(when).toBeGreaterThanOrEqual(0); expect(after).toBeGreaterThan(8); expect(after).toBeLessThan(before - 2);
    expect(a.z[car]!).toBeGreaterThan(tree.z + 8); expect(s.hp()).toBeLessThan(hp); expect(s.hp()).toBeGreaterThan(hp - 100);
    expect(s.crewHp()).toBe(crew); expect(s.driver.xp).toBe(xp); expect([h.host.items.inv(s.driver).item.slice(), h.host.items.inv(s.driver).count.slice()]).toEqual(inventory);
    expect(harvest.field.store.chunks[tree.chunk]!.kind[tree.index]).toBe(0); expect(harvest.goneCount).toBe(1);
    const version = harvest.version[tree.chunk], health = s.hp(); for (let i = 0; i < 45; i++) s.tick();
    expect(harvest.version[tree.chunk]).toBe(version); expect(s.hp()).toBeGreaterThanOrEqual(health); expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});

for (const [kind, chunk, speed] of [["core:tree", 5, 34], ["core:tree", 6, 8], ["core:rock", 6, 34]] as const) {
  test(`a resisting ${kind} at chunk ${chunk} and ${speed}m/s stays solid and costs real speed`, () => {
    const s = camp(kind, chunk), { h, a, car, tree, harvest } = s;
    try {
      const hp = s.hp(); a.vz[car] = speed;
      for (let i = 0; i < 90; i++) s.tick();
      expect(harvest.goneCount).toBe(0); expect(harvest.field.standing(tree.chunk, tree.index)).toBe(h.reg.index.get(kind)!);
      expect(a.z[car]!).toBeLessThan(tree.z - 1); expect(Math.hypot(a.vx[car]!, a.vz[car]!)).toBeLessThan(speed * .2); expect(s.hp()).toBeLessThan(hp);
    } finally { h.host.shutdown(); }
  });
}

test("vehicle mass changes which impact can fracture the same authored tree", () => {
  for (const heavy of [false, true]) {
    const s = camp("core:tree", 6, heavy);
    try {
      s.a.vz[s.car] = 12; for (let i = 0; i < 90; i++) s.tick();
      expect(s.harvest.crushed(s.tree.chunk, s.tree.index)).toBe(heavy);
      if (heavy) expect(s.a.z[s.car]!).toBeGreaterThan(s.tree.z + 4);
      else expect(s.a.z[s.car]!).toBeLessThan(s.tree.z - 1);
    } finally { s.h.host.shutdown(); }
  }
});

test("continuous low-speed throttle cannot accumulate tree damage or repeatedly charge the car", () => {
  const s = camp();
  try {
    const { h, a, car, tree, harvest } = s;
    a.setPosition(car, tree.x, 0, tree.z - 2.4); h.world.history.discontinuity(car); a.vz[car] = 1;
    const hp = s.hp(), version = harvest.version[tree.chunk];
    for (let i = 0; i < 300; i++) s.tick(127);
    expect(harvest.version[tree.chunk]).toBe(version); expect(harvest.goneCount).toBe(0); expect(s.hp()).toBe(hp);
    expect(a.z[car]!).toBeLessThan(tree.z - 2); expect(Math.hypot(a.vx[car]!, a.vz[car]!)).toBeLessThan(.2);
    for (let i = 0; i < 90; i++) s.tick(-127);
    expect(a.z[car]!).toBeLessThan(tree.z - 5); expect(harvest.goneCount).toBe(0);
  } finally { s.h.host.shutdown(); }
});

test("an unpiloted native car meets and crushes a tree whose node chunk was never loaded", () => {
  const h = new Harness({}, 19, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: mapOf() }, registry);
  try {
    const tree = nodesOf(h, "core:tree", 0, 0)[0]!, field = h.world.nodeField!, a = h.world.ents;
    expect(field.isLoaded(tree.chunk)).toBe(false);
    const car = h.host.spawnVehicle("core:compact", tree.x, tree.z - 4, 0); expect(car).toBeGreaterThanOrEqual(0); a.vz[car] = 25;
    for (let i = 0; i < 30; i++) h.server.tick();
    expect(h.host.harvest!.crushed(tree.chunk, tree.index)).toBe(true); expect(field.isLoaded(tree.chunk)).toBe(false);
    expect(a.z[car]!).toBeGreaterThan(tree.z + 3);
    expect(placeFree(h.world, tree.x, 0, tree.z, .4, 1.8)).toBe(true);
  } finally { h.host.shutdown(); }
});

test("crushed trees replicate to a delayed observer, a late join and a reloaded node field, then regrow normally", () => {
  const s = camp("core:tree", 6, false, { config: fast }), { h, tree, harvest } = s;
  try {
    const observer = h.join("tree-witness", { latencyMs: 80, jitterMs: 10 }); h.run(1000);
    const seen: boolean[] = []; observer.onNode = (chunk, index, used, crushed) => { if (chunk === tree.chunk && index === tree.index && used) seen.push(crushed); };
    s.a.vz[s.car] = 20; for (let i = 0; i < 30; i++) s.tick(); h.run(600);
    expect(seen).toEqual([true]); expect(observer.nodeField!.store.chunks[tree.chunk]!.kind[tree.index]).toBe(0);
    const late = h.join("tree-late", { latencyMs: 40 }); const lateEvents: boolean[] = []; late.onNode = (_chunk, _index, used) => lateEvents.push(used); h.run(700);
    expect(late.nodeField!.store.chunks[tree.chunk]!.kind[tree.index]).toBe(0); expect(lateEvents).toEqual([]);
    // Move every survivor well away: authoritative and client node stores are evicted before this tree grows back.
    for (const client of [s.c, h.client(observer)!, h.client(late)!]) {
      if (client.drive >= 0) { h.host.urban.dismount(client); h.run(900); }
      h.world.ents.setPosition(client.ent, 12 + client.ent, 0, 12); h.world.history.discontinuity(client.ent);
    }
    observer.holdNodes(0); late.holdNodes(0); h.run(500);
    expect(observer.nodeField!.isLoaded(tree.chunk)).toBe(false);
    // Reload from the session cache before regrowth, without making a speculative change to either world.
    observer.own.x = tree.x + 4; observer.own.z = tree.z; observer.holdNodes(1);
    expect(observer.nodeField!.isLoaded(tree.chunk)).toBe(true);
    expect(observer.nodeField!.store.chunks[tree.chunk]?.kind[tree.index] ?? 0).toBe(0);
    observer.own.x = 12; observer.own.z = 12; observer.holdNodes(0);
    const deadline = harvest.regrowsAt(tree.chunk, tree.index); expect(deadline).toBeGreaterThan(0);
    while (h.world.tick <= deadline + 2) h.server.tick(); h.run(400);
    expect(harvest.crushed(tree.chunk, tree.index)).toBe(false); expect(harvest.regrowsAt(tree.chunk, tree.index)).toBe(0);
    const client = h.client(observer)!; h.world.ents.setPosition(client.ent, tree.x + 4, 0, tree.z); h.world.history.discontinuity(client.ent); h.run(800);
    expect(observer.nodeField!.standing(tree.chunk, tree.index)).toBe(tree.kind);
    expect(observer.nodeField!.store.chunks[tree.chunk]!.kind[tree.index]).toBe(tree.form);
    // A new complete impact episode can fell the regrown tree once, with one version increment.
    h.world.ents.setPosition(s.c.ent, 12, 0, 12); h.world.history.discontinuity(s.c.ent);
    const again = h.host.spawnVehicle("core:compact", tree.x, tree.z - 4, 0); expect(again).toBeGreaterThanOrEqual(0);
    h.world.ents.vz[again] = 25; const version = harvest.version[tree.chunk]!;
    for (let i = 0; i < 30; i++) h.server.tick();
    expect(harvest.crushed(tree.chunk, tree.index)).toBe(true); expect(harvest.version[tree.chunk]).toBe(version + 1);
  } finally { h.host.shutdown(); }
});

test("current SQLite node state keeps collision-crushed trees clear while ordinary harvested trees keep their stump", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-crushed-tree-")), path = join(dir, "world.db"), map = mapOf();
  let h: Harness | null = null;
  try {
    const s = camp("core:tree", 6, false, { dbPath: path }); h = s.h;
    s.a.vz[s.car] = 20; for (let i = 0; i < 30; i++) s.tick();
    const { tree } = s, due = s.harvest.regrowsAt(tree.chunk, tree.index); expect(due).toBeGreaterThan(0);
    h.host.shutdown(); h = new Harness({}, 19, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath: path, map }, registry);
    expect(h.world.nodeField!.isLoaded(tree.chunk)).toBe(false);
    expect(h.host.harvest!.regrowsAt(tree.chunk, tree.index)).toBe(due); expect(h.host.harvest!.crushed(tree.chunk, tree.index)).toBe(true);
    expect(placeFree(h.world, tree.x, 0, tree.z, .4, 1.8)).toBe(true);
    const joined = h.join("after-restart", { latencyMs: 60 }); h.run(800);
    expect(joined.nodeField!.store.chunks[tree.chunk]!.kind[tree.index]).toBe(0);
    const malformed = new BitWriter(32); malformed.varint(1); malformed.u8(tree.index); malformed.varint(2); malformed.uint53(due);
    expect(() => h!.host.harvest!.decode(tree.chunk, malformed.bytes())).toThrow("invalid saved node depletion mode");
    const crushed = new BitWriter(32); crushed.varint(1); crushed.u8(tree.index); crushed.varint(1); crushed.uint53(due);
    expect(h.host.harvest!.encode(tree.chunk)).toEqual(crushed.bytes());
    h.host.shutdown(); h = null;

    const ordinary = camp(); h = ordinary.h;
    while (ordinary.harvest.field.standing(ordinary.tree.chunk, ordinary.tree.index)) ordinary.harvest.strike(ordinary.c, ordinary.tree.chunk, ordinary.tree.index);
    expect(ordinary.harvest.crushed(ordinary.tree.chunk, ordinary.tree.index)).toBe(false);
    const unchanged = new BitWriter(32); unchanged.varint(1); unchanged.u8(ordinary.tree.index); unchanged.varint(0); unchanged.uint53(ordinary.harvest.regrowsAt(ordinary.tree.chunk, ordinary.tree.index));
    expect(ordinary.harvest.encode(ordinary.tree.chunk)).toEqual(unchanged.bytes());
    expect(ordinary.harvest.field.store.chunks[ordinary.tree.chunk]!.kind[ordinary.tree.index]).toBe(ordinary.harvest.field.forms.left[ordinary.tree.form]!);
  } finally { h?.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test("a cold tree across both chunk edges is included in a diagonal car's native swept collision", () => {
  const first = new Uint32Array(17); for (let i = 7; i < 17; i++) first[i] = 1;
  const map = writeMap(flatMap(4, { nodes: [{ kinds: ["core:tree"], first, kind: new Uint8Array([0]), x: new Uint16Array([256]), z: new Uint16Array([256]), yaw: new Uint16Array([0]) }] }));
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map }, registry);
  try {
    const a = h.world.ents, tree = nodesOf(h, "core:tree", 0, 0)[0]!;
    expect(h.world.nodeField!.isLoaded(tree.chunk)).toBe(false);
    const car = h.host.spawnVehicle("core:compact", tree.x - 5, tree.z - 5, 8192); expect(car).toBeGreaterThanOrEqual(0);
    expect(a.x[car]!).toBeLessThan(128); expect(a.z[car]!).toBeLessThan(64);
    a.vx[car] = 25; a.vz[car] = 25;
    let lost = 0;
    for (let i = 0; i < 30; i++) { const before = Math.hypot(a.vx[car]!, a.vz[car]!); h.server.tick(); lost = Math.max(lost, before - Math.hypot(a.vx[car]!, a.vz[car]!)); }
    expect(h.host.harvest!.crushed(tree.chunk, tree.index)).toBe(true); expect(lost).toBeGreaterThan(1);
    expect(a.x[car]!).toBeGreaterThan(tree.x + 2); expect(a.z[car]!).toBeGreaterThan(tree.z + 2);
    expect(h.world.nodeField!.isLoaded(tree.chunk)).toBe(false);
  } finally { h.host.shutdown(); }
});

test("a joining client behind a buffered TCP feed eventually collides with the same cleared tree state", () => {
  const s = camp(), { h, tree } = s;
  try {
    s.a.vz[s.car] = 20; for (let i = 0; i < 30; i++) s.tick();
    expect(s.harvest.crushed(tree.chunk, tree.index)).toBe(true);
    const late = h.join("buffered-tree", { tcp: true, latencyMs: 75, bytesPerSecond: 4000, sendBuffer: 2048, notSent: 1024 });
    let effects = 0; late.onNode = () => effects++; h.run(8000);
    expect(late.state).toBe("active"); expect(late.nodeField!.store.chunks[tree.chunk]!.kind[tree.index]).toBe(0);
    expect(effects).toBe(0); expect(late.world!.nodes!.chunks[tree.chunk]!.kind[tree.index]).toBe(s.harvest.field.store.chunks[tree.chunk]!.kind[tree.index]);
  } finally { h.host.shutdown(); }
});
