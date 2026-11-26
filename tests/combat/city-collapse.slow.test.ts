// The six buildings the design worked through, on the built Miami under a real server: a house, a shop row, flats, a
// tower, a shed and a garage, each broken as the design's table says and left to settle. Needs var/maps/miami.snmap built
// with its buildings (or CITY_MAP naming one); without it these are skipped. What happened is printed.

import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { Source } from "../../server/combat.ts";
import { BREAK_FAMILIES, FORM_BREACH_A, FORM_BREACH_B, FORM_HEAP, FORM_HUNG, FORM_OPEN, FORM_WHOLE } from "../../shared/content/breaks.ts";
import { Pieces, carrying, gather } from "../../shared/world/bearing.ts";
import { formOf } from "../../shared/world/breaking.ts";
import { readHead, type MapHead } from "../../shared/world/mapfile.ts";
import { rocket } from "../fixtures/city.ts";
import { Harness } from "../fixtures/net.ts";

const file = process.env.CITY_MAP ?? "var/maps/miami.snmap";
/** The map's head alone, read from the front of its file: its length is the u32 at byte 12. */
async function head(): Promise<MapHead> {
  const f = Bun.file(file), front = new DataView(await f.slice(0, 16).arrayBuffer());
  return readHead(new Uint8Array(await f.slice(0, front.getUint32(12, true)).arrayBuffer()), false);
}
const there = existsSync(file) && (await head()).buildings !== null;
let made: Harness | null = null;
/** One server on the city for every test here. */
async function server(): Promise<Harness> {
  return (made ??= new Harness({}, 1, 30, { dev: true, map: (await Bun.file(file).bytes()) as Uint8Array<ArrayBuffer> }));
}

/** A building's pieces as the rule gathers them, with each one's shape and family by name. */
interface Site {
  readonly h: Harness;
  readonly p: Pieces;
  readonly shape: string[];
  readonly family: string[];
  /** The form of piece `k` now: -1 once its slot is empty. */
  form(k: number): number;
  /** One blow no piece outlives a rung of. */
  strike(k: number): void;
  open(k: number): void;
  /** Runs until the building is out of doubt. Returns the pieces that changed since `was`, by what they became, with their shapes. */
  settle(was: number[]): { fell: string[]; heaps: string[]; hung: string[]; other: string[] };
  forms(): number[];
}

function site(h: Harness, id: number): Site {
  const world = h.world, structs = world.structs, reg = world.reg;
  const handles: number[] = [];
  world.buildings!.byId(id, handles);
  expect(handles.length).toBeGreaterThan(0);
  const p = gather(world.buildings!, handles, structs, reg, true);
  const mapKind = (k: number): number => structs.mapKind(Math.floor(p.ref[k]! / 65536), p.ref[k]! & 0xffff);
  const shape = Array.from({ length: p.n }, (_, k) => reg.ids[mapKind(k)]!.split("_")[1]!);
  const family = Array.from({ length: p.n }, (_, k) => BREAK_FAMILIES[p.family[k]!]!);
  const huge: Source = { ...rocket(reg), base: 1e7 };
  const form = (k: number): number => {
    const kind = structs.chunks[Math.floor(p.ref[k]! / 65536)]!.kind[p.ref[k]! & 0xffff]!;
    return kind === 0 ? -1 : formOf(reg, kind);
  };
  const strike = (k: number): void => {
    const t = structs.chunks[Math.floor(p.ref[k]! / 65536)]!, slot = p.ref[k]! & 0xffff;
    h.host.combat.hitStructure(huge, p.ref[k]!, t.x[slot]!, t.y[slot]!, t.z[slot]!);
  };
  const forms = (): number[] => Array.from({ length: p.n }, (_, k) => form(k));
  return {
    h, p, shape, family, form, strike, forms,
    open: (k) => {
      for (let n = 0; n < 4 && form(k) !== FORM_OPEN && form(k) !== -1 && form(k) !== FORM_HEAP; n++) strike(k);
    },
    settle: (was) => {
      const end = world.tick + 1800;
      while (h.host.cityCollapse.waiting > 0 && world.tick < end) h.run(1000 / 30);
      expect(h.host.cityCollapse.waiting).toBe(0);
      const out = { fell: [] as string[], heaps: [] as string[], hung: [] as string[], other: [] as string[] };
      forms().forEach((f, k) => {
        if (f === was[k]) return;
        (f === -1 ? out.fell : f === FORM_HEAP ? out.heaps : f === FORM_HUNG ? out.hung : out.other).push(`${shape[k]}@${p.level[k]}`);
      });
      return out;
    },
  };
}

