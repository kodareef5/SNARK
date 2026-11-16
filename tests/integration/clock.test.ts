import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../server/settings/config.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { CLOCK_HOUR_TICKS, cycleTicks, formatHour, hourOfDay } from "../../shared/sim/clock.ts";
import { GAME_HOUR_TICKS } from "../../shared/sim/lazy.ts";
import { V_FOOD } from "../../shared/sim/vitals.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

function rulesOf(server: string[] = []) {
  const made = loadConfig({ gus: ["[ServerSettings]", ...server].join("\n") });
  expect([made.report.refused, made.report.unknown, made.report.waiting]).toEqual([[], [], []]);
  return made.rules;
}

const FAST = ["DayCycleSpeedScale=10", "DayTimeSpeedScale=2", "NightTimeSpeedScale=0.5"];

test("the server's day: its three scales reach the client, both tell the same hour, and the day and the night each take what the scales say", () => {
  const plain = new Harness({}, 1, 60, { dev: true });
  const h = new Harness({}, 1, 60, { dev: true, config: rulesOf(FAST) });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  expect([h.world.clock, ada.clock]).toEqual([{ cycle: 10, day: 2, night: 0.5 }, { cycle: 10, day: 2, night: 0.5 }]);
  expect([formatHour(hourOfDay(0, plain.world.dayOffset, plain.world.clock)), formatHour(hourOfDay(0, h.world.dayOffset, h.world.clock))]).toEqual(["09:00", "09:00"]);
  const theirs = (): number => hourOfDay(h.world.tick, h.world.dayOffset, h.world.clock);
  const hers = (): number => hourOfDay(ada.latestSnapshot, ada.dayOffset, ada.clock);
  // The day runs at 20 times the clock's own pace (cycle 10 times day 2) and the night at 5 times (10 times 0.5).
  // Twelve hours of day take 75.6 s, and twelve of night take 302.4 s.
  expect([cycleTicks(h.world.clock) / TICK_RATE, cycleTicks(plain.world.clock) / TICK_RATE / 60]).toEqual([378, 50.4]);
  expect(h.say(ada, "settime 6")).toEqual(["time is 06:00"]);
  let at = h.world.tick;
  let was = theirs();
  expect(was - 6).toBeLessThan(0.1);
  h.run(30000);
  expect(theirs() - was).toBeCloseTo(((h.world.tick - at) * 20) / CLOCK_HOUR_TICKS, 9);
  // Runs on to a little after sunset.
  while (theirs() >= 6 && theirs() < 18.2) h.run(34);
  at = h.world.tick;
  was = theirs();
  expect(was).toBeLessThan(18.3);
  h.run(120000);
  expect(theirs() - was).toBeCloseTo(((h.world.tick - at) * 5) / CLOCK_HOUR_TICKS, 9);
  // Midnight comes 151.2 s after sunset, and sunrise 151.2 s after that.
  h.run((151.2 - 120) * 1000 - ((was - 18) * CLOCK_HOUR_TICKS * 1000) / 5 / TICK_RATE);
  expect(Math.min(theirs(), 24 - theirs())).toBeLessThan(0.02);
  h.run(151200);
  expect(Math.abs(theirs() - 6)).toBeLessThan(0.05);
  // The client's hour is exact for the tick of its latest snapshot.
  for (let k = 0; k < 20; k++) {
    h.run(3777);
    expect(Math.abs(hers() - hourOfDay(ada.latestSnapshot, h.world.dayOffset, h.world.clock))).toBe(0);
    expect(Math.abs(hers() - theirs())).toBeLessThan(0.05);
  }
  for (const [words, want] of [["3:15", "03:15"], ["17:59", "17:59"], ["18", "18:00"], ["23:30", "23:30"], ["0", "00:00"]] as const) expect(h.say(ada, `settime ${words}`)).toEqual([`time is ${want}`]);
  expect(ada.dayOffset).toBe(h.world.dayOffset);

  // The day's pace changes nothing else. Spoiling and hunger keep their own hour, GAME_HOUR_TICKS.
  const rate = (w: Harness): number => w.host.records.byPid.get(((e: number) => w.world.ents.pid[e]!)(w.host.spawnCreature("core:parasaur", 250, 250, 1)))!.vitals!.rate[V_FOOD]!;
  expect([h.world.reg === h.reg, h.world.reg.spoilTicks[id("meat_cooked")], rate(h)]).toEqual([true, 1200 * TICK_RATE, rate(plain)]);
  expect(CLOCK_HOUR_TICKS).not.toBe(GAME_HOUR_TICKS);
});

test("a world stopped at an hour starts again at that hour, whatever pace its clock then keeps", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-clock-"));
  const dbPath = join(dir, "world.db");
  let h = new Harness({}, 1, 60, { dev: true, dbPath });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  expect(h.say(ada, "settime 14:12")).toEqual(["time is 14:12"]);
  h.run(20000);
  const hour = (w: Harness): number => hourOfDay(w.world.tick, w.world.dayOffset, w.world.clock);
  const stopped = hour(h);
  const tick = h.world.tick;
  h.host.shutdown();

  // Restarted on a day 20 times as fast, the hour is the same to within one tick's worth.
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: rulesOf(FAST) });
  expect([h.world.tick, h.host.loadedUnder!.DayCycleSpeedScale]).toEqual([tick, 1]);
  expect(Math.abs(hour(h) - stopped)).toBeLessThan(20 / CLOCK_HOUR_TICKS);
  const offset = h.world.dayOffset;
  h.run(3000);
  expect(hour(h) - stopped).toBeGreaterThan(0.4);
  const again = hour(h);
  h.host.shutdown();
  // Restarted on the same clock, the offset is unchanged.
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: rulesOf(FAST) });
  expect([h.world.dayOffset, hour(h), h.host.loadedUnder!.DayCycleSpeedScale]).toEqual([offset, again, 10]);
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath });
  expect(Math.abs(hour(h) - again)).toBeLessThan(1 / CLOCK_HOUR_TICKS);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});
