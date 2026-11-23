// A creature pinned at a wall (server/behavior.ts, `pinned`): one that wanders turns from the wall and walks on, and one
// making for a goal stands while it finds a way round, rather than walking in place against the wall.
import { expect, test } from "bun:test";
import { GOAL_WALK, PINNED_TICKS } from "../../server/behavior.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

function field(): Harness {
  const h = new Harness({}, 3, 30, { dev: true, wild: false, map: writeMap(flatMap(4)) });
  h.join("observer");
  h.run(500);
  return h;
}

/** Two storeys of wall pieces across +Z at `z`, from x0 to x1; or one, its top `top` metres up. */
function wall(h: Harness, x0: number, x1: number, z: number, top = 0): void {
  const kind = h.reg.index.get("core:wall_stone")!;
  for (let x = x0 + 1.5; x < x1; x += 3) for (const y of top ? [top - 1.5] : [1.5, 4.5]) h.world.structs.add(kind, x, y, z, 0, 0, 10000);
}

test("a wandering creature that meets a wall stops pressing within a second, turns from it and walks away", () => {
  for (const name of ["rex", "raptor", "dodo"]) {
    const h = field();
    try {
      const ents = h.world.ents, mind = h.host.creatures.mind;
      const e = h.host.spawnCreature(`core:${name}`, 100, 100, 1);
      wall(h, 70, 130, 112);
      // Ambling north at the wall, and not hunting meanwhile.
      mind.stay(e, h.world.tick + 60 * TICK_RATE);
      ents.yaw[e] = mind.look[e] = 0;
      mind.move[e] = 127;
      let met = -1;
      for (let t = 0; t < 20 * TICK_RATE && met < 0; t++) {
        h.server.tick();
        if (mind.pinned[e]! > 0) met = t;
      }
      expect([name, met >= 0]).toEqual([name, true]);
      const at = ents.z[e]!;
      // A second on it no longer goes into the wall: it stood and turned from it, and may be walking off already.
      for (let t = 0; t < TICK_RATE; t++) h.server.tick();
      expect([name, ents.vz[e]! <= 0.05, mind.pinned[e]]).toEqual([name, true, 0]);
      // And then it walks off.
      for (let t = 0; t < 8 * TICK_RATE; t++) h.server.tick();
      expect([name, at - ents.z[e]! > 1]).toEqual([name, true]);
    } finally {
      h.host.shutdown();
    }
  }
});

test("a creature making for a goal behind a wall stands while it finds a way round, and goes round", () => {
  const h = field();
  try {
    const ents = h.world.ents, mind = h.host.creatures.mind;
    const e = h.host.spawnCreature("core:raptor", 100, 100, 1);
    // A wall across its way, under its eye so it does not see it coming, with its end 12 m to the east.
    wall(h, 70, 112, 106, 1);
    mind.stay(e, h.world.tick + 60 * TICK_RATE);
    mind.goTo(e, 100, 118, GOAL_WALK);
    const pace = h.reg.move[ents.kind[e]!]!.walkSpeed / TICK_RATE;
    let pressed = 0;
    for (let t = 0; t < 30 * TICK_RATE && !mind.arrived(e, 1.5); t++) {
      const [x, z] = [ents.x[e]!, ents.z[e]!];
      h.server.tick();
      // Going at its walk and barely moving: pressed into the wall.
      if (Math.hypot(ents.vx[e]!, ents.vz[e]!) > 0.5 * pace * TICK_RATE && Math.hypot(ents.x[e]! - x, ents.z[e]! - z) < 0.3 * pace) pressed++;
    }
    expect(mind.arrived(e, 1.5)).toBe(true);
    // Pinned, and the tick its walk takes to die away.
    expect(pressed).toBeLessThanOrEqual(PINNED_TICKS + 1);
  } finally {
    h.host.shutdown();
  }
});