/** `list` counted by what it names: "zbalc@2 x2, floor8@1". */
const tally = (list: string[]): string => {
  const n = new Map<string, number>();
  for (const s of list) n.set(s, (n.get(s) ?? 0) + 1);
  return [...n].map(([s, c]) => (c > 1 ? `${s} x${c}` : s)).join(", ") || "nothing";
};
const say = (name: string, s: Site, did: string, r: ReturnType<Site["settle"]>): void => console.log(`${name}, ${s.p.n} pieces: ${did}. Fell: ${tally(r.fell)}. Heaps: ${tally(r.heaps)}. Hung: ${tally(r.hung)}. ${s.forms().filter((f) => f !== -1).length} rows left.`);
/** Whether pieces `a` and `b` stand on the same line of the frame's edge, a tile apart. */
const beside = (s: Site, a: number, b: number): boolean => {
  const { u0, u1, v0, v1 } = s.p;
  return (v0[a] === v0[b] && v1[a] === v1[b] && v0[a] === v1[a] && Math.abs(u0[a]! - u0[b]!) === 2) || (u0[a] === u0[b] && u1[a] === u1[b] && u0[a] === u1[a] && Math.abs(v0[a]! - v0[b]!) === 2);
};

test.skipIf(!there)("a house with a wall bay opened keeps its roof", async () => {
  const s = site(await server(), 128674866296464);
  const { p } = s;
  // Every piece of one bay of the front wall: what stands on the frame's front edge within the first tile.
  const bay = Array.from({ length: p.n }, (_, k) => k).filter((k) => p.level[k] === 0 && s.family[k] !== "slab" && s.family[k] !== "none" && p.v0[k] === 0 && p.v1[k] === 0 && p.u1[k]! <= 2);
  expect(bay.length).toBeGreaterThan(0);
  const was = s.forms();
  for (const k of bay) s.open(k);
  const r = s.settle(was);
  say("House", s, `opened ${tally(bay.map((k) => s.shape[k]!))} of its front wall`, r);
  expect([r.fell.length - bay.filter((k) => s.form(k) === -1).length, r.hung.length]).toEqual([0, 0]);
  // Its roof stands whole.
  for (let k = 0; k < p.n; k++) if (s.family[k] === "roof" || (s.family[k] === "slab" && p.level[k]! > 0)) expect(s.form(k)).toBe(FORM_WHOLE);
});

test.skipIf(!there)("a shop row with a storefront breached, then opened, loses nothing", async () => {
  const s = site(await server(), 17538160110268);
  const store = s.shape.indexOf("zstore");
  const was = s.forms();
  s.strike(store);
  expect([FORM_BREACH_A, FORM_BREACH_B]).toContain(s.form(store));
  expect(s.h.host.cityCollapse.waiting).toBe(0);
  // Its half piers bear when it is opened too.
  s.open(store);
  const r = s.settle(was);
  say("Shop row", s, "a storefront breached, then opened", r);
  expect([s.form(store), r.fell.length, r.heaps.length, r.hung.length]).toEqual([FORM_OPEN, 0, 0, 0]);
});

