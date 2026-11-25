import { expect, test } from "bun:test";
import { TICK_RATE } from "../../shared/coords.ts";
import { ASSAULT_RIFLE, benchFirefight } from "../../tools/bench/firefight.ts";
import { Harness } from "../fixtures/net.ts";

test("the firefight reports the live herd and each round's own creature load", () => {
  const h = new Harness({}, 1, TICK_RATE);
  try {
    const ada = h.join("ada");
    h.join("bo");
    h.run(1000);
    const ents = h.world.ents;
    const centre = [ents.x[h.ent(ada)]!, ents.z[h.ent(ada)]!] as const;
    expect(h.host.spawnCreature("core:grazer", centre[0] + 3, centre[1], 1)).toBeGreaterThanOrEqual(0);
    const rows = new Map<string, number>();
    const run = (ticks: number, times: number[] | null): void => {
      for (let i = 0; i < ticks; i++) {
        h.run(1000 / TICK_RATE);
        times?.push(1);
      }
    };
    benchFirefight(() => {}, (name, value) => rows.set(name, value), h.host, centre, run, [ASSAULT_RIFLE]);
    expect(rows.get("live grazers before the fight")).toBe(1);
    expect(rows.get("survivors in the fight")).toBe(2);
    expect(rows.get("assault rifle: shots fired")).toBe(400);
    for (const label of ["nobody firing", "assault rifle"]) {
      expect(rows.get(`${label}: creatures awake on a timed tick, median`)).toBe(1);
      expect(rows.get(`${label}: creatures stepped on a timed tick, median`)).toBeGreaterThanOrEqual(0);
    }
  } finally {
    h.host.shutdown();
  }
});
