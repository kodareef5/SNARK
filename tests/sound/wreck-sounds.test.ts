// A street's wreck salvaged, as it is heard (client/core/sound/build.ts, actions.ts): a blow on it is metal, a rung is
// one metal blow, and cut up it is a metal piece gone. No wall's crack and no wooden creak.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { BreakEffects, HEARD_BLOW, HEARD_CRACK, HEARD_IMPACT, hearStructures } from "../../client/core/break-effects.ts";
import { RemoteSample, type ClientSession, type CombatEvent } from "../../client/core/session.ts";
import { ActionSounds, type OwnState } from "../../client/core/sound/actions.ts";
import type { Hear } from "../../client/core/sound/bodies.ts";
import { BuildSounds } from "../../client/core/sound/build.ts";
import type { Sounds } from "../../client/core/sound/sounds.ts";
import { hearSession } from "../../client/core/sound/view.ts";
import { ruinKind } from "../../content/ruins.ts";
import { ZONE_NONE } from "../../shared/anim/human.ts";
import { FORM_HEAP, formKind } from "../../shared/content/breaks.ts";
import { EVENT_HIT } from "../../shared/net/protocol.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { KEYS, candidates, cueKey } from "../../shared/sound/cues.ts";
import { soundsHeard } from "../../shared/sound/reach.ts";
import { rungKind } from "../../shared/world/breaking.ts";
import { GONE_BLAST, GONE_TAKEN } from "../../shared/world/structures.ts";
import { findSheets } from "../../tools/pack/sound.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const k = (id: string): number => reg.index.get(id)!;
const CAR = k("core:zzzzroad_fastback_abandoned_blue"), STRIPPED = rungKind(reg, CAR, 1), SHELL = rungKind(reg, CAR, 2), BUS = k("core:zzzzroad_bus_abandoned");
const WALL = k(ruinKind("wall8", "concrete")), HEAP = formKind(reg, WALL, FORM_HEAP, 0);

/** Build sounds, and what they are heard as when a frame is run. */
function sounds(): { build: BuildSounds; run: () => string[] } {
  const build = new BuildSounds(reg, () => 0);
  return { build, run: () => {
    const heard: string[] = [];
    const hear: Hear = (_o, key) => void heard.push(KEYS[key]!.key);
    build.update(0, 0, 0, hear, () => {});
    return heard;
  } };
}

test("a wreck's rung is a blow on metal, and its last a metal piece gone", () => {
  const { build, run } = sounds();
  for (const kind of [CAR, STRIPPED, SHELL, BUS]) {
    build.breaking(HEARD_BLOW, kind, 1, 2, 3, 0.9);
    build.breaking(HEARD_IMPACT, kind, 1, 2, 3, 0.76);
    expect(run()).toEqual(["hit/metal", "destroy/metal"]);
  }
  // A wall's crack is stone still.
  build.breaking(HEARD_CRACK, WALL, 1, 2, 3, 0.9);
  expect(run()).toEqual(["hit/stone"]);
});

test("a wreck's rows are heard once, by its cell, and never as a piece taken up", () => {
  const { build, run } = sounds();
  const session = { onStructure: null, onNode: null } as unknown as ClientSession;
  const breaks = new BreakEffects(reg, defaultPalette());
  hearStructures(session, (was, kind, x, y, z, hpWas, hp, cause) => breaks.row(reg, 100, was, kind, x, y, z, hpWas, hp, cause));
  hearSession(session, { build } as unknown as Sounds);
  const heard = (): string[] => {
    breaks.flush(null, tierOf("medium"), 100, 0, 0, 0, build);
    return run();
  };
  const hears = session.onStructure!;
  hears(CAR, STRIPPED, 10, 0, 10, 8000, 5333, -1);
  expect(heard()).toEqual(["hit/metal"]);
  hears(STRIPPED, SHELL, 10, 0, 10, 5333, 2667, -1);
  expect(heard()).toEqual(["hit/metal"]);
  hears(SHELL, 0, 10, 0, 10, 1, 0, GONE_TAKEN);
  expect(heard()).toEqual(["destroy/metal"]);
  // Set back as the map has it, it is heard as nothing.
  hears(STRIPPED, CAR, 10, 0, 10, 5333, 8000, -1);
  expect(heard()).toEqual([]);
  // A heap mined out and a piece taken up are heard as they were.
  hears(HEAP, 0, 10, 0, 10, 4, 0, GONE_TAKEN);
  hears(k("core:wall_metal"), 0, 10, 0, 10, 100, 0, GONE_TAKEN);
  expect(heard()).toEqual(["demolish", "demolish"]);
  expect([build.merged(CAR, 0, GONE_TAKEN), build.merged(CAR, 0, GONE_BLAST), build.merged(HEAP, 0, GONE_TAKEN)]).toEqual([true, true, false]);
});

/** The attacker's hit on something built, as the session reads one, with what the app found it landed on. */
const hit = (struck?: number): CombatEvent => ({ kind: EVENT_HIT, x: 12, y: 1, z: 10, zone: ZONE_NONE, damage: 333, kill: false, blocked: false, bearing: 0, side: false, silenced: false, name: "", item: 0, far: 0, level: 0, xp: 0, flies: false, vx: 0, vy: 0, vz: 0, back: 0, rays: 1, seed: 0, ...(struck === undefined ? {} : { struck }) });

test("a blow on a wreck is heard as metal, and on anything else built as stone", () => {
  const a = new ActionSounds(reg, () => -1);
  const own: OwnState = { alive: true, x: 10, y: 0, z: 10, act: 0, actTicks: 0, held: 0, female: false, vitals: null, tick: 0, level: 1, engrams: 0 };
  const heard: string[] = [];
  const hear: Hear = (_o, key) => void heard.push(KEYS[key]!.key);
  const blow = (struck?: number): string[] => {
    heard.length = 0;
    a.absorb([hit(struck)], [], 0);
    a.update(new RemoteSample(), own.x, own.y + 1.6, own.z, own, -1, 0, 1, () => false, hear, () => {});
    return heard.slice();
  };
  expect([blow(CAR), blow(STRIPPED), blow(SHELL)]).toEqual(Array(3).fill(["hit/marker", "impact/metal"]));
  expect([blow(WALL), blow(HEAP), blow(k("core:wall_metal")), blow(0), blow()]).toEqual(Array(5).fill(["hit/marker", "impact/stone"]));
});

artTest("each sound a wreck is heard by is in the client's sound file", () => {
  const ids = findSheets().flatMap((s) => Object.keys(s.sheet.sounds).map((name) => `${s.owner}/sound/${name}`));
  const held = soundsHeard(ids, reg);
  const found = (key: string): string | undefined => candidates(reg.ids[CAR]!, KEYS[cueKey(key)]!).find((c) => held.has(c.id))?.id;
  expect([found("hit/metal"), found("destroy/metal"), found("impact/metal")]).toEqual(["core:surface/sound/impact/metal", "core:structure/sound/destroy/metal", "core:surface/sound/impact/metal"]);
});
