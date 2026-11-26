import { expect, spyOn, test } from "bun:test";
import { DROP_CROSSING, DROP_DRIVE, decodeStreets, encodeStreets, heldSide, kindsByte } from "../../shared/world/streets.ts";
import { dropSpans, judged, makeBentWalks } from "../../tools/mapworld/bent-walks.ts";
import type { StaticPiece } from "../../tools/mapworld/statics.ts";
import { PlannedStreets } from "../../tools/mapworld/streets/plan.ts";
import { streetRules } from "../../tools/mapworld/streets/rules.ts";

/** A line of points a metre apart, each a state: 0 off open ground, 1 not level, 2 its kerb alone, 3 its kerb and walk. */
const line = (states: string): [Uint8Array, Float64Array] => [Uint8Array.from(states, Number), Float64Array.from(states, (_, k) => k)];

test("a kerb's level tests are judged over a run: a short failing stretch is laid on, a long one cut, and a crumb is not laid", () => {
  // Two points failing between laid ones (3 m end to end) are laid; five are not.
  const [a, sa] = line("3333113333331111133333");
  expect(judged(a, sa)).toBe(2);
  expect(Array.from(a).join("")).toBe("3333333333331111133333");
  // A walk that is not level for a point keeps its walk; for longer its kerb stands alone.
  const [b, sb] = line("33332333332222223333");
  judged(b, sb);
  expect(Array.from(b).join("")).toBe("33333333332222223333");
  // A metre of kerb laid between two long failing stretches is not laid, nor one beside ground it may not stand on; and
  // ground it may not stand on is never laid on.
  const [c, sc] = line("1111113111111303");
  judged(c, sc);
  expect(Array.from(c).join("")).toBe("1111111111111103");
});

/** A run's stretches as text: each its kind, from and to, and a pad where it has one. */
const spans = (s0: number, s1: number, drops: number[], walked = true): string[] => dropSpans(s0, s1, drops, walked).map((sp) => `${sp.how} ${sp.a.toFixed(1)}-${sp.b.toFixed(1)}${sp.tactile ? " pad" : ""}`);

test("no kerb the street model lets down is laid raised: drops nearer than two flares are one flush stretch, each with its own pad", () => {
  // Two crossings a metre apart: the second began in the first one's flare up and was left out, laid as flare and kerb.
  expect(spans(0, 40, [10, 12.4, DROP_CROSSING, 13.4, 15.8, DROP_CROSSING])).toEqual(["kerb 0.0-8.6", "down 8.6-10.0", "flush 10.0-12.4 pad", "flush 12.4-13.4", "flush 13.4-15.8 pad", "up 15.8-17.2", "kerb 17.2-40.0"]);
  // Two metres apart, which two flares do not fit in: one stretch too, a crossing and a drive with no pad.
  expect(spans(0, 40, [10, 12.4, DROP_CROSSING, 14.4, 19.4, DROP_DRIVE])).toEqual(["kerb 0.0-8.6", "down 8.6-10.0", "flush 10.0-12.4 pad", "flush 12.4-14.4", "flush 14.4-19.4", "up 19.4-20.8", "kerb 20.8-40.0"]);
  // Four metres apart: each its own flares, the kerb raised between them.
  expect(spans(0, 40, [10, 12.4, DROP_CROSSING, 16.4, 18.8, DROP_CROSSING])).toEqual(["kerb 0.0-8.6", "down 8.6-10.0", "flush 10.0-12.4 pad", "up 12.4-13.8", "kerb 13.8-15.0", "down 15.0-16.4", "flush 16.4-18.8 pad", "up 18.8-20.2", "kerb 20.2-40.0"]);
  // A kerb alone is cut at each, and between them stands.
  expect(spans(0, 40, [10, 12.4, DROP_CROSSING, 13.4, 15.8, DROP_CROSSING], false)).toEqual(["kerb 0.0-10.0", "gap 10.0-12.4 pad", "kerb 12.4-13.4", "gap 13.4-15.8 pad", "kerb 15.8-40.0"]);
  // A drop the run holds only an end of is another run's, but where its middle is in this run, however little of it.
  expect(spans(5, 40, [4, 5.3, DROP_CROSSING])).toEqual(["kerb 5.0-40.0"]);
  expect(spans(5, 40, [4.9, 5.4, DROP_CROSSING])).toEqual(["flush 5.0-5.4 pad", "up 5.4-6.8", "kerb 6.8-40.0"]);
  // A drop past the run's end is let down to it.
  expect(spans(0, 11, [10, 12.4, DROP_CROSSING])).toEqual(["kerb 0.0-8.6", "down 8.6-10.0", "flush 10.0-11.0 pad"]);
});

/** One slanting street with a crossing, as a cut of `chunks` a side with its corner at chunk `frame` lays its kerbs: every piece, in lattice metres. */
function laidBy(frame: readonly [number, number], chunks: number): StaticPiece[] {
  const x0 = (frame[0] - 2048) * 64, z0 = (frame[1] - 2048) * 64, n = chunks * 32 + 1;
  // Sector 135-134's corner and the street's ends in the cut's own metres, as its streets part holds them.
  const px = 7168 - x0, pz = 6144 - z0, side = heldSide(4, 0, 2.75, kindsByte(0, 1, 0));
  const street = { type: Object.keys(streetRules().types).indexOf("residential-tidy"), flags: 0, seed: 7, sides: [side, side] as const, xz: Float64Array.of(7790.25 - x0, 6880.5 - z0, 7850.75 - x0, 6990.25 - z0), drops: [Float64Array.of(40, 43.5, DROP_CROSSING), null] as const };
  const part = decodeStreets(encodeStreets({ x0: px, z0: pz, stretches: [street], corners: [] }), px, pz);
  const held = new PlannedStreets();
  held.put(135 * 4096 + 134, part, px / 64, pz / 64, px / 64 + 16, pz / 64 + 16);
  held.keep(part, Float64Array.of(0.3, 0.3), Uint8Array.of(0, 0));
  const ground = { grid: { nx: n, x0, z0, x1: x0 + chunks * 64, z1: z0 + chunks * 64 }, streets: held, water: new Uint8Array(n * n), surface: new Uint8Array(n * n) };
  const site = { ground, groundAt: (x: number, z: number): number => 3 + x / 512 + z / 1024 } as unknown as Parameters<typeof makeBentWalks>[0];
  const rules = { seed: 1, street: { walks: { flat: 0.3, gutterEvery: 4, boxEvery: 6, bent: {} } } } as unknown as Parameters<typeof makeBentWalks>[1];
  const pieces: StaticPiece[] = [], quiet = spyOn(console, "log").mockImplementation(() => {});
  try {
    makeBentWalks(site, rules, (m) => { pieces.push(...m.pieces); return true; }, () => false, { hits: () => false, meeting: () => [] }, null as never, new Set(), []);
  } finally {
    quiet.mockRestore();
  }
  return pieces;
}

test("two cuts of a city lay a street's kerbs with the same numbers", () => {
  const inner = laidBy([2144, 2128], 48), outer = laidBy([2128, 2112], 80);
  // Both kerbs are laid, one let down flush at its crossing.
  expect(inner.filter((p) => p.kind === "core:zzzzzbend_flush_s").length).toBe(1);
  expect(inner.filter((p) => p.kind === "core:zzzzzbend_raised_s").length).toBeGreaterThan(4);
  // To the last bit: a length a hair either side of a rule's threshold is cut in one cut and not in the other.
  expect(inner).toEqual(outer);
});
