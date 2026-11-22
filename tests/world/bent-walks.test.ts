import { expect, test } from "bun:test";
import { DROP_CROSSING, DROP_DRIVE } from "../../shared/world/streets.ts";
import { dropSpans, judged } from "../../tools/mapworld/bent-walks.ts";

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
