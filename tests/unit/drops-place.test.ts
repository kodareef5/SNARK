// Places and pace on the drop book's admin page (client/core/drops/place.ts).

import { expect, test } from "bun:test";
import { ensureAt, read, setAt } from "../../client/core/drops/edit.ts";
import { addCircuit, addSite, circuitOf, forecast, inWorld, looseSites, moveSite, removeCircuit, removeLoose, removeSite, siteNear, takeOut, toPixel, toWorld } from "../../client/core/drops/place.ts";
import { starterBook } from "../../content/supply/starter.ts";
import { withSites } from "../../content/supply/sites.ts";
import { bookFaults } from "../../shared/supply/book.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { paintRelief } from "../../shared/world/relief.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";

test("a place of the world is where the relief picture paints it, and a point of the picture is that place again", () => {
  // A world wider than it is deep: the picture is square, the world in its middle, north up and x running west.
  const w = { sizeX: 2048, sizeZ: 1024 };
  expect([toPixel(w, 2048, 1536, 512), toPixel(w, 0, -512, 512), toPixel(w, 1024, 512, 512)]).toEqual([[0, 0], [512, 512], [256, 256]]);
  expect([toWorld(w, 0, 0, 512), toWorld(w, 256, 256, 512), toWorld(w, ...toPixel(w, 700, 300, 512), 512)]).toEqual([[2048, 1536], [1024, 512], [700, 300]]);
  expect([inWorld(w, 10, 10), inWorld(w, 10, 1100), inWorld(w, -1, 5)]).toEqual([true, false, false]);
  // Against the painter itself: a single high sample is painted at the pixel its place maps to.
  const dims = { chunksX: 2, chunksZ: 1 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 2);
  const out = new Uint32Array(64 * 64);
  paintRelief(hf, defaultPalette(), 0, 0, 0, 64, out);
  const flat = out[toPixel({ sizeX: hf.sizeX, sizeZ: hf.sizeZ }, hf.sizeX / 2, hf.sizeZ / 2, 64).map(Math.floor).reduce((px, py) => py * 64 + px)]!;
  const [vx, vy] = toPixel({ sizeX: hf.sizeX, sizeZ: hf.sizeZ }, hf.sizeX / 2, hf.sizeZ + 40, 64).map(Math.floor) as [number, number];
  // Inside the world the land is painted; past its north edge the picture is the void's colour.
  expect([flat !== out[vy * 64 + vx], vy < 32]).toEqual([true, true]);
});

test("sites are added under a circuit's next key, moved, found by where they are, and taken away with their circuit", () => {
  const b = withSites(starterBook(), "core:miami");
  expect([b.circuits.map((c) => c.key), b.sites.length > 900]).toEqual([["shore", "inland", "deep"], true]);
  const many = b.sites.length;
  const key = addSite(b, "shore", 1234.4, 5678.6)!;
  expect([key, b.sites.at(-1), b.circuits[0]!.sites.at(-1), circuitOf(b, key)!.key, addSite(b, "nowhere", 1, 1)]).toEqual([`shore/${String(b.circuits[0]!.sites.length).padStart(3, "0")}`, { key, x: 1234, z: 5679 }, key, "shore", null]);
  expect([siteNear(b.sites, 1240, 5670, 30)!.key, siteNear(b.sites, 1240, 5670, 5)]).toEqual([key, null]);
  moveSite(b, key, 2000.2, 3000.7);
  expect([siteNear(b.sites, 2000, 3001, 1)!.key, bookFaults(b).filter((f) => !f.warn)]).toEqual([key, []]);
  removeSite(b, key);
  expect([b.sites.length, b.circuits[0]!.sites.includes(key)]).toEqual([many, false]);
  // A new circuit is off and draws the lowest tiers until it is told otherwise; a key taken or ill made is refused.
  expect([addCircuit(b, "harbour"), addCircuit(b, "harbour"), addCircuit(b, "Bad Key"), b.circuits.at(-1)!.on, Object.keys(b.circuits.at(-1)!.tierWeights)]).toEqual([true, false, false, false, ["white", "green", "blue"]]);
  const deep = b.circuits.find((c) => c.key === "deep")!.sites.length;
  removeCircuit(b, "deep");
  expect([b.circuits.map((c) => c.key), b.sites.length, bookFaults(b).filter((f) => !f.warn)]).toEqual([["shore", "inland", "harbour"], many - deep, []]);
  // A first weight is put in a list of none.
  const cls = ["classes", 0, "weights", "red"] as const;
  expect(() => setAt(b, cls, 2)).toThrow("no place");
  ensureAt(b, cls);
  setAt(b, cls, 2);
  expect(b.classes[0]!.weights).toEqual({ red: 2 });
});

