// The physics lane's bench scenes (tools/bench/physics-rows.ts) do what they say, so their times are of that work: every
// survivor is knocked down and rises, the car strikes the crowd, and the rex walks the length of the bodies.
import { expect, test } from "bun:test";
import { LANE_ROWS } from "../../server/lane.ts";
import { benchCrowd, benchFalls, benchRexCorpses, cpuMs } from "../../tools/bench/physics-rows.ts";

/** A scene's figures by name. */
function figures(scene: (section: (t: string) => void, record: (name: string, value: number) => void) => void): Map<string, number> {
  const out = new Map<string, number>();
  scene(() => {}, (name, value) => out.set(name, value));
  return out;
}

test("48 survivors knocked down in a room and in the open all rise again", () => {
  for (const walled of [true, false]) {
    const f = figures((s, r) => benchFalls(s, r, walled));
    expect(f.get("knocked down")).toBe(48);
    expect(f.get("ticks all 48 moved")).toBeGreaterThan(10);
    expect(f.get("ticks until every one had risen")).toBeLessThanOrEqual(121);
    expect(f.get("falls row a tick, median")).toBeGreaterThan(0);
  }
});

test("a car through a crowd knocks survivors down and runs dodos over", () => {
  const f = figures((s, r) => benchCrowd(s, r, { clock: cpuMs }));
  expect(f.get("survivors knocked down")).toBeGreaterThan(5);
  expect(f.get("dodos run over")).toBeGreaterThan(0);
  expect(f.get("contacts row in the strike, median")).toBeGreaterThan(0);
});

test("a rex walks the length of 30 lying bodies and wakes none", () => {
  const f = figures((s, r) => benchRexCorpses(s, r));
  expect(f.get("bodies lying")).toBe(30);
  expect(f.get("rex's distance short of where it was sent")).toBeLessThan(1);
  expect(f.get("bodies the rex woke, in body-ticks moving")).toBe(0);
  expect(LANE_ROWS).toContain("corpses");
});
