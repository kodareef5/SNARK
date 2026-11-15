// Child process for the corpse crash test. Survivors harvest creatures' bodies, and new ones are killed, each step journalled
// with what it did and committed before it prints "acked <seq>"; the parent kills it without warning.
// Usage: bun tests/fixtures/corpse-child.ts <db path> <seed>

import { writeSync } from "node:fs";
import { createHost } from "../../server/host.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { Rng } from "../../shared/rng.ts";
import { coreRegistry } from "./world.ts";

export const HARVESTERS = 4;
/** A blow: the body's pid, the harvester's, the harvest damage, and the count of each drop it gave in its drops' order. */
export const OP_BLOW = 21;
/** A body laid: its pid and its harvest health. */
export const OP_LAY = 22;
export const DROPS = ["core:hide", "core:meat"];

if (import.meta.main) {
  const [dbPath, seed] = process.argv.slice(2);
  const reg = coreRegistry();
  const host = createHost(reg, { dbPath: dbPath! });
  const p = host.persistence!;
  const survivor = reg.index.get("core:survivor")!;
  const tools = [0, reg.index.get("core:hatchet")!, reg.index.get("core:pick")!];
  const w = new BitWriter(64);
  const rng = new Rng(Number(seed));
  const spot = host.world.spawn;
  const lay = (): void => {
    const e = host.spawnCreature("core:dodo", spot.x + rng.range(-20, 20), spot.z + rng.range(-20, 20), 1 + rng.int(30));
    if (e < 0) return;
    const rec = host.records.byPid.get(host.world.ents.pid[e]!)!;
    const before = new Set(host.corpses.bodies.keys());
    host.survival.hurt(rec, 1e6, 0);
    for (const b of host.corpses.bodies.values()) {
      if (before.has(b.rec.pid)) continue;
      w.reset();
      w.uint53(b.rec.pid);
      w.f64(b.max);
      p.journal(OP_LAY, w.bytes());
    }
  };
  if (host.loaded!.fresh) {
    for (let i = 0; i < HARVESTERS; i++) p.bindSurvivor(`reaper${i}`, host.records.create(survivor, `reaper${i}`).pid);
    for (let i = 0; i < 6; i++) lay();
    p.commit();
  }
  const reapers = [...p.survivors.values()].map((pid) => host.records.byPid.get(pid)!);
  const items = DROPS.map((id) => reg.index.get(id)!);
  writeSync(1, "ready\n");
  for (;;) {
    for (let n = 1 + rng.int(4); n > 0; n--) {
      const bodies = [...host.corpses.bodies.values()];
      if (bodies.length < 3 || rng.int(8) === 0) {
        lay();
        continue;
      }
      const b = bodies[rng.int(bodies.length)]!;
      const by = reapers[rng.int(reapers.length)]!;
      const damage = 4 + rng.int(25);
      const taken = host.corpses.take(by, b, damage, tools[rng.int(tools.length)]!);
      w.reset();
      w.uint53(b.rec.pid);
      w.uint53(by.pid);
      w.varint(damage);
      for (let k = 0; k < items.length; k++) w.varint(taken.items[k] === items[k] ? taken.got[k]! + taken.bagged[k]! : 0);
      p.journal(OP_BLOW, w.bytes());
    }
    host.world.tick++;
    p.commit();
    writeSync(1, `acked ${p.durableSeq}\n`);
  }
}
