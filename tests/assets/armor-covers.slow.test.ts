import { expect } from "bun:test";
import { auditClothFit } from "../../tools/art/cloth-fit.ts";
import { test } from "../fixtures/needs-art.ts";

test("no armour piece hides a zone it leaves open in a pose of the motion set", () => {
  for (const f of auditClothFit({ quick: true })) {
    for (const z of f.zones) if ((f.hides >> z.zone) & 1) expect(z.out, `${f.piece} zone ${z.zone} in ${z.pose}`).toBe(0);
    // A hidden zone is one the piece lies over at rest, so it is measured.
    for (let z = 0; z < 32; z++) if ((f.hides >> z) & 1) expect(f.zones.map((c) => c.zone), f.piece).toContain(z);
  }
});
