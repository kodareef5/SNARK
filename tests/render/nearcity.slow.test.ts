// The near city as a mesh a chunk (client/core/render/nearcity.ts) on the Miami slice: the same picture as the instances.

import { expect, test } from "bun:test";
import { compareShot, nearShots } from "../../tools/snap/nearcity.ts";

test("a downtown chunk and those round it rasterize the same as a mesh a chunk as an instance a piece, at its border with a neighbour drawn as instances and against a player's wall and foundation, on high and low poly", () => {
  const shots = nearShots();
  expect(shots.map((s) => s.name)).toEqual(["border-along-0", "border-across-1", "border-along-2", "border-across-3", "border-over", "player-wall", "player-floor"]);
  const [W, H] = [480, 270];
  const plays: [string, readonly string[]][] = [["high", shots.map((s) => s.name)], ["lowpoly", ["border-across-1", "border-over", "player-floor"]]];
  for (const [tier, names] of plays) {
    for (const shot of shots.filter((s) => names.includes(s.name))) {
      const { counts } = compareShot(shot, tier, W, H);
      // A surface off by more than a step of the lattice or of the depth buffer: single pixels along an edge where a
      // corner moved under a millimetre, and on low poly where the checker's lines moved with it.
      expect({ tier, shot: shot.name, off: counts.farther + counts.nearer <= 0.0003 * W * H }).toEqual({ tier, shot: shot.name, off: true });
      // In the same place another face of two shown: where two of the map's pieces overlap in one plane (a balcony laid
      // into a floor slab at its height), which fight on a card either way and of which the rasterizer shows the first drawn.
      expect({ tier, shot: shot.name, same: counts.same <= 0.05 * W * H }).toEqual({ tier, shot: shot.name, same: true });
    }
  }
});
