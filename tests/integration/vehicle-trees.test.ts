import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { COMPACT_SPECIES, COMPACT_VEHICLE } from "../../content/vehicles/compact.ts";
import { VehicleTrees } from "../../server/vehicle-trees.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { Body } from "../../shared/sim/character.ts";
import { ROLE_FOUNDATION } from "../../shared/world/snap.ts";
import { placeFree } from "../../server/place.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { frameKey } from "../../shared/coords.ts";
import { formOf, mix, nodeForms } from "../../shared/world/nodes.ts";
import { vehicleStep } from "../../shared/sim/vehicle-body.ts";
import { parseMap, writeMap } from "../../shared/world/mapfile.ts";
import { nodesOf } from "../fixtures/gather.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

const made = compileContent([...CORE_CONTENT, { ...COMPACT_SPECIES, id: "test:heavy-car", aliases: [], mass: 2200,
  vehicle: { ...COMPACT_VEHICLE, id: "test:heavy-car", spec: { ...COMPACT_VEHICLE.spec, mass: 2200 } } }]);
if (!made.registry) throw new Error(made.errors.join("\n"));
const registry = made.registry;
const fast = loadConfig({ gus: "[ServerSettings]\nResourcesRespawnPeriodMultiplier=0.001", game: "" }).rules;

