// A street's wreck salvaged on a server, as the app of the survivor who works it shows it (client/core/app.ts): the word
// under the crosshair, sparks at each blow, a puff at a rung and at the last, and nothing thrown or fallen.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { BREAK_CHIPS, BREAK_DUST, BREAK_GLASS, BREAK_SPARKS } from "../../client/core/details/breaks.ts";
import type { Source } from "../../server/combat.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { DMG_MELEE } from "../../shared/sim/damage.ts";
import { city } from "../fixtures/city.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { record } from "../kit/kit.ts";

test("the whole client: a wreck's word, a blow's sparks, a rung, and the last of it", () => {
  // Across the street four metres north of where she stands, its side to her.
  const c = city([{ kind: "core:zzzzroad_fastback_abandoned_blue", x: 128, z: 133, yaw: 16384 }]);
  const car = c.refs[0]!;
  const { h } = c;
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, parsePack(corePackBytes()));
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(600);
  const s = app.session;
  s.text("enablecheats");
  run(300);
  s.text("tp 128 130.4");
  [app.controls.yaw, app.controls.pitch] = [0, -0.35];
  run(500);
  expect(app.hud.prompt).toBe("wreck");
  // What the details are asked for, a part and its count each.
  const asked: [part: number, count: number][] = [];
  const details = app.scene!.details, burst = details.breakBurst.bind(details);
  details.breakBurst = (part, id, x, y, z, floor, tick, due, size, count, rgb) => {
    asked.push([part, count]);
    burst(part, id, x, y, z, floor, tick, due, size, count, rgb);
  };
  const of = (part: number): number => asked.reduce((n, a) => n + (a[0] === part ? a[1] : 0), 0);
  const low = app.scene!.assets.tier.name === "lowpoly";
  const pick: Source = { by: record(h, s), x: 128, z: 130.4, item: h.reg.index.get("core:pick_metal")!, base: 32, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0, pierce: 0 };
  const blows = (n: number): void => {
    for (let i = 0; i < n; i++) {
      h.host.combat.hitStructure(pick, car, 128, 0.7, 132.1);
      run(250);
    }
  };
  // A blow within a rung sends her no row: its hit alone throws sparks where it landed, and no dust.
  blows(1);
  expect([c.id(car), of(BREAK_SPARKS) > 0 || low, of(BREAK_DUST) + of(BREAK_CHIPS) + of(BREAK_GLASS)]).toEqual(["core:zzzzroad_fastback_abandoned_blue", true, 0]);
  // The eighth takes the rung: a puff of dust, and the word is its look's.
  blows(6);
  asked.length = 0;
  blows(1);
  expect([c.id(car), app.hud.prompt, of(BREAK_DUST) > 0, of(BREAK_CHIPS) + of(BREAK_GLASS)]).toEqual(["core:zzzzzzzwreck_fastback_abandoned_stripped", "stripped", true, 0]);
  // Eight more leave its shell, and eight more cut it up: a last puff, no word, and nothing fell at any time.
  blows(8);
  expect([c.id(car), app.hud.prompt]).toEqual(["core:zzzzzzzwreck_fastback_abandoned_shell", "shell"]);
  blows(7);
  asked.length = 0;
  blows(1);
  expect([c.id(car), app.hud.prompt, of(BREAK_DUST) > 0, of(BREAK_CHIPS) + of(BREAK_GLASS), app.falling!.taken]).toEqual(["", "", true, 0, 0]);
});
