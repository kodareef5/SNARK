// A client's view says why a body left it: it died, or it is simply gone. Told on a clean line and on a lossy one, near
// and far in the view, a creature and a survivor; and not for a creature that walks out of the view or a survivor who
// leaves the game.
import { expect, test } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { Harness } from "../fixtures/net.ts";

test("a body that dies is told to every client as dead, and one that leaves the view or the game is told only as gone", () => {
  const h = new Harness();
  const ada = h.join("ada");
  // Cy's line loses a fifth of its datagrams, so some removes reach her only when they are told again.
  const cy = h.join("cy", { loss: 0.2 });
  const bob = h.join("bob");
  h.run(2000);
  const ents = h.world.ents;
  const [x, z] = [ents.x[h.ent(ada)]!, ents.z[h.ent(ada)]!];
  const near = h.host.spawnCreature("core:raptor", x + 8, z, 1);
  const far = h.host.spawnCreature("core:parasaur", x + 150, z, 1);
  const leaves = h.host.spawnCreature("core:raptor", x - 10, z + 12, 1);
  for (const e of [near, far, leaves]) h.host.creatures.mind.stay(e, h.world.tick + 30000);
  h.run(2000);
  const seen = (s: typeof ada): RemoteSample => {
    const r = new RemoteSample();
    s.sampleRemote(r);
    return r;
  };
  const ids = [near, far, leaves, h.ent(bob)];
  for (const s of [ada, cy]) expect(ids.map((e) => [...seen(s).id.subarray(0, seen(s).count)].includes(e))).toEqual([true, true, true, true]);

  // The two creatures die, the third is moved out of everyone's view, and Bob dies.
  const rec = (e: number) => h.host.records.byPid.get(ents.pid[e]!)!;
  h.host.survival.hurt(rec(near), 1e6, 0);
  h.host.survival.hurt(rec(far), 1e6, 0);
  ents.setPosition(leaves, x + 900, ents.y[leaves]!, z + 900);
  const bobId = h.ent(bob);
  h.host.survival.hurt(h.host.records.byPid.get(ents.pid[bobId]!)!, 1e6, 0);
  h.run(1500);
  for (const s of [ada, cy]) {
    const died = seen(s).died;
    expect([died.has(near), died.has(far), died.has(leaves), died.has(bobId)]).toEqual([true, true, false, true]);
  }
});

test("a survivor who leaves the game is told as gone, not dead", () => {
  const h = new Harness();
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(2000);
  const bobId = h.ent(bob);
  // The body stays five seconds for a reconnect, then goes.
  bob.close();
  h.run(7000);
  const r = new RemoteSample();
  ada.sampleRemote(r);
  expect([[...r.id.subarray(0, r.count)].includes(bobId), r.died.has(bobId)]).toEqual([false, false]);
});
