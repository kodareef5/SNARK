import { expect, test } from "bun:test";
import { Resolver } from "../../client/core/sound/resolve.ts";
import { KEYS, cueKey } from "../../shared/sound/cues.ts";

test("an owner never made or a key outside the catalogue finds nothing and does not throw", () => {
  const r = new Resolver(new Map([["core:dodo/sound/step/grass", 0]]));
  const dodo = r.owner("core:dodo"), call = cueKey("step/grass");
  expect(r.find(dodo, call)).toBe(0);
  for (const [owner, key] of [[-1, call], [dodo + 5, call], [dodo, -1], [dodo, KEYS.length]] as const) {
    expect([r.find(owner, key), r.peek(owner, key), r.rate(owner, key)]).toEqual([-1, -1, 1]);
  }
});
