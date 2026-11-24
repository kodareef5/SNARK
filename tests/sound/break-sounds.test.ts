// Pieces breaking are heard a cell at a time (client/core/sound/build.ts `breaking`, asked by break-effects.ts), and
// the session's rows of them are not heard one by one.

import { expect, test } from "bun:test";
import { BreakEffects, HEARD_CRACK, HEARD_GLASS, HEARD_IMPACT, HEARD_RUMBLE } from "../../client/core/break-effects.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import type { ClientSession, Rubble } from "../../client/core/session.ts";
import type { Hear } from "../../client/core/sound/bodies.ts";
import { BuildSounds } from "../../client/core/sound/build.ts";
import type { Sounds } from "../../client/core/sound/sounds.ts";
import { hearSession } from "../../client/core/sound/view.ts";
import { ruinKind } from "../../content/ruins.ts";
import { FORM_BREACH_A, formKind } from "../../shared/content/breaks.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { KEYS } from "../../shared/sound/cues.ts";
import { GONE_BLAST, GONE_FELL, GONE_TAKEN } from "../../shared/world/structures.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const WALL = reg.index.get(ruinKind("wall8", "concrete"))!, STEEL = reg.index.get(ruinKind("wall8", "steel"))!;
const k = (id: string): number => reg.index.get(id)!;

/** Build sounds, and what they are heard as when a frame is run. */
function sounds(): { build: BuildSounds; run: () => [key: string, level: number][] } {
  const build = new BuildSounds(reg, () => 0);
  return { build, run: () => {
    const heard: [string, number][] = [];
    const hear: Hear = (_o, key, _e, _x, _y, _z, _lift, level) => void heard.push([KEYS[key]!.key, level]);
    build.update(0, 0, 0, hear, () => {});
    return heard;
  } };
}

test("a cell's impact, crack, panes and rumble are heard, every city material as stone", () => {
  const { build, run } = sounds();
  for (const kind of [WALL, STEEL]) {
    build.breaking(HEARD_IMPACT, kind, 1, 2, 3, 1);
    build.breaking(HEARD_CRACK, kind, 1, 2, 3, 0.9);
    build.breaking(HEARD_GLASS, kind, 1, 2, 3, 0.8);
    build.breaking(HEARD_RUMBLE, kind, 1, 2, 3, 0.7);
  }
  const one: [string, number][] = [["destroy/stone", 1], ["hit/stone", 0.9], ["impact/glass", 0.8], ["collapse", 0.7]];
  expect(run()).toEqual([...one, ...one]);
  // A built piece is heard by its own material.
  build.breaking(HEARD_IMPACT, k("core:wall_wood"), 1, 2, 3, 1);
  expect(run()).toEqual([["destroy/wood", 1]]);
});

test("a wave of a hundred pieces is heard as its cells, not as a hundred rows", () => {
  const { build, run } = sounds();
  const told: number[] = [];
  const session = { onStructure: (was: number) => void told.push(was), onNode: null } as unknown as ClientSession;
  hearSession(session, { build } as unknown as Sounds);
  const breaks = new BreakEffects(reg, defaultPalette());
  const rubble: Rubble[] = [];
  for (let i = 0; i < 100; i++) {
    const x = 64 + (i % 10) * 0.7, z = 64 + Math.floor(i / 10) * 0.7;
    session.onStructure!(WALL, 0, x, 2, z, 100, 0, GONE_FELL);
    rubble.push({ kind: WALL, x, y: 2, z, yaw: 0, cause: GONE_FELL, ox: 64, oy: 2, oz: 64, tick: 100, radius: 0, into: 0, map: WALL });
  }
  // Whoever listened before the sounds is still told every row.
  expect(told.length).toBe(100);
  expect(run()).toEqual([]);
  breaks.take(rubble);
  breaks.flush(null, tierOf("medium"), 100, 64, 2, 64, build);
  expect(run()).toEqual([["destroy/stone", 1], ["collapse", 0.7]]);
});

test("a city piece's rows are left to its cell, and other rows are heard as before", () => {
  const { build, run } = sounds();
  const session = { onStructure: null, onNode: null } as unknown as ClientSession;
  hearSession(session, { build } as unknown as Sounds);
  const hears = session.onStructure!;
  hears(WALL, formKind(reg, WALL, FORM_BREACH_A, 0), 1, 0, 1, 9000, 7000, -1);
  hears(WALL, WALL, 1, 0, 1, 20000, 15000, -1);
  hears(WALL, 0, 1, 0, 1, 100, 0, GONE_BLAST);
  expect(run()).toEqual([]);
  hears(0, k("core:wall_stone"), 1, 0, 1, 0, 100, -1);
  hears(k("core:wall_stone"), k("core:wall_stone"), 1, 0, 1, 100, 50, -1);
  hears(k("core:door_wood"), k("core:door_open_wood"), 2, 0, 2, 100, 100, -1);
  hears(k("core:wall_stone"), 0, 1, 0, 1, 100, 0, GONE_TAKEN);
  expect(run().map(([key]) => key)).toEqual(["place/stone", "hit/stone", "door/open/wood", "demolish"]);
});

test("tree and rock contacts play their own surface sounds once", () => {
  const { build, run } = sounds();
  build.nodeStrike(k("core:tree"), 1, 2, 3);
  build.nodeStrike(k("core:rock"), 4, 5, 6);
  expect(run().map(([key]) => key)).toEqual(["struck/wood", "struck/stone"]);
  expect(run()).toEqual([]);
});