test("a circuit is switched off by its tick and the book still saves; taken out, its sites go with it and no other circuit's do", () => {
  const b = withSites(starterBook(), "core:miami");
  const many = b.sites.length;
  const shore = b.circuits[0]!.sites.length;
  expect([b.circuits[0]!.key, b.circuits[0]!.on, shore > 100]).toEqual(["shore", true, true]);
  // The tick of a thing the book must say either way reads as false, not as nothing: a circuit with no `on` is a fault.
  const off = read("flag", "false", false);
  expect([off, read("flag", "true", false), read("flag", "false")]).toEqual([{ ok: true, value: false }, { ok: true, value: true }, { ok: true, value: undefined }]);
  setAt(b, ["circuits", 0, "on"], off.value);
  expect([b.circuits[0]!.on, "on" in b.circuits[0]!, bookFaults(b).filter((f) => !f.warn), forecast(b, b.circuits[0]!).held]).toEqual([false, true, [], "it is off"]);
  // A site two circuits name stays while one of them is left.
  const shared = b.circuits[0]!.sites[0]!;
  b.circuits[1]!.sites.push(shared);
  // What the page's button does at a circuit's place: the circuit and the sites it alone named.
  takeOut(b, ["circuits", 0]);
  expect([b.circuits.map((c) => c.key), b.sites.length, b.sites.some((s) => s.key === shared), bookFaults(b)]).toEqual([["inland", "deep"], many - shore + 1, true, []]);
  // Every site left is some circuit's: none is kept that the map would not show.
  const named = new Set(b.circuits.flatMap((c) => c.sites));
  expect(b.sites.every((s) => named.has(s.key))).toBe(true);
  // A book read from a file may have sites no circuit names: they are told apart and taken out together.
  b.sites.push({ key: "stray/1", x: 10, z: 10 }, { key: "stray/2", x: 20, z: 20 });
  expect([looseSites(b).map((s) => s.key), removeLoose(b), looseSites(b), b.sites.length]).toEqual([["stray/1", "stray/2"], 2, [], many - shore + 1]);
  // At any other place it takes out what is there, as before.
  const slots = b.tables["white/arms"]!.slots.length;
  takeOut(b, ["tables", "white/arms", "slots", 0]);
  expect(b.tables["white/arms"]!.slots.length).toBe(slots - 1);
});

test("a circuit's forecast is its clock's pace, held back by what may be live at once, with each tier's share", () => {
  const b = withSites(starterBook(), "core:miami");
  const [shore, inland, deep] = b.circuits as [typeof b.circuits[0], typeof b.circuits[0], typeof b.circuits[0]];
  // The shore asks for one every five and a half minutes: 10.9 an hour. A drop is live for its four minutes of notice and
  // twenty on the ground, so five at once are 12.5 an hour at the most: its clock is the limit.
  const f = forecast(b, shore);
  expect([Math.round(f.asked * 10) / 10, Math.round(f.hour * 10) / 10, f.held, f.tiers.map((t) => [t.key, Math.round(t.share * 100)])]).toEqual([10.9, 10.9, "", [["white", 48], ["green", 33], ["blue", 14], ["purple", 5]]]);
  expect([forecast(b, inland).held, forecast(b, deep).held]).toEqual(["", ""]);
  // Asked for one a minute, it is held to what five at once allow; with the book's most at once at two, to that.
  shore.interval = [50, 70];
  expect([Math.round(forecast(b, shore).asked), Math.round(forecast(b, shore).hour * 10) / 10, forecast(b, shore).held]).toEqual([60, 12.5, "its most at once"]);
  b.rules.maxLive = 2;
  expect([Math.round(forecast(b, shore).hour * 10) / 10, forecast(b, shore).held]).toEqual([5, "the book's most at once"]);
  // Off, with nowhere to land, or drawing no tier, it calls none, and says which.
  shore.on = false;
  expect([forecast(b, shore).hour, forecast(b, shore).held]).toEqual([0, "it is off"]);
  // With no sites it lands on open ground, as a map with none does.
  expect([forecast(b, { ...shore, on: true, sites: [] }).hour > 0, forecast(b, { ...shore, on: true, tierWeights: {} }).held]).toEqual([true, "it draws no tier"]);
});
