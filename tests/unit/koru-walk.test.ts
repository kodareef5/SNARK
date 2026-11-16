import { expect, test } from "bun:test";
import { KORU_LAYOUT } from "../../content/landmarks/koru.ts";
import { withContent } from "../../shared/content/registry.ts";
import { TICK_DT, TICK_RATE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_JUMP, Body, stepBody } from "../../shared/sim/character.ts";
import { mapHeightfield, parseMap, placeStatics } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { KORU_AT, koruMapFile, koruPoint } from "../fixtures/koru.ts";
import { coreRegistry } from "../fixtures/world.ts";

// Where the authored routes do not go: bodies walked and swum by the shared step alone, off the decks' ends, at random over
// every deck, and out of the sea astern.

const map = parseMap(koruMapFile());
const reg = withContent(coreRegistry(), map.content!.defs);
const structs = new StructureStore(map.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
placeStatics(map, structs, reg);
const world = { hf: mapHeightfield(map), structs, seaLevel: map.seaLevel };
const move = reg.move[reg.index.get("core:survivor")!]!;
const { hullMinZ, hullMaxZ } = KORU_LAYOUT.dimensions;
const lower = KORU_LAYOUT.decks[0]!.floorY;
/** The lower deck is wider than this either side of the keel along all its length. */
const KEEL = 4;

/**
 * Under the lower deck within its outline and above the sea: the closed hull nobody may reach. Below it the hull is solid,
 * and a swimmer under its bilge is in the sea.
 */
const sunk = (b: Body): boolean => Math.abs(b.x - KORU_AT.x) < KEEL && b.z > KORU_AT.z + hullMinZ && b.z < KORU_AT.z + hullMaxZ && b.y < lower - 0.1 && b.y > -0.5;

function body(at: readonly number[]): Body {
  const b = new Body();
  [b.x, b.y, b.z] = koruPoint(at);
  b.y += 0.05;
  b.grounded = true;
  return b;
}

test("a survivor walked off either end of the lower deck is stopped by its bulkhead, and stands on the deck", () => {
  for (const [from, yaw] of [[[3.5, lower, -42.25], 32768], [[-3.5, lower, -42.25], 32768], [[0, lower, 37.75], 0], [[2, lower, 37.75], 0]] as const) {
    const b = body(from);
    let low = Infinity;
    for (let t = 0; t < 8 * TICK_RATE; t++) {
      stepBody(world, b, 0, 127, yaw, 0, t % 30 === 0 ? BTN_JUMP : 0, move, TICK_DT);
      low = Math.min(low, b.y);
    }
    expect([from, low >= lower - 0.05, sunk(b)]).toEqual([from, true, false]);
  }
});

test("a hundred survivors walking and jumping at random from every route and room end on a deck or in the sea, none in the closed hull", () => {
  const spots = [...KORU_LAYOUT.routes.flatMap((r) => r.anchors), ...KORU_LAYOUT.rooms.map((r) => r.routeTarget)];
  const rng = new Rng(7);
  const bodies = Array.from({ length: 100 }, (_, i) => {
    const b = body(spots[i % spots.length]!);
    b.x += rng.range(-0.3, 0.3);
    b.z += rng.range(-0.3, 0.3);
    return b;
  });
  const input = bodies.map(() => [0, 127, rng.int(65536), 0]);
  const trapped: number[] = [];
  for (let t = 0; t < 40 * TICK_RATE; t++) {
    for (let i = 0; i < bodies.length; i++) {
      const inp = input[i]!;
      if (rng.int(20) === 0) [inp[0], inp[1], inp[2], inp[3]] = [rng.int(255) - 127, rng.int(3) === 0 ? 0 : 127, rng.int(65536), rng.int(8) === 0 ? BTN_JUMP : 0];
      stepBody(world, bodies[i]!, inp[0]!, inp[1]!, inp[2]!, 0, inp[3]!, move, TICK_DT);
      if (sunk(bodies[i]!) && !trapped.includes(i)) trapped.push(i);
    }
  }
  expect(trapped).toEqual([]);
});

test("a swimmer astern swims onto the stern steps and up them to the deck", () => {
  const { sea, deck } = KORU_LAYOUT.docking.sternSteps;
  for (const dx of [-0.6, 0, 0.6]) {
    for (const back of [4, 12]) {
      const b = new Body();
      [b.x, b.y, b.z] = koruPoint([sea[0]! + dx, -1.2, sea[2]! - back]);
      let high = -Infinity;
      for (let t = 0; t < 20 * TICK_RATE && high < deck[1]! - 0.1; t++) {
        stepBody(world, b, 0, 127, 0, 0, BTN_JUMP, move, TICK_DT);
        high = Math.max(high, b.y);
      }
      expect([dx, back, high]).toEqual([dx, back, expect.any(Number)]);
      expect(high).toBeGreaterThan(deck[1]! - 0.1);
    }
  }
});
