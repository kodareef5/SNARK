// The people bench's pure parts: where its crowd stands, what it looks like and wears, the order its cells run in, and
// what their runs come to (client/core/people-crowd.ts, tools/bench/people-rows.ts).

import { describe, expect, test } from "bun:test";
import { CROWD_SHAPES, CROWD_SPACING, CROWD_VIEWER, CROWD_WEDGE, Crowd, OUTFITS, crowdAsked, crowdGear, crowdLooks, crowdSpots, crowdView, distinctLooks } from "../../client/core/people-crowd.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { LOOK_BYTES, LOOK_SEX, validLook } from "../../shared/anim/look.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { GEAR_COUNT, GEAR_HELD, GEAR_WORN } from "../../shared/sim/entities.ts";
import { buildProvingHeightfield } from "../../shared/world/proving.ts";
import { address, cellName, cells, numbersOf, rounds, spread, summarise, table, type RunNumbers } from "../../tools/bench/people-rows.ts";

const reg = compileContent(CORE_CONTENT).registry!;

describe("the crowd", () => {
  test("each scene stands its count in its wedge, at its distances, apart", () => {
    for (const scene of ["portrait", "near", "far"] as const) {
      const spots = crowdSpots(scene), { count, near, far } = CROWD_SHAPES[scene];
      expect(spots.length).toBe(count);
      for (const s of spots) {
        const dx = s.x - CROWD_VIEWER.x, dz = s.z - CROWD_VIEWER.z, d = Math.hypot(dx, dz);
        expect(d).toBeGreaterThanOrEqual(near - 1e-9);
        expect(d).toBeLessThanOrEqual(far + 1e-9);
        let off = Math.atan2(dx, dz) - CROWD_VIEWER.yaw;
        off = Math.atan2(Math.sin(off), Math.cos(off));
        expect(Math.abs(off)).toBeLessThanOrEqual(CROWD_WEDGE + 1e-9);
      }
      for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) expect(Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.z - spots[j]!.z)).toBeGreaterThanOrEqual(CROWD_SPACING);
    }
  });

  test("the crowd stands where it stood in every run", () => {
    expect(crowdSpots("far")).toEqual(crowdSpots("far"));
  });

  test("the portrait's body faces the viewer and the view looks down at it", () => {
    const [s] = crowdSpots("portrait");
    expect(Math.abs(Math.cos(s!.yaw - (CROWD_VIEWER.yaw + Math.PI)) - 1)).toBeLessThan(1e-9);
    expect(crowdView("portrait").pitch).toBeLessThan(crowdView("near").pitch);
  });

  test("a shared look is one look; unique looks are all apart, half each sex", () => {
    expect(distinctLooks(crowdLooks(40, "shared"))).toBe(1);
    for (const n of [40, 200]) {
      const looks = crowdLooks(n, "unique");
      expect(distinctLooks(looks)).toBe(n);
      expect(looks.filter((l) => l[LOOK_SEX] === 1).length).toBe(n / 2);
      for (const l of looks) expect(validLook(l)).toBe(true);
    }
  });

  test("only mixed gear dresses bodies, from Meridian on, and its items exist", () => {
    expect(crowdGear(40, "unique", reg).every((g) => g === 0)).toBe(true);
    const gear = crowdGear(60, "gear", reg);
    const worn = (k: number): string[] => Array.from({ length: 5 }, (_, s) => reg.defs[gear[k * GEAR_COUNT + GEAR_WORN + s]!]?.id ?? "");
    const first = OUTFITS.indexOf("meridian");
    const outfit = (k: number): string => OUTFITS[(k + first) % OUTFITS.length]!;
    for (let k = 0; k < OUTFITS.length; k++) {
      const set = outfit(k);
      if (set === "bare") expect(worn(k).every((id) => id === "")).toBe(true);
      else if (set !== "mixed") for (const id of worn(k)) expect(id.startsWith(`core:${set}_`)).toBe(true);
    }
    expect(reg.defs[gear[0 * GEAR_COUNT + GEAR_HELD]!]?.id).toBe("core:rifle");
    expect(reg.defs[gear[1 * GEAR_COUNT + GEAR_HELD]!]?.id).toBe("core:hatchet");
    expect(gear[2 * GEAR_COUNT + GEAR_HELD]).toBe(0);
    const mixedAt = OUTFITS.length - first + OUTFITS.indexOf("mixed");
    const mixed = new Set(Array.from({ length: 10 }, (_, m) => worn((mixedAt % OUTFITS.length) + m * OUTFITS.length).join()));
    expect(mixed.size).toBeGreaterThan(5);
  });

  test("the address asks for a crowd only by its scene and looks", () => {
    const get = (q: Record<string, string>) => (name: string) => q[name] ?? null;
    expect(crowdAsked(get({ people: "far", looks: "gear" }))).toEqual({ scene: "far", looks: "gear" });
    expect(crowdAsked(get({ people: "near" }))).toEqual({ scene: "near", looks: "shared" });
    expect(crowdAsked(get({ people: "all" }))).toBeNull();
    expect(crowdAsked(get({}))).toBeNull();
  });

  test("each sample ends with the crowd, in its looks and gear", () => {
    const session = { sampleRemote: (out: RemoteSample) => void (out.count = 3) };
    const crowd = new Crowd(session, buildProvingHeightfield(), reg, "near", "gear");
    const out = new RemoteSample();
    session.sampleRemote(out);
    expect(out.count).toBe(3 + 40);
    const k = 7, at = 3 + k;
    expect(out.kind[at]).toBe(reg.index.get("core:survivor")!);
    expect(out.hasLook[at]).toBe(1);
    expect([...out.look.subarray(at * LOOK_BYTES, (at + 1) * LOOK_BYTES)]).toEqual([...crowd.looks[k]!]);
    expect([...out.gear.subarray(at * GEAR_COUNT, (at + 1) * GEAR_COUNT)]).toEqual([...crowd.gear.subarray(k * GEAR_COUNT, (k + 1) * GEAR_COUNT)]);
    session.sampleRemote(out);
    expect(out.count).toBe(43);
  });
});

