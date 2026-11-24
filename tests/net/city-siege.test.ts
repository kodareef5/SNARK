// What a breaking city costs on the wire and in the tick, printed: a bullet into glass, a rocket through three pieces,
// and a siege of 50 hits a tick.

import { expect, test } from "bun:test";
import { FORM_BREACH_A, FORM_OPEN } from "../../shared/content/breaks.ts";
import { S_CHUNK } from "../../shared/net/protocol.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { ROCKET_REACH, city, grenade, rifle, rocket, type City, type CityPiece } from "../fixtures/city.ts";

/** The chunk messages session 0 has been sent since the last call, as their sizes in bytes. */
function watch(c: City): () => number[] {
  const end = c.h.ends[0]!;
  const on = end.onMessage!;
  let sizes: number[] = [];
  end.onMessage = (ch, d) => {
    if (d[0] === S_CHUNK) sizes.push(d.length);
    on(ch, d);
  };
  return () => {
    const out = sizes;
    sizes = [];
    return out;
  };
}

/** Joins a client and waits until it holds every chunk the server does. */
function watched(c: City): () => number[] {
  const s = c.h.join("ada");
  const structs = c.h.world.structs;
  for (let n = 0; n < 100 && !structs.held.every((k) => c.h.client(s)?.known[k] === structs.chunks[k]!.version); n++) c.h.run(100);
  c.h.run(300);
  return watch(c);
}

test("a bullet into glass and a rocket through three pieces cost these bytes", () => {
  const c = city([
    { shape: "zwin", finish: "limestucco", x: 100, z: 100 },
    { shape: "wall8", finish: "limestucco", x: 100, z: 140 }, { shape: "wall8", finish: "limestucco", x: 100, z: 142 }, { shape: "wall4", finish: "limestucco", x: 100, z: 141, up: 3.5 },
  ]);
  const [window, front, back, over] = c.refs as [number, number, number, number];
  const { h } = c;
  for (let k = 0; k < 2; k++) h.host.combat.hitStructure({ ...rocket(h.reg), base: 1e7 }, over, 100, 5, 141);
  expect(c.form(over)).toBe(FORM_OPEN);
  const sent = watched(c);
  // One round leaves the panes standing and is told to nobody. The round that takes them is their going, as health.
  h.host.combat.hitStructure(rifle(h.reg), window, 100, 2, 100);
  h.run(200);
  const first = sent();
  h.host.combat.hitStructure(rifle(h.reg), window, 100, 2, 100);
  h.run(200);
  const second = sent();
  expect([first, second.length]).toEqual([[], 1]);
  // One rocket between two walls: each breached in the half it is nearest, and the opened wall over them gone.
  h.host.combat.blast(rocket(h.reg), 98, 1.4, 141, ROCKET_REACH);
  h.run(200);
  const blast = sent();
  expect([c.form(front), c.form(back), c.id(over), blast.length]).toEqual([FORM_BREACH_A, FORM_BREACH_A, "", 1]);
  console.log(`city wire: a bullet into glass ${first.length === 0 ? 0 : first[0]} bytes while panes stand, ${second[0]} bytes for the round that takes them; a rocket that breaches two pieces and destroys one ${blast[0]} bytes`);
  expect(second[0]!).toBeLessThanOrEqual(16);
  expect(blast[0]!).toBeLessThanOrEqual(48);
});

test("a siege of 50 hits a tick sends a client little and costs the tick little", () => {
  // Fifty concrete walls in the chunks round the spawn, each hit once a tick for 100 health.
  const pieces: CityPiece[] = [];
  for (let k = 0; k < 50; k++) pieces.push({ shape: "wall8", finish: "concrete", x: 88 + (k % 10) * 9, z: 100 + Math.floor(k / 10) * 12 });
  const c = city(pieces);
  const { h } = c;
  const sent = watched(c);
  const src = { ...grenade(h.reg), base: 100 / (h.reg.structureMul[h.reg.index.get("core:grenade")!]! * 2.33) };
  const places = c.refs.map((ref) => c.at(ref));
  const TICKS = 10 * TICK_RATE;
  const quiet = performance.now();
  for (let t = 0; t < TICKS; t++) h.run(1000 / TICK_RATE);
  const idle = (performance.now() - quiet) / TICKS;
  sent();
  let hits = 0;
  let inHits = 0;
  const began = performance.now();
  for (let t = 0; t < TICKS; t++) {
    const at = performance.now();
    for (let k = 0; k < c.refs.length; k++) if (h.host.combat.hitStructure(src, c.refs[k]!, places[k]!.x, places[k]!.y, places[k]!.z) > 0) hits++;
    inHits += performance.now() - at;
    h.run(1000 / TICK_RATE);
  }
  const busy = (performance.now() - began) / TICKS;
  const sizes = sent();
  const bytes = sizes.reduce((a, b) => a + b, 0);
  const city_ = h.host.combat.city;
  console.log(`city siege: ${hits} hits in ${TICKS} ticks (${(hits / TICKS).toFixed(1)} a tick), ${city_.silent} told to nobody, ${city_.breaks} changes of form; ${sizes.length} messages, ${bytes} bytes, ${(bytes / (TICKS / TICK_RATE)).toFixed(0)} bytes a second to a client; the hits ${(inHits / TICKS).toFixed(3)} ms a tick, a tick with client ${busy.toFixed(3)} ms against ${idle.toFixed(3)} ms idle`);
  // Each wall lives 295 hits: worn, breached, opened, a heap, then gone, five ticks before the end.
  expect([hits, city_.breaks]).toEqual([50 * 295, 200]);
  // As every hit was once a row: 50 in-place rows a tick were 9.45 KB a second.
  expect(bytes / (TICKS / TICK_RATE)).toBeLessThan(600);
  expect(city_.silent).toBeGreaterThan(hits * 0.95);
  expect(inHits / TICKS).toBeLessThan(2);
});
