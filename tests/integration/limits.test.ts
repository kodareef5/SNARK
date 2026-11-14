// Limits through a whole server and client: how many bodies each client is shown, and what happens to a snapshot that is too large.

import { expect, test } from "bun:test";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { chunkAt } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

function seen(s: ClientSession): RemoteSample {
  const out = new RemoteSample();
  s.sampleRemote(out);
  return out;
}

function has(sample: RemoteSample, name: string): boolean {
  for (let i = 0; i < sample.count; i++) if (sample.name[i] === name) return true;
  return false;
}

test("a server shows no client more than its cap, and each client its own share of that: two around one place, one shown 32 bodies and one 96", () => {
  const h = new Harness({ viewCap: 96 }, 1, 30, { dev: true });
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(600);
  h.say(ada, "enablecheats");
  h.say(bob, "enablecheats");
  const g = flatGround(h, 12, 12);
  const here = chunkAt(h.world.dims, g.x + 6, g.z + 6);
  // Bob stands two metres from her on whichever side is in her chunk.
  const side = chunkAt(h.world.dims, g.x + 8, g.z + 6) === here ? 2 : -2;
  h.say(ada, `tp ${(g.x + 6).toFixed(3)} ${(g.z + 6).toFixed(3)}`);
  h.say(bob, `tp ${(g.x + 6 + side).toFixed(3)} ${(g.z + 6).toFixed(3)}`);
  const rng = new Rng(5);
  let crowd = 0;
  for (let i = 0; i < 2000 && crowd < 150; i++) {
    const [x, z] = [g.x + rng.range(0.5, 11.5), g.z + rng.range(0.5, 11.5)];
    if (chunkAt(h.world.dims, x, z) === here && h.host.spawnCreature("core:dummy", x, z, 1) >= 0) crowd++;
  }
  expect(crowd).toBe(150);
  h.client(ada)!.viewCap = 32;
  h.run(3000);
  // Each one's own body is one of those it is allowed, and the other survivor comes before any of the crowd.
  const [hers, his] = [seen(ada), seen(bob)];
  expect([hers.count, his.count]).toEqual([31, 95]);
  expect([has(hers, "bob"), has(his, "ada")]).toEqual([true, true]);
  // One list was gathered for the place and both were sent from it.
  expect(h.client(ada)!.chunk).toBe(h.client(bob)!.chunk);
  expect(ada.stats.undecodable + bob.stats.undecodable).toBe(0);
  // With the cap lifted she is shown what he is.
  h.client(ada)!.viewCap = 96;
  h.run(2000);
  expect(seen(ada).count).toBe(95);
});

test("a snapshot that outgrows the server's writer is counted and not sent, and the client is whole again once one fits", () => {
  const h = new Harness({}, 3, 30);
  const watcher = h.join("watcher");
  h.run(1500);
  // The writer is sized for the budgets the server was made with. This one is set behind its back.
  h.server.opts.snapshotBytes = 60000;
  const kind = h.reg.index.get("core:grazer")!;
  const ents = h.world.ents;
  for (let i = 0; i < 450; i++) {
    const e = ents.create(kind, 236 + (i % 30) * 1.3, 0, 222 + Math.floor(i / 30) * 2, 0);
    ents.setLook(e, 100 + i, [3, 5, 6, 7, 9, 12], `creature number ${String(i).padStart(3, "0")}`.padEnd(24, "x"));
  }
  const made = h.world.tick;
  h.run(500);
  expect(h.server.stats.overflows).toBeGreaterThan(10);
  // No snapshot since they were made has reached the client, whole or in part.
  expect([watcher.latestSnapshot <= made, watcher.stats.undecodable, seen(watcher).count]).toEqual([true, 0, 0]);
  h.server.opts.snapshotBytes = 1100;
  const over = h.server.stats.overflows;
  h.run(3000);
  const all = seen(watcher);
  expect([h.server.stats.overflows - over, watcher.stats.undecodable, all.count]).toEqual([0, 0, 450]);
  expect(new Set(all.name.slice(0, 450)).size).toBe(450);
});
