// Rows for creatures' bodies (server/corpses.ts): a hundred dodos killed in one place at once, what that costs the server
// while they fall and once they lie still, a swing among them, what a client that saw them die is sent and spends drawing
// their falls, and a client that comes upon them laying them all to rest. `bun tools/bench/corpses.ts` runs these alone.

import { Corpses as Drawn } from "../../client/core/ragdoll.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import type { Body } from "../../server/corpses.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { lookDirection } from "../../shared/world/ray.ts";
import type { LoopbackEnd } from "../../shared/net/loopback.ts";
import { flatGround } from "../../tests/fixtures/arena.ts";
import { Harness } from "../../tests/fixtures/net.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

/** The `q` quantile of `times`. */
const at = (times: number[], q: number): number => {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
};

export function benchCorpses(section: Section, record: Row): void {
  section("Bodies: a hundred dodos killed in one place at once");
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 30, 30);
  const [cx, cz] = [g.x + 15, g.z + 15];
  h.say(ada, `tp ${cx.toFixed(3)} ${(cz - 8).toFixed(3)}`, 300);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  h.host.survival.gods.add(me.pid);
  // Ten by ten, 70 cm apart: a pile when they fall.
  const dodos = [];
  for (let i = 0; i < 100; i++) {
    const e = h.host.spawnCreature("core:dodo", cx - 3.15 + (i % 10) * 0.7, cz - 3.15 + Math.floor(i / 10) * 0.7, 1 + (i % 30));
    h.host.creatures.mind.stay(e, 0xffffffff);
    dodos.push(h.host.records.byPid.get(h.world.ents.pid[e]!)!);
  }
  // Ada draws what she is sent, a frame each sixtieth of a second.
  const anims = h.world.anims;
  const sample = new RemoteSample();
  const watched = new Drawn(anims);
  const drawing: number[] = [];
  const draw = (s: ClientSession, d: Drawn, times: number[] | null): void => {
    s.sampleRemote(sample);
    const t = performance.now();
    d.update(sample, s.world!, cx, cz, new Map());
    times?.push(performance.now() - t);
  };
  h.run(1000, () => draw(ada, watched, null));
  const server = h.host.corpses;
  const step = server.step.bind(server);
  const steps: number[] = [];
  server.step = (tick: number) => {
    const t = performance.now();
    step(tick);
    steps.push(performance.now() - t);
  };
  const conn = h.client(ada)!.conn as LoopbackEnd;
  let sent = conn.bytesSent;
  h.run(1000, () => draw(ada, watched, null));
  const quiet = conn.bytesSent - sent;

  const t0 = performance.now();
  for (const rec of dodos) h.host.survival.hurt(rec, 1e6, me.pid);
  record("100 die in one tick: their bodies made and laid", performance.now() - t0, "ms", 15);
  const bodies = [...server.bodies.values()];
  sent = conn.bytesSent;
  steps.length = 0;
  h.run(1000, () => draw(ada, watched, drawing));
  record("the second they fall: bytes sent to a client watching, over a quiet second", conn.bytesSent - sent - quiet, "B");
  let ticks = steps.length;
  const falling = [...steps];
  while (bodies.some((b) => !b.fall!.still) && ticks < 20 * TICK_RATE) {
    steps.length = 0;
    h.run(1000 / 30, () => draw(ada, watched, drawing));
    falling.push(...steps);
    ticks += steps.length;
  }
  record("their falls stepped on the server, a tick, median", at(falling, 0.5), "ms", 3);
  record("their falls stepped on the server, worst tick", at(falling, 1), "ms", 10);
  record("ticks until all 100 lie still", ticks, "", 10 * TICK_RATE);
  record("of them the watching client played falling from its death clip", watched.list.filter((c) => c.watched).length, "", null);
  record("a client that saw them die: a frame of their falls, median", at(drawing, 0.5), "ms", 3);
  record("a client that saw them die: worst frame", at(drawing, 1), "ms", 16);
  steps.length = 0;
  h.run(2000);
  record("the 100 at rest on the server, a tick, median", at(steps, 0.5), "ms", 0.05);
  record("the 100 at rest on the server, worst tick (a look for what was built under them)", at(steps, 1), "ms", 0.5);

  // A survivor's swing at the pile: the cast that finds a body among a hundred, then the blow's yield.
  const d = [0, 0, 0];
  const swings: number[] = [];
  for (let k = 0; k < 400; k++) {
    const b = bodies[k % bodies.length] as Body;
    const m = server.middle(b);
    const [ox, oy, oz] = [m.x, m.y + 1, m.z - 1.2];
    const yaw = Math.round((Math.atan2(m.x - ox, m.z - oz) / (Math.PI * 2)) * 65536) & 0xffff;
    const pitch = Math.round((Math.atan2(m.y - oy, Math.hypot(m.x - ox, m.z - oz)) / (Math.PI / 2)) * 16384);
    lookDirection(yaw, pitch, d);
    const t = performance.now();
    server.cast(ox, oy, oz, d[0]!, d[1]!, d[2]!, 2.6);
    swings.push(performance.now() - t);
  }
  record("a swing's search among the 100 for the body it meets, median", at(swings, 0.5), "ms", 0.05);
  const blows: number[] = [];
  for (const b of bodies.slice(0, 50)) {
    const t = performance.now();
    server.take(me, b, 20, h.reg.index.get("core:hatchet")!);
    blows.push(performance.now() - t);
  }
  record("a hatchet's blow on one, the yield into her bag, median", at(blows, 0.5), "ms", 0.05);

  // Bob comes upon them, the ones still lying, and lays them to rest a budget of ticks a frame, nearest first.
  const bob = h.join("bob");
  h.run(800);
  h.say(bob, "enablecheats");
  h.say(bob, `tp ${(cx + 4).toFixed(3)} ${(cz - 8).toFixed(3)}`, 400);
  const came = new Drawn(anims);
  const laying: number[] = [];
  let frames = 0;
  h.run(1000 / 60, () => draw(bob, came, laying));
  for (frames = 1; came.list.some((c) => c.settling) && frames < 600; frames++) h.run(1000 / 60, () => draw(bob, came, laying));
  record("a client that comes upon them: frames to lay them all to rest", frames, "", 30);
  record("a client that comes upon them: worst frame", at(laying, 1), "ms", 16);
  server.step = step;
}

if (import.meta.main) {
  benchCorpses(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