describe("the bench's cells and runs", () => {
  const run = (over: Partial<RunNumbers>): RunNumbers => ({ ...numbersOf({}), gaveUp: false, ...over });

  test("each tier has two empty views and every scene in every kind of looks", () => {
    const list = cells(["medium", "high"]);
    expect(list.length).toBe(2 * (2 + 12));
    expect(new Set(list.map(cellName)).size).toBe(list.length);
    expect(address(80, list[0]!)).toContain("look=portrait");
    expect(address(80, list[0]!)).not.toContain("people=");
    expect(address(80, list.find((c) => c.scene === "far" && c.looks === "gear")!)).toContain("look=near&people=far&looks=gear");
  });

  test("every round runs every cell once, each starting one cell further on", () => {
    const list = cells(["medium"]);
    const order = rounds(list, 4);
    for (const [k, round] of order.entries()) {
      expect(new Set(round.map(cellName))).toEqual(new Set(list.map(cellName)));
      expect(round[0]).toBe(list[k]!);
    }
  });

  test("a range is the least to the most of the numbers measured", () => {
    expect(spread([3, 1, 2, NaN])).toEqual({ min: 1, median: 2, max: 3 });
    expect(spread([4, 1])).toEqual({ min: 1, median: 2.5, max: 4 });
    expect(spread([NaN]).median).toBeNaN();
  });

  test("a crowd's cost is set against the empty view it is held at", () => {
    const list = cells(["medium"]);
    const results = new Map<string, RunNumbers[]>([
      ["empty, crowd view medium", [run({ gpuMedian: 2, draws: 100, triangles: 1e6 }), run({ gpuMedian: 2.2, draws: 100, triangles: 1e6 })]],
      ["empty, portrait view medium", [run({ gpuMedian: 1, draws: 80, triangles: 5e5 })]],
      ["near unique medium", [run({ gpuMedian: 3, draws: 130, triangles: 1.2e6 }), run({ gpuMedian: 3.4, draws: 130, triangles: 1.2e6, gaveUp: true })]],
      ["portrait shared medium", [run({ gpuMedian: 1.5, draws: 85, triangles: 5.2e5 })]],
    ]);
    const s = summarise(list, results);
    const near = s.find((c) => c.name === "near unique medium")!;
    expect(near.stats.gpuMedian).toEqual({ min: 3, median: 3.2, max: 3.4 });
    expect(near.gaveUp).toBe(1);
    expect(near.added!.gpuMedian).toBeCloseTo(1.1, 9);
    expect(near.added!.draws).toBe(30);
    expect(s.find((c) => c.name === "portrait shared medium")!.added!.triangles).toBe(2e4);
    expect(s.find((c) => c.name === "far gear medium")!.added).toBeNull();
    const text = table(s);
    expect(text).toContain("| near unique medium | 2 (1 not still) | 3.00 to 3.40 |");
    expect(text).toContain("| far gear medium | 0 | n/a |");
  });
});
