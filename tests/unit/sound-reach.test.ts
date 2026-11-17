// The client's sound file holds the sounds a cue the game fires can reach, and the sound board's loose file the rest;
// and which occasions the game fires no sheet answers.

import { expect } from "bun:test";
import { coverage } from "../../client/core/sound/coverage.ts";
import { soundsHeard } from "../../shared/sound/reach.ts";
import { findSheets } from "../../tools/pack/sound.ts";
import { test } from "../fixtures/needs-art.ts";
import { coreRegistry } from "../fixtures/world.ts";

const ids = findSheets().flatMap((s) => Object.keys(s.sheet.sounds).map((name) => `${s.owner}/sound/${name}`));
const heard = soundsHeard(ids, coreRegistry());

test("what the game fires reaches a creature's own sounds, the shared ones, the interface, the world, a rotor's, a boat's and a car's engine", () => {
  for (const id of ["core:dodo/sound/call", "core:dodo/sound/peck", "core:surface/sound/step/grass", "core:body/sound/eat", "core:structure/sound/fire/out", "core:weapon/sound/fire/pistol", "core:ui/sound/click", "core:world/sound/bed/jungle/day", "core:helicopter/sound/engine/idle", "core:helicopter/sound/wash", "core:boat/sound/hull/slow", "core:survivor/sound/voice/male/hurt", "core:vehicle/sound/engine/idle", "core:vehicle/sound/engine/start"]) {
    expect(ids).toContain(id);
    expect(heard.has(id)).toBe(true);
  }
});

test("nothing reaches a sound whose cue waits, such as a car's tyres or horn, a creature with no definition or the voice library", () => {
  // A vehicle is asked only the vehicle cues: the helicopter's alarm and landing are not a creature's startle and landing.
  for (const id of ["core:helicopter/sound/flyby", "core:helicopter/sound/alarm", "core:helicopter/sound/land", "core:plane/sound/touchdown", "core:truck/sound/engine/brake", "core:boat/sound/horn", "core:survivor/sound/voice/male/cough", "core:vehicle/sound/horn", "core:vehicle/sound/tire/roll/asphalt"]) {
    expect(ids).toContain(id);
    expect(heard.has(id)).toBe(false);
  }
  expect([...heard].some((id) => id.startsWith("core:rex/") || id.startsWith("core:voices/"))).toBe(false);
  expect(heard.size).toBeLessThan(ids.length / 4);
});

test("every occasion the game fires is answered but another survivor's hurt and knock-out, which no client is told of, and the pump, which only the shotgun has", () => {
  const silent = coverage(ids).rows.filter((r) => !r.shared && r.owners.length === 0 && !r.cue.status.startsWith("waits:"));
  expect(silent.map((r) => `${r.key} ${r.cue.status}`)).toEqual(["hurt/other gap", "knocked_out/other gap", "pump fire"]);
  // The listing asks no weapon by name; the shotgun finds its pump under the shared family's name.
  expect(heard.has("core:weapon/sound/pump/shotgun")).toBe(true);
});