function mapOf(kind = "core:tree", chunk = 6, width = 4, form?: number) {
  let yaw = 0;
  if (form !== undefined) {
    const forms = nodeForms(registry), dims = parseMap(writeMap(flatMap(width))).dims;
    while (yaw < 65536 && formOf(forms, registry.index.get(kind)!, mix(frameKey(dims, chunk) * 256, 24 * 1024 | (28 * 1024 << 16), yaw)) !== form) yaw++;
    if (yaw === 65536) throw new Error("missing authored form");
  }
  const first = new Uint32Array(width * width + 1); for (let i = chunk + 1; i < first.length; i++) first[i] = 1;
  return writeMap(flatMap(width, { nodes: [{ kinds: [kind], first, kind: new Uint8Array([0]), x: new Uint16Array([24 * 1024]), z: new Uint16Array([28 * 1024]), yaw: new Uint16Array([yaw]) }],
    spawns: [{ name: "Driver", x: chunk % width * 64 + 24, z: Math.floor(chunk / width) * 64 + 16, yaw: 0 }] }));
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
      s.a.vz[s.car] = 10; for (let i = 0; i < 90; i++) s.tick();
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
    const car = h.host.spawnVehicle("core:compact", tree.x - 5, tree.z - 5, 0, Math.PI / 4); expect(car).toBeGreaterThanOrEqual(0);
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


test("a harvested stump can be crushed without resetting its deadline, granting rewards or hiding that mode change from a witness", () => {
  const s = camp(), { h, tree, harvest, car, a } = s;
  try {
    while (harvest.field.standing(tree.chunk, tree.index)) harvest.strike(s.c, tree.chunk, tree.index);
    const due = harvest.regrowsAt(tree.chunk, tree.index), version = harvest.version[tree.chunk]!, hp = s.hp(), xp = s.driver.xp;
    const inv = h.host.items.inv(s.driver), inventory = [inv.item.slice(), inv.count.slice()];
    const witness = h.join("stump-witness", { latencyMs: 40 }); h.run(800);
    const form = harvest.field.store.chunks[tree.chunk]!.kind[tree.index]!;
    expect(form).toBe(harvest.field.forms.left[tree.form]!);
    expect(witness.nodeField!.store.chunks[tree.chunk]!.kind[tree.index]).toBe(form);
    const changes: [boolean, number | undefined][] = [];
    witness.onNode = (chunk, slot, used, crushed, prior) => { if (chunk === tree.chunk && slot === tree.index && used) changes.push([crushed, prior]); };
    a.vz[car] = 15; for (let i = 0; i < 60; i++) s.tick(); h.run(600);
    expect(harvest.crushed(tree.chunk, tree.index)).toBe(true); expect(harvest.regrowsAt(tree.chunk, tree.index)).toBe(due);
    expect(harvest.version[tree.chunk]).toBe(version + 1); expect(a.z[car]!).toBeGreaterThan(tree.z + 5);
    expect(hp - s.hp()).toBeLessThan(10); expect(s.driver.xp).toBe(xp); expect([inv.item.slice(), inv.count.slice()]).toEqual(inventory);
    expect(changes).toEqual([[true, form]]); expect(witness.nodeField!.store.chunks[tree.chunk]!.kind[tree.index]).toBe(0);
  } finally { h.host.shutdown(); }
});

for (const obstruction of ["nearby-base", "wall", "roof", "bonnet-hot", "boot-cold"] as const) {
  test(`crushed cover regrows beside a base but waits for actual ${obstruction} occupancy to clear`, () => {
    const s = camp("core:tree", 6, false, { config: fast, map: mapOf("core:tree", 6, 12) }), { h, a, car, tree, harvest } = s;
    try {
      a.vz[car] = 20; for (let i = 0; i < 45; i++) s.tick(); expect(harvest.crushed(tree.chunk, tree.index)).toBe(true);
      h.host.urban.dismount(s.c); h.run(900); a.setPosition(s.c.ent, 12, 0, 12); h.world.history.discontinuity(s.c.ent);
      a.setPosition(car, tree.x + 30, 0, tree.z); h.world.history.discontinuity(car); a.vx[car] = a.vy[car] = a.vz[car] = 0;
      let placed = -1;
      if (obstruction === "nearby-base") placed = h.world.structs.add(h.reg.role.findIndex(role => role === ROLE_FOUNDATION), tree.x + 10, 0, tree.z, 0, 777, 1000);
      if (obstruction === "wall" || obstruction === "roof") placed = h.world.structs.add(h.reg.index.get(obstruction === "wall" ? "core:wall" : "core:ceiling")!, tree.x, obstruction === "roof" ? 2 : 0, tree.z, 0, 777, 1000);
      if (obstruction.startsWith("bonnet") || obstruction.startsWith("boot")) {
        a.setPosition(car, tree.x, 0, tree.z + (obstruction === "boot-cold" ? 1.5 : -1.2)); h.world.history.discontinuity(car);
      }
      if (obstruction === "bonnet-hot") harvest.retain(tree.chunk, 0, 1);
      const deadline = harvest.regrowsAt(tree.chunk, tree.index);
      while (h.world.tick <= deadline + 2) h.server.tick();
      expect(harvest.crushed(tree.chunk, tree.index)).toBe(obstruction !== "nearby-base");
      if (obstruction === "boot-cold") expect(harvest.field.isLoaded(tree.chunk)).toBe(false);
      if (placed >= 0 && obstruction !== "nearby-base") h.world.structs.remove(placed);
      a.setPosition(car, tree.x + 30, 0, tree.z); h.world.history.discontinuity(car);
      const retry = harvest.regrowsAt(tree.chunk, tree.index); while (h.world.tick <= retry + 2) h.server.tick();
      expect(harvest.crushed(tree.chunk, tree.index)).toBe(false); expect(harvest.regrowsAt(tree.chunk, tree.index)).toBe(0);
      expect(harvest.field.kindAt(tree.chunk, tree.index)).toBe(tree.kind);
      if (obstruction === "bonnet-hot") harvest.retain(tree.chunk, 0, -1);
    } finally { h.host.shutdown(); }
  });
}

for (const kind of ["core:oak", "core:fig", "core:banyan", "core:mangrove"]) {
  test(`actual mature ${kind} resists a 26m/s compact with five tonnes of inventory`, () => {
    const s = camp(kind), { h, a, car, tree, harvest } = s;
    try {
      const cargo = h.reg.index.get("core:piece_foundation_stone")!;
      for (let i = 0; i < 9; i++) expect(h.host.items.mint(s.vehicle, cargo, 100, 0, 0, -1, "test")).toBeGreaterThan(0);
      h.run(100); expect(a.vehiclePayloadMass[a.vrow[car]!]!).toBeGreaterThan(5000);
      const hp = s.hp(); a.vz[car] = 26; for (let i = 0; i < 90; i++) s.tick();
      expect(harvest.crushed(tree.chunk, tree.index)).toBe(false); expect(a.z[car]!).toBeLessThan(tree.z - 1);
      expect(Math.hypot(a.vx[car]!, a.vz[car]!)).toBeLessThan(2); expect(s.hp()).toBeLessThan(hp);
      expect(harvest.field.standing(tree.chunk, tree.index)).toBe(tree.kind);
    } finally { h.host.shutdown(); }
  });
}

test("sleeping cold cars do not load trees for their heartbeat, but a moving car still acquires and fractures them", () => {
  const h = new Harness({}, 19, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: mapOf() }, registry);
  try {
    const harvest = h.host.harvest!, tree = nodesOf(h, "core:tree", 0, 0)[0]!, trees = new VehicleTrees(h.world, harvest), body = new Body();
    body.kind = h.reg.index.get("core:compact")!; body.vehicle = true; body.x = tree.x; body.z = tree.z - 4; body.grounded = true;
    const source = harvest.field.source, at = source.at.bind(source); let reads = 0;
    source.at = (chunk, index, out) => { reads++; at(chunk, index, out); };
    for (let i = 0; i < 90; i++) trees.step(h.world, body, 0, 0, 0, COMPACT_VEHICLE, undefined, undefined, false);
    expect(reads).toBe(0); expect(harvest.field.isLoaded(tree.chunk)).toBe(false);
    body.vz = 25;
    for (let i = 0; i < 30; i++) trees.step(h.world, body, 0, 0, 0, COMPACT_VEHICLE, undefined, undefined, false);
    expect(reads).toBeGreaterThan(0); expect(harvest.crushed(tree.chunk, tree.index)).toBe(true); expect(body.z).toBeGreaterThan(tree.z + 3);
    expect(harvest.field.isLoaded(tree.chunk)).toBe(false);
  } finally { h.host.shutdown(); }
});


