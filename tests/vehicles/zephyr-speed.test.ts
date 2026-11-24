// The Zephyr held at its boost speed, over a line with lag: its driver's page predicts it without a correction, on open
// ground and down a deck of road pieces whose chunks' rows come as the car reaches them.

import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { BTN_SPRINT } from "../../shared/sim/character.ts";
import type { MapStatic } from "../../shared/world/mapfile.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

const LINK = { tcp: true, latencyMs: 30, jitterMs: 8 };

/** `s` at the wheel of a Zephyr set down at (x, z) facing +z. */
function seat(h: Harness, s: ClientSession, x: number, z: number): number {
  const c = h.client(s)!, a = h.world.ents;
  const car = h.host.spawnVehicle("core:zephyr", x, z, h.host.records.byPid.get(c.pid)!.team);
  expect(car).toBeGreaterThanOrEqual(0);
  a.setPosition(c.ent, x + 1.8, a.y[car]! + 0.05, z + 0.1);
  h.world.history.discontinuity(c.ent);
  expect(h.host.urban.mount(c, car)).toBe(0);
  h.run(1500);
  expect(s.driving).toBe(car);
  return car;
}

test("a Zephyr weaving at its boost speed over a line with lag is predicted without a correction", () => {
  const chunks = 32;
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(chunks)) });
  try {
    const s = h.join("driver", LINK), pilot = h.pilots[0]!;
    h.run(400);
    const car = seat(h, s, (chunks * CHUNK_SIZE) / 2, 24), a = h.world.ents;
    const before = { ...s.stats };
    s.prediction.enabled = true;
    let fastest = 0, frames = 0;
    pilot.moveZ = 127;
    // The nozzles fire again each time they are ready: the fourth boost starts from the engine's own top speed.
    pilot.buttons = BTN_SPRINT;
    h.run(22000, () => {
      pilot.moveX = Math.round(Math.sin(++frames / 90) * 30);
      fastest = Math.max(fastest, Math.hypot(a.vx[car]!, a.vz[car]!));
    });
    expect(fastest).toBeGreaterThan(75);
    expect([s.stats.corrections - before.corrections, s.stats.stateCorrections - before.stateCorrections, s.stats.clockJumps - before.clockJumps, s.stats.unheld - before.unheld]).toEqual([0, 0, 0, 0]);
    expect(s.prediction.differences).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("a Zephyr at its boost speed down a deck of road pieces never outruns its chunks' rows", () => {
  const chunks = 32, column = chunks / 2, mid = column * CHUNK_SIZE + CHUNK_SIZE / 2, slab = "core:zruin_floor8_concrete";
  // A slab set at the ground stands 0.2 m over it: sunk to a kerb's height, eight a chunk, from the second chunk on.
  // Each of the deck's chunks and its neighbours holds 600 piers besides, off the deck, so its rows are many ticks' worth.
  const statics: MapStatic[] = [];
  for (let cz = 1; cz < chunks; cz++) {
    for (let dx = -1; dx <= 1; dx++) for (let i = 0; i < 600; i++) {
      const col = i % 30, row = Math.floor(i / 30);
      const x = (column + dx) * CHUNK_SIZE + (dx !== 0 ? 1 + col * 2.05 : col < 15 ? 1 + col * 1.2 : 46 + (col - 15) * 1.2);
      statics.push({ kind: "core:zruin_pier4_concrete", x, y: 0, z: cz * CHUNK_SIZE + 1 + row * 3, yaw: 0 });
    }
    for (let k = 0; k < 8; k++) statics.push({ kind: slab, x: mid, y: -0.1, z: cz * CHUNK_SIZE + 4 + k * 8, yaw: 0 });
  }
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(chunks, { statics })) });
  try {
    // Without the map's own pieces in hand, as a page is until its whole map has come: every row is sent.
    const s = h.join("driver", LINK, { statics: false }), pilot = h.pilots[0]!;
    h.run(400);
    const car = seat(h, s, mid, 30), a = h.world.ents;
    const before = { ...s.stats };
    let fastest = 0, onDeck = 0, behind = 0;
    pilot.moveZ = 127;
    pilot.buttons = BTN_SPRINT;
    h.run(22000, () => {
      fastest = Math.max(fastest, Math.hypot(a.vx[car]!, a.vz[car]!));
      if (a.y[car]! > 0.05) onDeck++;
      const ahead = Math.min(chunks - 1, Math.floor((s.own.z + 40) / CHUNK_SIZE)) * chunks + column;
      if (!s.world!.far.complete(ahead)) behind++;
    });
    expect(fastest).toBeGreaterThan(75);
    expect(onDeck).toBeGreaterThan(900);
    // The chunk 40 m ahead was whole at every frame, and the page drove on the pieces the server did.
    expect(behind).toBe(0);
    expect([s.stats.corrections - before.corrections, s.stats.stateCorrections - before.stateCorrections, s.stats.unheld - before.unheld]).toEqual([0, 0, 0]);
  } finally {
    h.host.shutdown();
  }
});
