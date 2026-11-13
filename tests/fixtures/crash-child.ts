// Child process for the crash test. Trades items between holders forever,
// committing after every batch and printing "acked <seq>" only once the commit
// has returned. The parent kills it without warning.
//
//   bun tests/fixtures/crash-child.ts <db path> <seed>

import { writeSync } from "node:fs";
import { createHost } from "../../server/host.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { Rng } from "../../shared/rng.ts";
import { coreRegistry } from "./world.ts";

export const HOLDERS = 8;
export const START = 1000;
export const OP_TRANSFER = 1;

if (import.meta.main) {
  const [dbPath, seed] = process.argv.slice(2);
  const reg = coreRegistry();
  const host = createHost(reg, { dbPath: dbPath! });
  const p = host.persistence!;
  const stone = reg.index.get("core:stone")!;
  const grazer = reg.index.get("core:grazer")!;
  if (host.loaded!.fresh) {
    for (let i = 0; i < HOLDERS; i++) host.records.give(host.records.create(grazer, `holder${i}`).pid, stone, START);
    p.commit();
  }
  const pids = [...host.records.byPid.keys()].sort((a, b) => a - b);
  const rng = new Rng(Number(seed));
  const w = new BitWriter(64);
  writeSync(1, "ready\n");
  for (;;) {
    for (let n = 1 + rng.int(6); n > 0; n--) {
      const from = pids[rng.int(HOLDERS)]!;
      const to = pids[rng.int(HOLDERS)]!;
      const count = 1 + rng.int(40);
      if (!host.records.transfer(from, to, stone, count)) continue;
      w.reset();
      w.uint53(from);
      w.uint53(to);
      w.varint(count);
      p.journal(OP_TRANSFER, w.bytes());
    }
    host.world.tick++;
    p.commit();
    writeSync(1, `acked ${p.durableSeq}\n`);
  }
}