for (const [name, offset, heading] of [["head-on", 0, 0], ["corner", .7, 0], ["glancing", 0, Math.PI / 6]] as const) {
  test(`native ${name} impacts give graded hull damage across a young trunk's breaking threshold`, () => {
    const forms = nodeForms(registry), form = forms.first[registry.index.get("core:tree")!]! + 8;
    let previousDamage = -1, stopped = 0, broken = 0;
    for (const speed of [9, 10, 11, 12, 15, 20]) {
      const s = camp("core:tree", 6, false, { map: mapOf("core:tree", 6, 4, form) }), { h, a, car, tree, harvest } = s;
      try {
        expect(tree.form).toBe(form); const fx = Math.sin(heading), fz = Math.cos(heading), v = a.vrow[car]!;
        a.setPosition(car, tree.x - fx * 8 + fz * offset, 0, tree.z - fz * 8 - fx * offset); h.world.history.discontinuity(car);
        a.vehicleYaw[v] = heading; a.vehicleQy[v] = Math.sin(heading / 2); a.vehicleQw[v] = Math.cos(heading / 2);
        a.vx[car] = fx * speed; a.vz[car] = fz * speed;
        const hp = s.hp(); for (let i = 0; i < 90; i++) s.tick();
        const damage = hp - s.hp(); expect(damage).toBeGreaterThanOrEqual(previousDamage - 1); previousDamage = damage;
        expect(Number.isFinite(a.vehicleYawRate[v]!)).toBe(true); expect(Math.hypot(a.vx[car]!, a.vz[car]!)).toBeLessThan(speed);
        if (harvest.crushed(tree.chunk, tree.index)) { broken++; expect(damage).toBeGreaterThan(0); }
        else { stopped++; expect(Math.hypot(a.vx[car]!, a.vz[car]!)).toBeLessThan(1); }
      } finally { h.host.shutdown(); }
    }
    expect(stopped).toBeGreaterThan(0); expect(broken).toBeGreaterThan(0);
  });
}

test("an actual falling car's successful upward tree fracture reports landing speed, not a wall crash", () => {
  const forms = nodeForms(registry), form = forms.first[registry.index.get("core:tree")!]! + 8;
  const s = camp("core:tree", 6, false, { map: mapOf("core:tree", 6, 4, form) }), { h, a, car, tree } = s;
  try {
    a.setPosition(car, tree.x, 6, tree.z - .5); h.world.history.discontinuity(car); a.flags[car] = a.flags[car]! & ~F_GROUNDED; a.vy[car] = -14; a.vz[car] = 2;
    let landing = 0, wall = 0, fractured = false;
    for (let i = 0; i < 60; i++) {
      const was = s.harvest.crushed(tree.chunk, tree.index); s.tick();
      if (!was && s.harvest.crushed(tree.chunk, tree.index)) { fractured = true; landing = vehicleStep.landSpeed; wall = vehicleStep.impactSpeed; }
    }
    expect(fractured).toBe(true); expect(landing).toBeGreaterThan(6); expect(wall).toBe(0);
  } finally { h.host.shutdown(); }
});
