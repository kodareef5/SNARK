// Child process for the crash test. It prints "acked <seq>" only once the commit has returned, and the parent kills it without warning.
// Usage: bun tests/fixtures/crash-child.ts <db path> <seed>

import { writeSync } from "node:fs";
import { createHost } from "../../server/host.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { Rng } from "../../shared/rng.ts";
import { coreRegistry } from "./world.ts";

export const HOLDERS = 8;
export const START = 1000;
export const OP_TRANSFER = 1;
export const OP_MINT = 11;
export const OP_BURN = 12;

/** The "death" mode. Survivors die, are looted and return, with each step committed and acknowledged like the trades. */
function deathLoop(dbPath: string, seed: number): never {
  const reg = coreRegistry();
  const host = createHost(reg, { dbPath });
  const p = host.persistence!;
  const stone = reg.index.get("core:stone")!;
  const berry = reg.index.get("core:berry")!;
  const survivor = reg.index.get("core:survivor")!;
  if (host.loaded!.fresh) {
    for (let i = 0; i < HOLDERS; i++) {
      const rec = host.records.create(survivor, `mortal${i}`);
      p.bindSurvivor(rec.name, rec.pid);
      host.items.mint(rec, stone, 300);
      host.items.mint(rec, berry, 40);
    }
    p.commit();
  }
  const rng = new Rng(seed);
  const survivors = [...p.survivors.values()].map((pid) => host.records.byPid.get(pid)!);
  writeSync(1, "ready\n");
  for (;;) {
    for (let n = 1 + rng.int(4); n > 0; n--) {
      const rec = survivors[rng.int(survivors.length)]!;
      const caches = [...host.records.byPid.values()].filter((r) => r.expiresAt > 0);
      const k = rng.int(4);
      if (k === 0 && !rec.dead) host.death.die(rec, 1 + rng.int(5));
      else if (k === 1 && rec.dead) {
        // There is no session here, so this does by hand what a respawn does to the record.
        rec.dead = false;
        host.records.dirty.add(rec.pid);
      } else if (k === 2 && caches.length > 0 && !rec.dead) {
        const cache = caches[rng.int(caches.length)]!;
        const inv = host.items.inv(cache);
        for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0 && rng.int(2) === 0) host.items.give(cache, rec, inv.item[s]!, inv.count[s]!);
        if (host.items.inv(cache).used() === 0) host.death.remove(cache);
      } else if (k === 3 && !rec.dead) host.items.mint(rec, rng.int(2) === 0 ? stone : berry, 1 + rng.int(30));
    }
    host.world.tick += 1 + rng.int(40);
    p.commit();
    writeSync(1, `acked ${p.durableSeq + p.commits}\n`);
  }
}

if (import.meta.main) {
  const [dbPath, seed, mode] = process.argv.slice(2);
  if (mode === "death") deathLoop(dbPath!, Number(seed));
  const reg = coreRegistry();
  const host = createHost(reg, { dbPath: dbPath! });
  const p = host.persistence!;
  const stone = reg.index.get("core:stone")!;
  const grazer = reg.index.get("core:grazer")!;
  if (host.loaded!.fresh) {
    for (let i = 0; i < HOLDERS; i++) host.items.mint(host.records.create(grazer, `holder${i}`), stone, START);
    p.commit();
  }
  const pids = [...host.records.byPid.keys()].sort((a, b) => a - b);
  const rec = (pid: number) => host.records.byPid.get(pid)!;
  const rng = new Rng(Number(seed));
  const w = new BitWriter(64);
  writeSync(1, "ready\n");
  for (;;) {
    for (let n = 1 + rng.int(6); n > 0; n--) {
      const from = pids[rng.int(HOLDERS)]!;
      const to = pids[rng.int(HOLDERS)]!;
      const count = 1 + rng.int(40);
      const kind = rng.int(8);
      w.reset();
      w.uint53(from);
      if (kind === 0) {
        const made = host.items.mint(rec(from), stone, count);
        if (made === 0) continue;
        w.varint(made);
        p.journal(OP_MINT, w.bytes());
      } else if (kind === 1) {
        if (!host.items.burnItem(rec(from), stone, count)) continue;
        w.varint(count);
        p.journal(OP_BURN, w.bytes());
      } else {
        if (!host.items.give(rec(from), rec(to), stone, count)) continue;
        w.uint53(to);
        w.varint(count);
        p.journal(OP_TRANSFER, w.bytes());
      }
    }
    host.world.tick++;
    p.commit();
    writeSync(1, `acked ${p.durableSeq}\n`);
  }
}
