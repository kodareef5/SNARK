// The physics lane's bench scenes (tools/bench/physics-rows.ts) do what they say, so their times are of that work: every
// survivor is knocked down, as a ragdoll or toppled past the fall budget, and rises; the car strikes the crowd; and the
// rex walks the length of the bodies, pushing those in its way.
import { expect, test } from "bun:test";
import { LANE_ROWS } from "../../server/lane.ts";
import { benchCrowd, benchFalls, benchRexCorpses, cpuMs } from "../../tools/bench/physics-rows.ts";

/** A scene's figures by name. */
function figures(scene: (section: (t: string) => void, record: (name: string, value: number) => void) => void): Map<string, number> {
  const out = new Map<string, number>();
  scene(() => {}, (name, value) => out.set(name, value));
  return out;
}

test("48 knocked down in a room and in the open topple past the budget and all rise", () => {
  for (const walled of [true, false]) {
    const f = figures((s, r) => benchFalls(s, r, walled));
    expect(f.get("knocked down")).toBe(48);
    expect(f.get("laid as ragdolls")).toBeGreaterThan(0);
    expect(f.get("laid as ragdolls")! + f.get("toppled past the fall budget")!).toBe(48);
    expect(f.get("ticks every ragdoll moved")).toBeGreaterThan(10);
    // Two players watching draw every body down, on one bone or all, each fall where the server's lies.
    expect(f.get("watchers: bodies down but drawn standing, body-ticks")).toBe(0);
    expect(f.get("watchers: of them not drawn, for want of room")).toBe(0);
    expect(f.get("watchers: toppled or waiting, drawn upright")).toBe(0);
    expect(f.get("watchers: simulated hips from the server's hips, the most")).toBeLessThan(1);
    expect(f.get("watchers: a laid fall drawn whole, head or hips from the server's, the most")).toBeLessThan(1);
    expect(f.get("watchers: a laid fall on one bone, hips from the server's, the most")).toBeLessThan(1);
    expect(f.get("ticks until every one had risen")).toBeLessThanOrEqual(121);
    expect(f.get("falls row a tick, median")).toBeGreaterThan(0);
  }
});

test("a car knocks a crowd down, and two watchers draw each body where it lies", () => {
  for (const drive of ["straight", "turning", "braking"] as const) {
    const f = figures((s, r) => benchCrowd(s, r, { clock: cpuMs }, drive));
    expect(f.get("survivors knocked down"), drive).toBeGreaterThan(5);
    expect(f.get("contacts row in the strike, median")).toBeGreaterThan(0);
    // Every body down is drawn down, by its fall within a few ticks or by a topple until the fall comes.
    expect(f.get("watchers: bodies down but drawn standing, body-ticks"), drive).toBe(0);
    expect(f.get("watchers: of them not drawn, for want of room"), drive).toBe(0);
    expect(f.get("watchers: toppled or waiting, drawn upright"), drive).toBe(0);
    expect(f.get("watchers: a laid fall drawn whole, head or hips from the server's, median"), drive).toBeLessThan(1);
    expect(f.get("watchers: a laid fall drawn whole, head or hips from the server's, the most"), drive).toBeLessThan(35);
    expect(f.get("watchers: longest wait for a fall's checkpoint, ticks"), drive).toBe(0);
    // Side contacts can diverge between corrections even when the drawn root follows its snapshot.
    expect(f.get("watchers: simulated hips from the server's hips, median"), drive).toBeLessThan(1);
    expect(f.get("watchers: simulated hips from the server's hips, 90th percentile"), drive).toBeLessThan(10);
    if (drive === "straight") expect(f.get("dodos run over")).toBeGreaterThan(0);
  }
});

test("a rex walks the length of 30 lying bodies and pushes those in its way", () => {
  const f = figures((s, r) => benchRexCorpses(s, r));
  expect(f.get("bodies lying")).toBe(30);
  expect(f.get("rex's distance short of where it was sent")).toBeLessThan(1);
  expect(f.get("bodies the rex woke, in body-ticks moving")).toBeGreaterThan(0);
  expect(f.get("the farthest it moved a body along its way")).toBeLessThan(2);
  expect(LANE_ROWS).toContain("corpses");
});
