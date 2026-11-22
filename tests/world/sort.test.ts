// The in-place sorts of shared/sort.ts.
import { expect, test } from "bun:test";
import { Rng } from "../../shared/rng.ts";
import { sortF64, sortU32 } from "../../shared/sort.ts";

test("a range sorts as Array.prototype.sort has it, with what is outside it left alone, at every size from none to past the small sort's", () => {
  const rng = new Rng(7);
  for (const n of [0, 1, 2, 3, 15, 16, 17, 40, 333, 2048]) {
    for (const spread of [4, 1e6]) {
      const keys = Float64Array.from({ length: n + 6 }, () => Math.floor(rng.float() * spread) * 4096 + Math.floor(rng.float() * 4096));
      const want = [...keys.subarray(0, 3), ...[...keys.subarray(3, 3 + n)].sort((a, b) => a - b), ...keys.subarray(3 + n)];
      sortF64(keys, 3, 3 + n);
      expect([...keys]).toEqual(want);
      const u = Uint32Array.from({ length: n }, () => Math.floor(rng.float() * spread));
      const sorted = [...u].sort((a, b) => a - b);
      sortU32(u, n);
      expect([...u]).toEqual(sorted);
    }
  }
});
