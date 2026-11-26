// Cast's people are drawn from populations: each body a different person of either sex, sent as the seed it was made
// from, and the client draws the look the server made.

import { expect, test } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { CAST_CATALOGUE } from "../../content/cast/index.ts";
import { LOOK_BYTES, LOOK_SEX } from "../../shared/anim/look.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { EntityView, SentView, quantX, quantY, readViewDelta, writeViewDelta, type Looks } from "../../shared/net/view.ts";
import { lookOfSeed, personFrom, populationsOf } from "../../shared/people/person.ts";
import { Rng } from "../../shared/rng.ts";
import { Harness } from "../fixtures/net.ts";

const ARCHETYPES = ["cast:beachgoer", "cast:tourist", "cast:jogger", "cast:pedestrian", "cast:worker"];

/** A world with Cast on, one survivor, and `n` of Cast's people stood about her. */
function crowd(n: number) {
  const h = new Harness({ entityRadius: 1 }, 3, 30, { cast: { size: 30, activity: 0, hostility: 0 }, wakeRadius: 1 });
  const ana = h.join("Ana");
  h.run(1500);
  const cast = h.host.cast!;
  const bodies = cast.stage["bodies"];
  const at = h.client(ana)!.body;
  const rng = new Rng(17), ents: number[] = [];
  for (let k = 0; ents.length < n && k < n * 4; k++) {
    const c = cast.cast.people.mint(ARCHETYPES[k % ARCHETYPES.length]!, 0, rng.u32(), h.world.tick);
    const a = cast.cast.people.archetype(c.archetype)!;
    const ring = 4 + (k % 12) * 1.5, turn = (k * 2.39996) % (Math.PI * 2);
    const pid = bodies.spawn(c, a, at.x + Math.sin(turn) * ring, at.z + Math.cos(turn) * ring, 0);
    if (pid >= 0) ents.push(h.host.records.entOf.get(pid)!);
  }
  return { h, ana, ents };
}

test("Cast's bodies are varied people of both sexes, each sent as its seed", () => {
  const { h, ana, ents } = crowd(200);
  try {
    expect(ents.length).toBe(200);
    const w = h.world.ents, people = populationsOf(h.world.reg);
    const looks = new Set<string>(), sexes = [0, 0];
    for (const e of ents) {
      const look = w.looks.get(e)!, born = w.born.get(e)!;
      expect([...personFrom(born.seed, people.list[born.population]!).look]).toEqual([...look]);
      looks.add(look.join());
      sexes[look[LOOK_SEX]!]!++;
      // A first name the catalogue knows is drawn as its sex.
      const sex = CAST_CATALOGUE.sexes![w.names.get(e)!.split(" ")[0]!];
      if (sex !== undefined) expect([w.names.get(e), look[LOOK_SEX]]).toEqual([w.names.get(e), sex]);
    }
    expect(looks.size).toBe(200);
    expect(Math.min(...sexes)).toBeGreaterThan(40);

    // The client holds each one's look as the server made it.
    h.run(3000);
    const seen = new RemoteSample();
    ana.sampleRemote(seen);
    let shown = 0;
    for (let i = 0; i < seen.count; i++) {
      const e = seen.id[i]!;
      if (!ents.includes(e)) continue;
      expect(seen.hasLook[i]).toBe(1);
      expect([...seen.look.subarray(i * LOOK_BYTES, (i + 1) * LOOK_BYTES)]).toEqual([...w.looks.get(e)!]);
      shown++;
    }
    expect(shown).toBeGreaterThan(150);
  } finally {
    h.host.shutdown();
  }
});

test("200 of Cast's people come into view in 11 KB", () => {
  const { h, ents } = crowd(200);
  try {
    const w = h.world.ents;
    const view = new SentView();
    view.tick = 1;
    for (const e of [...ents].sort((a, b) => a - b)) view.push(e, w.gen[e]!, w.kind[e]!, quantX(w.x[e]!), quantY(w.y[e]!), quantX(w.z[e]!), w.yaw[e]! >>> 6, 0, w.anim[e]!, w.rev[e]!, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, w.identityRev[e]!);
    const bytes = (looks: Looks) => {
      const out = new BitWriter(1 << 18), next = new SentView();
      writeViewDelta(out, null, view, next, 1 << 21, 0, looks, -1, null, 4096);
      expect(out.overflow).toBe(false);
      return out.bytes().slice();
    };
    const seeded = bytes(w);
    const whole = bytes({ level: w.level, colors: w.colors, names: w.names, looks: w.looks, gears: w.gears, on: w.on, team: w.team, seat: w.seat, span: w.span, grown: w.grown });
    console.log(`200 creates: ${(seeded.length / 1024).toFixed(2)} KB as seeds, ${(whole.length / 1024).toFixed(2)} KB with their looks`);
    expect(seeded.length).toBeLessThanOrEqual(11 * 1024);
    // Read back, each look is the server's.
    const r = new BitReader();
    r.reset(seeded);
    const got = new EntityView();
    expect(readViewDelta(r, null, got, null, null, null, null, (seed, p, rev) => lookOfSeed(h.world.reg, seed, p, rev))).toBe(true);
    expect(got.count).toBe(200);
    for (let i = 0; i < got.count; i++) expect([...got.look[i]!]).toEqual([...w.looks.get(got.id[i]!)!]);
  } finally {
    h.host.shutdown();
  }
});
