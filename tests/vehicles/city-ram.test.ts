// A car rams through what its energy breaks of the city: panes, then a half of sheet or block, never concrete that bears.

import { expect, test } from "bun:test";
import type { RuinFinish, RuinShape } from "../../content/ruins.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { FORM_BREACH_A, FORM_BREACH_B, FORM_WHOLE } from "../../shared/content/breaks.ts";
import { paned } from "../../shared/world/breaking.ts";
import { city } from "../fixtures/city.ts";

// A piece on flat ground in the middle of a 4-chunk map, its face to the south, and a car driven at it from 8 m south. A
// tree stands in a far chunk: a world with plants is one whose cars break what they hit (server/host.ts).
function camp(shape: RuinShape, finish: RuinFinish, speed: number, aside = 0) {
  const first = new Uint32Array(17); for (let i = 1; i < first.length; i++) first[i] = 1;
  const nodes = [{ kinds: ["core:tree"], first, kind: new Uint8Array([0]), x: new Uint16Array([24 * 1024]), z: new Uint16Array([28 * 1024]), yaw: new Uint16Array([0]) }];
  const c = city([{ shape, finish, x: 128, z: 128 }], 4, { clips: NO_CLIPS, rigs: [] }, {}, { nodes, spawns: [{ name: "Driver", x: 100, z: 100, yaw: 0 }] });
  const { h } = c;
  const piece = c.refs[0]!;
  const car = h.host.spawnVehicle("core:compact", 128 + aside, 120, 0);
  expect(car).toBeGreaterThanOrEqual(0);
  const a = h.world.ents;
  a.vz[car] = speed;
  let fastest = 0;
  const run = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) {
      h.server.tick();
      fastest = Math.max(fastest, Math.hypot(a.vx[car]!, a.vz[car]!));
    }
  };
  const kind = h.world.structs.mapKind(Math.floor(piece / 65536), piece & 0xffff);
  return { c, h, piece, car, a, run, kind, panes: (): boolean => paned(h.reg, kind, c.hp(piece)) };
}

test("a car goes through a sheet bay and a shop's glass, not a concrete pier", () => {
  // Sheet, 40 kJ a half: the west half is torn where the car met it, and what speed is left carries the car on.
  const sheet = camp("wall8", "rustsheet", 22, -2);
  try {
    sheet.run(45);
    expect(sheet.c.form(sheet.piece)).not.toBe(FORM_WHOLE);
    expect(sheet.a.z[sheet.car]!).toBeGreaterThan(129);
    expect(sheet.h.host.combat.city.breaks).toBeGreaterThan(0);
  } finally { sheet.h.host.shutdown(); }

  // A shop front of block: its panes go at 8 kJ, whatever becomes of the rest.
  const shop = camp("zstore", "limestucco", 22, -2);
  try {
    expect(shop.panes()).toBe(true);
    shop.run(45);
    expect(shop.panes()).toBe(false);
  } finally { shop.h.host.shutdown(); }

  // A slow car takes the panes and no more: under block's 180 kJ, the front stands, and the car stops against it.
  const slow = camp("zstore", "limestucco", 14, -2);
  try {
    slow.run(60);
    expect([slow.panes(), slow.c.form(slow.piece), slow.a.z[slow.car]! < 128]).toEqual([false, FORM_WHOLE, true]);
  } finally { slow.h.host.shutdown(); }

  // A concrete pier bears: nothing rams through it, at any speed.
  const pier = camp("pier8", "concrete", 40);
  try {
    pier.run(45);
    expect([pier.c.form(pier.piece), pier.c.hp(pier.piece), pier.a.z[pier.car]! < 128]).toEqual([FORM_WHOLE, pier.c.full(pier.piece), true]);
  } finally { pier.h.host.shutdown(); }
});

test("a rammed wall is breached in the half the car met, unless CityRamming is off", () => {
  const west = camp("wall8", "rustsheet", 16, -2);
  const east = camp("wall8", "rustsheet", 16, 2);
  const off = camp("wall8", "rustsheet", 22, -2);
  try {
    west.run(45);
    east.run(45);
    expect([west.c.form(west.piece), east.c.form(east.piece)]).toEqual([FORM_BREACH_A, FORM_BREACH_B]);
    // A breached piece's health is under a third, as one breached by harm is.
    expect(west.c.hp(west.piece)).toBeLessThanOrEqual(west.c.full(west.piece) / 3);
    // The car lost what the half took, and went on through the mouth.
    expect(west.a.z[west.car]!).toBeGreaterThan(129);
    expect(off.h.host.rules.assign("CityRamming", "False", "console")).toBe("");
    off.run(45);
    expect([off.c.form(off.piece), off.c.hp(off.piece), off.a.z[off.car]! < 128]).toEqual([FORM_WHOLE, off.c.full(off.piece), true]);
  } finally { for (const x of [west, east, off]) x.h.host.shutdown(); }
});
