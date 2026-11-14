// Benchmark rows for two costs the tests once timed: what a tick of history costs, and a ray against a posed body.
// A test asserts what is so on any machine. How long a thing takes belongs here.

import { History } from "../../server/history.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { rayBody } from "../../shared/anim/zones.ts";
import { EntityStore } from "../../shared/sim/entities.ts";
import { coreAnim } from "../../tests/fixtures/pack.ts";

export function benchPoses(section: (title: string) => void, record: (name: string, value: number, unit: string, budget?: number | null) => void): void {
  section("History and rays against bodies");
  const ents = new EntityStore({ chunksX: 4, chunksZ: 4 }, 300000);
  for (let i = 0; i < 300000; i++) ents.create(1, (i % 200) + 10, 0, (Math.floor(i / 200) % 200) + 10, 0);
  const history = new History(ents);
  for (let e = 0; e < 5000; e++) history.track(e * 7);
  let t0 = performance.now();
  for (let tick = 1; tick <= 300; tick++) history.record(tick);
  record("history: a tick with 5,000 awake among 300,000", (performance.now() - t0) / 300, "ms", 0.3);

  const anim = coreAnim();
  const st = new AnimState();
  st.unpack(0);
  st.speed = 7;
  const rounds = 20000;
  let hits = 0;
  t0 = performance.now();
  for (let i = 0; i < rounds; i++) {
    if (rayBody(anim, st, i * 0.37, 100, 0, 100, (i * 311) & 0xffff, 100.1, 1.1 + (i % 7) * 0.1, 96, 0, 0, 1, 20) !== 0) hits++;
  }
  record("a ray against a running body, posed and tested", ((performance.now() - t0) / rounds) * 1000, "us", 15);
  record("of those rays, the share that hit", (100 * hits) / rounds, "%", null);
}
