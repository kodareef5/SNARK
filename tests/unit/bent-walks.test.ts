import { expect, test } from "bun:test";
import { judged } from "../../tools/mapworld/bent-walks.ts";

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
