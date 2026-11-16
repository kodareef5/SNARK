// The client's sound file holds the sounds a cue the game fires can reach, and the sound board's loose file the rest.

import { expect, test } from "bun:test";
import { soundsHeard } from "../../shared/sound/reach.ts";
import { findSheets } from "../../tools/pack/sound.ts";
import { coreRegistry } from "../fixtures/world.ts";

const ids = findSheets().flatMap((s) => Object.keys(s.sheet.sounds).map((name) => `${s.owner}/sound/${name}`));
const heard = soundsHeard(ids, coreRegistry());

test("what the game fires reaches a creature's own sounds, the shared ones, the interface, the world, a rotor's, a boat's and a car's engine", () => {
  for (const id of ["core:dodo/sound/call", "core:dodo/sound/peck", "core:surface/sound/step/grass", "core:weapon/sound/fire/pistol", "core:ui/sound/click", "core:world/sound/bed/jungle/day", "core:helicopter/sound/engine/idle", "core:helicopter/sound/wash", "core:boat/sound/hull/slow", "core:survivor/sound/voice/male/hurt", "core:vehicle/sound/engine/idle", "core:vehicle/sound/engine/start"]) {
    expect(ids).toContain(id);
    expect(heard.has(id)).toBe(true);
  }
});

test("nothing reaches a sound whose cue waits, such as a car's tyres or horn, a creature with no definition or the voice library", () => {
  for (const id of ["core:helicopter/sound/flyby", "core:boat/sound/horn", "core:survivor/sound/voice/male/cough", "core:vehicle/sound/horn", "core:vehicle/sound/tire/roll/asphalt"]) {
    expect(ids).toContain(id);
    expect(heard.has(id)).toBe(false);
  }
  expect([...heard].some((id) => id.startsWith("core:rex/") || id.startsWith("core:voices/"))).toBe(false);
  expect(heard.size).toBeLessThan(ids.length / 4);
});
