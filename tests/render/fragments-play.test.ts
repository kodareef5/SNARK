// A city piece breaking on a server, as the app of a client that watches throws it (client/core/app.ts, rubble.ts).

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { SET_LEAVES, SET_STOOD } from "../../client/core/fragments.ts";
import { fragmentSlot } from "../../client/core/render/fragment-meshes.ts";
import { FORM_BREACH_A, FORM_HEAP, FORM_OPEN, formKind } from "../../shared/content/breaks.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { variantAt } from "../../shared/world/breaking.ts";
import { ROCKET_REACH, city, rocket } from "../fixtures/city.ts";
import { corePackBytes } from "../fixtures/pack.ts";

test("a rocket's breach and a blast's heap reach the app as fragments", () => {
  const c = city([{ shape: "wall8", finish: "limestone", x: 120, z: 120 }, { shape: "wall8", finish: "limestone", x: 150, z: 120 }]);
  const { h } = c, [near, far] = c.refs as [number, number];
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, parsePack(corePackBytes()));
  let packet: ReturnType<App["frame"]> = null;
  // Seconds after its tick at which each piece was first seen falling.
  const first: number[] = [];
  const run = (ms: number): void =>
    h.run(ms, (now) => {
      packet = app.frame(now, 1280, 720);
      for (let i = first.length; app.falling && i < app.falling.count; i++) first.push(app.falling.since(i));
    });
  run(1500);
  const falling = app.falling!, placed = h.reg.index.get("core:zruin_wall8_limestone")!;
  const kindIn = (ref: number, form: number): number => formKind(h.reg, placed, form, variantAt(c.at(ref).x, c.at(ref).y, c.at(ref).z));

  // A rocket breaches the nearer wall in place: what leaves it on the way to that breach is thrown, in the wall's finish.
  h.host.combat.blast(rocket(h.reg), 118, 1.4, 119.5, ROCKET_REACH);
  run(400);
  expect([c.form(near), falling.count, falling.sets[0]!.key, falling.map[0]]).toEqual([FORM_BREACH_A, 1, kindIn(near, FORM_BREACH_A) * 4 + SET_LEAVES, placed]);
  const p = packet!;
  expect([...Array(p.drawCount).keys()].filter((d) => fragmentSlot(p.drawSlot[d]!)).length).toBe(1);

  // The farther wall is opened, then blown to its heap: what leaves it, then what stood of it open.
  const huge = { ...rocket(h.reg), base: 1e7 };
  for (let k = 0; k < 2; k++) h.host.combat.hitStructure(huge, far, 150, 1, 120);
  run(300);
  expect([c.form(far), falling.count, falling.sets[1]!.key]).toEqual([FORM_OPEN, 2, kindIn(far, FORM_OPEN) * 4 + SET_LEAVES]);
  h.host.combat.blast(huge, 150, 1.5, 119.5, ROCKET_REACH);
  run(300);
  expect([c.form(far), falling.count, falling.sets[2]!.key]).toEqual([FORM_HEAP, 3, kindIn(far, FORM_OPEN) * 4 + SET_STOOD]);
  // Each began as the client heard of it, within a few ticks of the server's own: none joined its fall part way.
  expect(first.map((seconds) => seconds >= 0 && seconds < 6 / TICK_RATE)).toEqual([true, true, true]);
  // They are forgotten after the tier's rest time.
  run((app.scene!.assets.tier.breaks.rest + 2) * 1000);
  expect(falling.count).toBe(0);
});