test.skipIf(!there)("flats lose their upper floors when too few ground walls carry them", async () => {
  const id = 93877552490725;
  const s = site(await server(), id);
  const { p } = s;
  const lobbies = Array.from({ length: p.n }, (_, k) => k).filter((k) => s.shape[k] === "zlobby" && p.level[k] === 0);
  const pair = lobbies.flatMap((a) => lobbies.filter((b) => b > a && beside(s, a, b)).map((b) => [a, b] as const))[0]!;
  expect(pair).toBeDefined();
  const was = s.forms();
  // One rocket's worth breaches a bay and drops nothing.
  s.strike(pair[0]);
  expect(s.h.host.cityCollapse.waiting).toBe(0);
  for (const k of pair) s.open(k);
  const r = s.settle(was);
  say("Flats", s, "two neighbouring ground bays opened", r);
  // Each slab over them is held by the stair beside it or by its other wall, so the balconies ride slabs that stand.
  expect([r.fell.length, r.heaps.length, r.hung.length]).toEqual([0, 0, 0]);
  const walls = Array.from({ length: p.n }, (_, k) => k).filter((k) => s.family[k] === "wall" && p.level[k] === 0);
  for (const k of walls) s.open(k);
  const beforeCollapse = s.forms(), { reg, structs } = s.h.world, rules = s.h.host.rules;
  const share = rules.num("CityCollapseStoreyShare");
  let standing = 0;
  for (let k = 0; k < p.n; k++) {
    const ref = p.ref[k]!, kind = structs.chunks[ref >>> 16]!.kind[ref & 65535]!;
    if (p.level[k] === 0 && carrying(reg, kind)) standing += p.post[k]!;
  }
  expect(standing).toBeGreaterThan(0);
  expect(standing).toBeLessThan(p.posts[0]! * share);
  const all = s.settle(beforeCollapse);
  say("Flats", s, `opened all ground walls, leaving ${standing.toFixed(1)} of ${p.posts[0]!.toFixed(1)} m of supports`, all);
  expect(all.hung).toHaveLength(0);
  expect(all.fell.concat(all.heaps).filter((n) => n.startsWith("zbalc")).length).toBeGreaterThanOrEqual(2);
  const floors = s.forms().filter((_, k) => p.level[k]! > 0 && s.family[k] === "slab");
  expect(floors.length).toBeGreaterThan(0);
  for (const form of floors) expect(form).toBe(-1);
  for (let k = 0; k < p.n; k++) if (s.shape[k] === "flight" || s.shape[k] === "landing") expect(s.form(k)).toBe(FORM_WHOLE);

  // The same building and damage still produce a local collapse when only individual supports count.
  s.h.host.cityRegrow.heal(id);
  expect(s.forms()).toEqual(was);
  expect(rules.assign("CityCollapseStoreyShare", "0", "console")).toBe("");
  try {
    for (const k of walls) s.open(k);
    const local = s.settle(s.forms());
    expect(local.hung.some((name) => name.startsWith("floor"))).toBe(true);
    expect(local.fell.concat(local.heaps).filter((n) => n.startsWith("zbalc")).length).toBeGreaterThanOrEqual(2);
    expect(s.forms().some((f, k) => s.family[k] === "slab" && p.level[k]! > 0 && f === FORM_WHOLE)).toBe(true);
  } finally {
    rules.assign("CityCollapseStoreyShare", String(share), "console");
  }
});

test.skipIf(!there)("a tower with its ground piers cut to stubs keeps its stairs, its walls and its shell", async () => {
  const s = site(await server(), 236033759920956);
  const { p } = s;
  const piers = Array.from({ length: p.n }, (_, k) => k).filter((k) => s.family[k] === "pier" && p.level[k] === 0);
  const was = s.forms();
  for (const k of piers) s.open(k);
  const began = s.h.world.tick;
  const r = s.settle(was);
  say("Tower", s, `its ${piers.length} ground piers cut to stubs`, { ...r, other: [] });
  console.log(`Tower: settled in ${s.h.world.tick - began} ticks`);
  expect(piers.map((k) => s.form(k))).toEqual(piers.map(() => FORM_OPEN));
  // Slabs they held hang or fall, with what rode them, and nothing else.
  expect(r.hung.length + r.fell.length).toBeGreaterThan(0);
  for (let k = 0; k < p.n; k++) {
    if (s.shape[k] === "flight" || s.shape[k] === "landing" || s.family[k] === "shell" || s.family[k] === "curtain" || s.family[k] === "wall") expect(s.form(k)).toBe(was[k]!);
  }
});

test.skipIf(!there)("a shed with a wall bay cut loses nothing", async () => {
  const s = site(await server(), 155040841085572);
  const { p } = s;
  const clad = Array.from({ length: p.n }, (_, k) => k).filter((k) => s.shape[k] === "zclad").sort((a, b) => p.level[a]! - p.level[b]!)[0]!;
  const was = s.forms();
  s.strike(clad);
  const r = s.settle(was);
  say("Shed", s, `a ${s.shape[clad]} bay on level ${p.level[clad]} breached in one half`, r);
  expect([[FORM_BREACH_A, FORM_BREACH_B].includes(s.form(clad)), r.fell.length, r.heaps.length, r.hung.length]).toEqual([true, 0, 0, 0]);
  // Opened whole it carries nothing, and the cladding that stood on it comes down.
  s.open(clad);
  const more = s.settle(s.forms());
  say("Shed", s, "the same bay opened whole", more);
});

test.skipIf(!there)("a garage with a deck slab holed drops nothing", async () => {
  const s = site(await server(), 43396709440011);
  const { p } = s;
  const slab = Array.from({ length: p.n }, (_, k) => k).find((k) => s.shape[k] === "floor8" && p.level[k] === 2)!;
  const was = s.forms();
  s.strike(slab);
  const r = s.settle(was);
  say("Garage", s, "a deck slab on level 2 holed in one half", r);
  expect([[FORM_BREACH_A, FORM_BREACH_B].includes(s.form(slab)), r.fell.length, r.heaps.length, r.hung.length]).toEqual([true, 0, 0, 0]);
  s.open(slab);
  const more = s.settle(s.forms());
  say("Garage", s, "the same slab opened whole", more);
});
