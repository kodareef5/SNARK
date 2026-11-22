// The station panel (planning/reference/stations-plan.md, M9 and S4): its fire's line and button, lanes, a paused job, the
// recipes in pages with make 1, 5, 10 and all and what each lacks, the blueprints in the station, and its place beside the
// inventory on every window shape, alone on a phone's. Built on a test pack's lit station, as the forge and fabricator will be.
import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { InventoryScreen, KEY_INV_PANEL, KEY_OPEN_PANEL } from "../../client/core/ui/inventory.ts";
import { K_TEXT, UiFrame, textWidth } from "../../client/core/ui/nodes.ts";
import {
  KEY_STATION_FIRE,
  KEY_STATION_JOB,
  KEY_STATION_LANE,
  KEY_STATION_LIGHT,
  KEY_STATION_NONE,
  KEY_STATION_PAGE,
  KEY_STATION_PANEL,
  KEY_STATION_RECIPE,
  KEY_STATION_SLOTS,
  KEY_STATION_VIEW,
  MAKE_COUNTS,
  RECIPE_KEYS,
  RECIPE_MAKE,
  RECIPE_PICTURE,
  RECIPE_STATUS,
  StationPanel,
  clockWords,
  stationRecipes,
} from "../../client/core/ui/station.ts";
import { CORE_PACK } from "../../content/core.ts";
import { compilePacks, type ContentPack } from "../../shared/content/packs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import * as P from "../../shared/net/protocol.ts";
import { FLAG_BLUEPRINT, Inventory, blueprintCost } from "../../shared/sim/items.ts";
import { NO_PIN, STRUCT_LIGHT, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const ASPECTS: [string, number][] = [["4:3", 4 / 3], ["16:9", 16 / 9], ["21:9", 21 / 9], ["phone upright", 9 / 16]];

/**
 * A test oven that lights, burning only sparkpowder 2 s a piece (S0's), and what is made at it: a loaf, a cake that needs
 * level 60, a crumb the fire makes by itself, and twenty-seven dishes, so its recipes take three pages. The registry lists
 * content by id, so the ids begin with the order the rows come in.
 */
/** The id of the kth dish. */
const dish = (k: number): string => `test:d_${String(k).padStart(2, "0")}dish${k}`;

function ovenPack(more: Record<string, unknown> = {}): ContentPack {
  const station = (id: string, lit: boolean) => ({ id, type: "structure", class: "station", mesh: "box", color: 4, half: [0.5, 0.5, 0.5], hp: 1000, slots: 30, lights: lit ? "test:oven" : "test:oven_lit", ...(lit ? { lit: true } : {}), burns: [{ item: "core:sparkpowder", seconds: 2 }], ...more });
  const made = (name: string, needs: [string, number][], craft: Record<string, unknown> = {}) => [
    { id: `test:${name}`, type: "item", class: "resource", stack: 100, label: name.replace(/^[a-z]_(\d\d)?/, ""), craft: { needs: needs.map(([item, count]) => ({ item: `core:${item}`, count })), seconds: 1, xp: 1, at: "test:oven", ...craft } },
    ...(craft.fired ? [] : [{ id: `test:engram-${name}`, type: "engram", label: name, level: 1, cost: 0, item: `test:${name}` }]),
  ];
  return {
    name: "test",
    requires: ["core"],
    defs: [
      station("test:oven", false),
      station("test:oven_lit", true),
      ...made("a_loaf", [["berry", 2]]),
      ...made("b_cake", [["berry", 1]], { level: 60 }),
      ...made("c_crumb", [["berry", 3]], { fired: true }),
      ...Array.from({ length: 27 }, (_, k) => made(dish(k).slice(5), [["stone", 1], ["fiber", k + 1]])).flat(),
    ],
  } as ContentPack;
}
const reg = compilePacks([CORE_PACK, ovenPack()]).registry!;
const id = (r: Registry, name: string): number => r.index.get(name.includes(":") ? name : `core:${name}`)!;
const [unlit, lit, loaf, crumb] = ["test:oven", "test:oven_lit", "test:a_loaf", "test:c_crumb"].map((n) => id(reg, n)) as [number, number, number, number];

/** Just enough of a session for the inventory and the panel, with the oven open. It records what was sent. */
function standIn(r: Registry, slots: Inventory, station: Partial<NonNullable<ClientSession["station"]>> = {}, known: string[] = ["test:engram-a_loaf", "test:engram-b_cake"]) {
  const sent: { op: number; bytes: Uint8Array }[] = [];
  const own = new Inventory(40);
  const session = {
    inventory: own,
    held: 0,
    serverTick: 3000,
    open: { name: "Oven", inventory: slots },
    station: { kind: id(r, "test:oven"), ref: 0x30005, out: 0, lanes: [], jobs: [], ...station },
    subject: null,
    progress: { xp: 0, level: 30, statPoints: 0, engramPoints: 0, engrams: known.map((k) => id(r, k)), jobs: [], version: 0 },
    command(op: number, args?: (w: BitWriter) => void): number {
      const w = new BitWriter(32);
      args?.(w);
      sent.push({ op, bytes: w.bytes().slice() });
      return sent.length;
    },
  } as unknown as ClientSession;
  return { session, sent };
}

/** The oven's panel alone, at 16:9, beside a column at the middle. */
function panelOf(session: ClientSession, r = reg, panel = new StationPanel()): { f: UiFrame; panel: StationPanel } {
  const f = new UiFrame();
  f.begin(16 / 9);
  panel.build(f, session, r, 860, 80);
  return { f, panel };
}
const row = (n: number, part = 0): number => KEY_STATION_RECIPE + n * RECIPE_KEYS + part;
const text = (f: UiFrame, key: number): string | undefined => f.find(key)?.text;

test("seconds read as a clock", () => {
  expect([0, 0.2, 45, 59.5, 60, 200, 3725].map(clockWords)).toEqual(["0 s", "1 s", "45 s", "1:00", "1:00", "3:20", "1:02:05"]);
});

test("each recipe says whether and how many the slots make; one that cannot be made is greyed with why; make 1, 5, 10 and all ask for that many, all at most 100", () => {
  const slots = new Inventory(30);
  slots.set(0, id(reg, "berry"), 9, 0, 0, 0);
  const { session, sent } = standIn(reg, slots);
  const { f, panel } = panelOf(session);
  // Content order: the loaf (known, 4 from 9 berries), the cake (known, level 60), the crumb (the fire's), then the dishes.
  expect([text(f, row(0)), text(f, row(0, RECIPE_STATUS)), text(f, row(1, RECIPE_STATUS)), text(f, row(2)), text(f, row(2, RECIPE_STATUS)), text(f, row(3, RECIPE_STATUS))]).toEqual([
    "loaf: 2 berry",
    "can make 4",
    "needs level 60",
    "crumb: 3 berry",
    "made by the fire while it burns",
    "engram not known",
  ]);
  // Four from the loaf's slots: 1 and all are pressed, 5 and 10 are greyed. The crumb has no buttons: nobody makes it.
  expect([0, 1, 2, 3].map((b) => f.find(row(0, RECIPE_MAKE + b))!.interactive)).toEqual([true, false, false, true]);
  expect([0, 1, 2, 3].map((b) => f.find(row(1, RECIPE_MAKE + b))!.interactive)).toEqual([false, false, false, false]);
  expect([f.find(row(2, RECIPE_MAKE)), f.find(row(0))!.alpha, f.find(row(1))!.alpha < 1]).toEqual([null, 1, true]);
  const asked = (): [number, number, number][] => sent.splice(0).map((s) => {
    const r = new BitReader(s.bytes);
    return [s.op, r.u16(), r.u8()];
  });
  for (const b of [0, 1, 2, 3]) panel.click(row(0, RECIPE_MAKE + b), session, reg);
  panel.click(row(1, RECIPE_MAKE), session, reg);
  expect(asked()).toEqual([[P.CMD_CRAFT_AT, loaf, 1], [P.CMD_CRAFT_AT, loaf, 4]]);
  // What one lacks is named; with 300 berries all asks for 100 (one job's most), and ten for ten.
  slots.set(0, id(reg, "berry"), 1, 0, 0, 0);
  panelOf(session, reg, panel);
  expect(text(panelOf(session, reg, panel).f, row(0, RECIPE_STATUS))).toBe("lacks 1 berry");
  slots.set(0, id(reg, "berry"), 100, 0, 0, 0);
  slots.set(1, id(reg, "berry"), 100, 0, 0, 0);
  slots.set(2, id(reg, "berry"), 100, 0, 0, 0);
  const many = panelOf(session, reg, panel).f;
  expect(text(many, row(0, RECIPE_STATUS))).toBe("can make 100 a job");
  panel.click(row(0, RECIPE_MAKE + 3), session, reg);
  panel.click(row(0, RECIPE_MAKE + 2), session, reg);
  expect(asked()).toEqual([[P.CMD_CRAFT_AT, loaf, 100], [P.CMD_CRAFT_AT, loaf, 10]]);
  expect(MAKE_COUNTS).toEqual([1, 5, 10]);
  // Eight jobs fill the queue, so nothing more is asked for.
  const job = { item: loaf, left: 1, doneAt: 0, rest: 0 };
  session.station!.jobs = Array.from({ length: 8 }, () => ({ ...job }));
  expect(text(panelOf(session, reg, panel).f, row(0, RECIPE_STATUS))).toBe("the queue is full");
  panel.click(row(0, RECIPE_MAKE), session, reg);
  expect(sent).toEqual([]);
});

test("the fire's line says how long it burns from the out tick, and its button lights it or puts it out with the station's ref, greyed with nothing in it to burn", () => {
  const slots = new Inventory(30);
  slots.set(0, id(reg, "wood"), 10, 0, 0, 0);
  const { session, sent } = standIn(reg, slots);
  let { f, panel } = panelOf(session);
  // Wood is no fuel of the oven's, which burns only sparkpowder.
  expect([text(f, KEY_STATION_FIRE), text(f, KEY_STATION_LIGHT), f.find(KEY_STATION_LIGHT)!.interactive]).toEqual(["out: no sparkpowder in it", "Light", false]);
  panel.click(KEY_STATION_LIGHT, session, reg);
  expect(sent).toEqual([]);
  slots.set(1, id(reg, "sparkpowder"), 2, 0, 0, 0);
  ({ f } = panelOf(session, reg, panel));
  expect([text(f, KEY_STATION_FIRE), f.find(KEY_STATION_LIGHT)!.interactive]).toEqual(["out", true]);
  panel.click(KEY_STATION_LIGHT, session, reg);
  const r = new BitReader(sent[0]!.bytes);
  expect([sent[0]!.op, r.u32(), r.u8()]).toEqual([P.CMD_STRUCT, 0x30005, STRUCT_LIGHT]);
  // Lit, it burns until the out tick, and the crumb is made by the fire.
  session.station!.kind = lit;
  session.station!.out = 3000 + 200 * TICK_RATE;
  slots.set(2, id(reg, "berry"), 3, 0, 0, 0);
  ({ f } = panelOf(session, reg, panel));
  expect([text(f, KEY_STATION_FIRE), text(f, KEY_STATION_LIGHT), text(f, row(2, RECIPE_STATUS)), f.find(row(2))!.alpha]).toEqual(["burns for 3:20", "Put out", "the fire makes it by itself", 1]);
  // A station with no fire has no line and no button; the campfire, which makes nothing, says it cooks.
  const core = coreRegistry();
  const mortar = standIn(core, new Inventory(24), {}, []).session;
  mortar.station!.kind = id(core, "mortar");
  const m = panelOf(mortar, core).f;
  // Sparkpowder's row is its place among what the mortar makes (the narcotic and cementing paste too, since S6).
  const spark = stationRecipes(core, id(core, "mortar")).indexOf(id(core, "sparkpowder"));
  expect([m.find(KEY_STATION_FIRE), m.find(KEY_STATION_LIGHT), text(m, row(spark))]).toEqual([null, null, "sparkpowder x2: 2 flint, 1 stone"]);
  const fire = standIn(core, new Inventory(3), {}, []).session;
  fire.station!.kind = id(core, "campfire");
  const c = panelOf(fire, core).f;
  expect([text(c, KEY_STATION_FIRE), text(c, KEY_STATION_NONE)]).toEqual(["out: no fuel in it", "nothing is made here; it cooks what lies in it"]);
});

test("a lane says when its unit is done or what it waits for, and a paused job that it needs fuel", () => {
  const slots = new Inventory(30);
  slots.set(0, id(reg, "berry"), 1, 0, 0, 0);
  slots.set(1, id(reg, "sparkpowder"), 1, 0, 0, 0);
  const lane = (doneAt: number) => [{ item: crumb, doneAt }];
  const { session } = standIn(reg, slots, { kind: lit, out: 9000, lanes: lane(3000 + 12 * TICK_RATE), jobs: [{ item: loaf, left: 3, doneAt: 3000 + 75 * TICK_RATE, rest: 0 }, { item: loaf, left: 1, doneAt: 0, rest: 0 }] });
  let { f, panel } = panelOf(session);
  expect([text(f, KEY_STATION_LANE), text(f, KEY_STATION_JOB), text(f, KEY_STATION_JOB + 1)]).toEqual(["crumb in 12 s", "making loaf x3, 1:15", "then loaf x1"]);
  session.station!.lanes = lane(0);
  ({ f } = panelOf(session, reg, panel));
  expect(text(f, KEY_STATION_LANE)).toBe("crumb waits for 2 berry");
  // Out, the lane waits for the fire, and the unit under way pauses with its ticks left (S2's Job.rest).
  Object.assign(session.station!, { kind: unlit, out: 0, jobs: [{ item: loaf, left: 3, doneAt: 0, rest: 45 * TICK_RATE }] });
  ({ f } = panelOf(session, reg, panel));
  expect([text(f, KEY_STATION_LANE), text(f, KEY_STATION_JOB)]).toEqual(["crumb waits for the fire", "making loaf x3: needs fuel, 45 s left"]);
  // With no lanes and no jobs, as before S1 and S2, there are no lane lines.
  Object.assign(session.station!, { lanes: [], jobs: [] });
  ({ f, panel } = panelOf(session, reg, panel));
  expect([f.find(KEY_STATION_LANE), text(f, KEY_STATION_JOB)]).toEqual([null, "nothing being made"]);
});

test("a powered station lists its recipes and counts while off, greyed until it is on", () => {
  const r = compilePacks([CORE_PACK, ovenPack({ powered: true })]).registry!;
  const slots = new Inventory(30);
  slots.set(0, id(r, "berry"), 9, 0, 0, 0);
  slots.set(1, id(r, "sparkpowder"), 1, 0, 0, 0);
  const { session, sent } = standIn(r, slots);
  session.station!.kind = id(r, "test:oven");
  const { f, panel } = panelOf(session, r);
  expect([text(f, KEY_STATION_FIRE), text(f, KEY_STATION_LIGHT), text(f, row(0, RECIPE_STATUS)), f.find(row(0, RECIPE_MAKE))!.interactive]).toEqual(["off", "Turn on", "must be on, with fuel", false]);
  panel.click(row(0, RECIPE_MAKE), session, r);
  expect(sent).toEqual([]);
  session.station!.kind = id(r, "test:oven_lit");
  const on = panelOf(session, r, panel).f;
  expect([text(on, KEY_STATION_LIGHT), text(on, row(0, RECIPE_STATUS)), on.find(row(0, RECIPE_MAKE))!.interactive]).toEqual(["Turn off", "can make 4", true]);
});

test("recipes come in pages of twelve, blueprints in the station first, and a blueprint's buttons make from its slot at its quality's cost", () => {
  const slots = new Inventory(30);
  slots.set(0, id(reg, "stone"), 100, 0, 0, 0);
  slots.set(1, id(reg, "fiber"), 100, 0, 0, 0);
  // A journeyman dish0 blueprint in slot 7: a fiber is 3 at that quality.
  slots.set(7, id(reg, dish(0)), 1, 3, 0, 0, FLAG_BLUEPRINT);
  const known = ["test:engram-a_loaf", ...Array.from({ length: 27 }, (_, k) => `test:engram-${dish(k).slice(5)}`)];
  const { session, sent } = standIn(reg, slots, {}, known);
  const { f, panel } = panelOf(session);
  // 1 blueprint and 30 recipes are three pages.
  expect([panel.pages, text(f, KEY_STATION_PAGE + 1), text(f, row(0)), text(f, row(0, RECIPE_STATUS)), text(f, row(1))]).toEqual([3, "page 1 of 3", `journeyman dish0 blueprint: ${blueprintCost(1, 3)} stone, ${blueprintCost(1, 3)} fiber`, `can make ${Math.floor(100 / blueprintCost(1, 3))}`, "loaf: 2 berry"]);
  expect(f.find(row(12))).toBeNull();
  panel.click(row(0, RECIPE_MAKE + 1), session, reg);
  let r = new BitReader(sent[0]!.bytes);
  expect([sent.splice(0)[0]!.op, r.bits(1), r.varint(), r.u8()]).toEqual([P.CMD_CRAFT_BLUEPRINT, P.BOX_OPEN, 7, 5]);
  // The next page starts at the twelfth row: dish8 (the blueprint, the loaf, the cake, the crumb, dish0 to dish7 before it).
  panel.click(KEY_STATION_PAGE + 2, session, reg);
  const second = panelOf(session, reg, panel).f;
  expect([text(second, KEY_STATION_PAGE + 1), text(second, row(0))]).toEqual(["page 2 of 3", "dish8: 1 stone, 9 fiber"]);
  panel.click(row(0, RECIPE_MAKE + 3), session, reg);
  r = new BitReader(sent[0]!.bytes);
  expect([sent[0]!.op, r.u16(), r.u8()]).toEqual([P.CMD_CRAFT_AT, id(reg, dish(8)), 11]);
  // The last page holds the rest; there is no page past it.
  panel.click(KEY_STATION_PAGE + 2, session, reg);
  panel.click(KEY_STATION_PAGE + 2, session, reg);
  const last = panelOf(session, reg, panel).f;
  expect([panel.page, text(last, row(0)), last.find(row(7)), last.find(row(6)) !== null]).toEqual([2, "dish20: 1 stone, 21 fiber", null, true]);
  // Another station opened starts on its first page.
  session.station!.ref = 0x30006;
  panelOf(session, reg, panel);
  expect(panel.page).toBe(0);
});

test("on every window shape the panel sits beside the inventory or, on a phone's, alone in its place: nothing off the canvas, no clipped text, no stacked controls", () => {
  const slots = new Inventory(30);
  for (let s = 0; s < 30; s++) slots.set(s, s % 2 ? id(reg, "berry") : id(reg, "stone"), 100, 0, 0, 0);
  slots.set(29, id(reg, dish(3)), 1, 5, 0, 0, FLAG_BLUEPRINT);
  const eight = Array.from({ length: 8 }, (_, k) => ({ item: id(reg, dish(k)), left: 255, doneAt: k === 0 ? 0 : 0, rest: k === 0 ? 99999 * TICK_RATE : 0 }));
  const lanes = Array.from({ length: 8 }, (_, k) => ({ item: crumb, doneAt: k % 2 ? 0 : 99999 * TICK_RATE }));
  for (const [name, aspect] of ASPECTS) {
    for (const icons of [false, true]) {
      const { session } = standIn(reg, slots, { kind: lit, out: 99999 * TICK_RATE, lanes, jobs: eight });
      const screen = new InventoryScreen();
      const check = (f: UiFrame, where: string): void => {
        const keys = new Set<number>();
        const panel = f.find(KEY_STATION_PANEL)!;
        for (let i = 0; i < f.count; i++) {
          const n = f.nodes[i]!;
          const at = `${where} key=${n.key} "${n.text}"`;
          expect(keys.has(n.key), at).toBe(false);
          keys.add(n.key);
          expect(n.x >= -0.01 && n.y >= -0.01 && n.x + n.w <= f.width + 0.01 && n.y + n.h <= f.height + 0.01, at).toBe(true);
          if (n.kind === K_TEXT) expect(textWidth(n.text, n.style), at).toBeLessThanOrEqual(n.w + 0.01);
          // The panel's nodes lie inside it, and its keys are its own: 2600 to 2799.
          if (n.key > KEY_STATION_PANEL && n.key < 2800 && n.key !== KEY_STATION_VIEW) expect(n.x >= panel.x && n.y >= panel.y && n.x + n.w <= panel.x + panel.w + 0.01 && n.y + n.h <= panel.y + panel.h + 0.01, at).toBe(true);
          for (let j = i + 1; j < f.count; j++) {
            const q = f.nodes[j]!;
            const over = n.x < q.x + q.w && q.x < n.x + n.w && n.y < q.y + q.h && q.y < n.y + n.h;
            if (n.interactive && q.interactive) expect(over, `${at} and ${q.key}`).toBe(false);
            if (n.kind === K_TEXT && q.kind === K_TEXT) expect(over, `${at} and ${q.key} "${q.text}"`).toBe(false);
          }
        }
      };
      const f = new UiFrame();
      if (icons) f.icons = { place: (n) => ((n.image = 1), true) };
      screen.open = true;
      f.begin(aspect);
      screen.build(f, session, reg, null);
      check(f, `${name} icons=${icons}`);
      // The panel shows a page of twelve where the canvas has room for it, with the pager under it.
      const phone = aspect < 1;
      expect([f.find(KEY_OPEN_PANEL) !== null, f.find(KEY_STATION_PANEL) !== null, f.find(KEY_STATION_VIEW) !== null], name).toEqual([true, !phone, phone]);
      if (!phone) expect([f.find(row(0)) !== null, f.find(KEY_STATION_PAGE + 2)!.interactive, f.find(KEY_STATION_PANEL)!.x >= f.find(KEY_OPEN_PANEL)!.x + f.find(KEY_OPEN_PANEL)!.w], name).toEqual([true, true, true]);
      if (!phone) continue;
      // On a phone the button shows the panel alone, in the inventory's place, and its own button goes back to the slots.
      screen.pointer(0, KEY_STATION_VIEW, 0, session);
      f.begin(aspect);
      screen.build(f, session, reg, null);
      check(f, `${name} alone icons=${icons}`);
      expect([f.find(KEY_OPEN_PANEL), f.find(KEY_INV_PANEL), f.find(KEY_STATION_PANEL) !== null, f.find(row(0)) !== null, icons === (f.find(row(0, RECIPE_PICTURE)) !== null)]).toEqual([null, null, true, true, true]);
      screen.pointer(0, KEY_STATION_SLOTS, 0, session);
      f.begin(aspect);
      screen.build(f, session, reg, null);
      expect([f.find(KEY_OPEN_PANEL) !== null, f.find(KEY_STATION_PANEL)]).toEqual([true, null]);
    }
  }
});

/** A Harness on the oven's content with ada joined, cheats on, standing beside a level spot, and the oven placed there. */
function bakery() {
  const h = new Harness({}, 1, 60, { dev: true, startingCreatures: 0 }, reg);
  const s = h.join("ada");
  h.run(400);
  const at = flatGround(h, 30, 30);
  h.say(s, "enablecheats");
  h.say(s, `tp ${at.x + 10} ${at.z + 10}`);
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  const ref = h.world.structs.add(unlit, at.x + 11, at.y + 0.5, at.z + 10, 0, me.team, 1000);
  return { h, s, me, ref };
}

test("through the server: the panel's button lights the oven and its line changes, make asks the oven for a job, and a blueprint in it is made from", () => {
  const { h, s, me, ref } = bakery();
  try {
    const rec = h.host.fixtures.ensure(ref);
    me.engrams.push(id(reg, "test:engram-a_loaf"));
    me.progVersion++;
    h.host.items.mint(rec, id(reg, "sparkpowder"), 2);
    h.host.items.mint(rec, id(reg, "berry"), 9);
    h.host.items.mint(rec, loaf, 1, 2, 0, -1, "", FLAG_BLUEPRINT);
    let code = -1;
    s.onResult = (seq, c) => void (seq !== 0 && (code = c));
    s.command(P.CMD_STRUCT, (w: BitWriter) => (w.u32(ref), w.u8(STRUCT_USE), w.u16(NO_PIN)));
    h.run(300);
    expect([code, s.station?.kind, s.station?.ref]).toEqual([P.RESULT_OK, unlit, ref]);
    const screen = new InventoryScreen();
    const f = new UiFrame();
    const build = (): UiFrame => {
      f.begin(16 / 9);
      screen.build(f, s, s.registry, null);
      return f;
    };
    expect([text(build(), KEY_STATION_FIRE), text(f, KEY_STATION_LIGHT)]).toEqual(["out", "Light"]);
    screen.pointer(0, KEY_STATION_LIGHT, 0, s);
    h.run(300);
    // Lit: the oven is its burning kind, and two pieces of 2 s each burn until 4 s after it was lit.
    expect([code, s.station!.kind, rec.kind, s.station!.out]).toEqual([P.RESULT_OK, lit, lit, rec.fire!.out]);
    expect(text(build(), KEY_STATION_FIRE)).toMatch(/^burns for \d s$/);
    expect(text(f, KEY_STATION_LIGHT)).toBe("Put out");
    // The blueprint (apprentice: 3 berries a loaf) is the first row, then the loaf (2 berries): 4 of them from 9 berries.
    expect([text(f, row(0)), text(f, row(1)), text(f, row(1, RECIPE_STATUS))]).toEqual([`apprentice loaf blueprint: ${blueprintCost(2, 2)} berry`, "loaf: 2 berry", "can make 4"]);
    screen.pointer(0, row(1, RECIPE_MAKE), 0, s);
    h.run(300);
    expect([code, rec.jobs.map((j) => [j.item, j.left, j.bp]), text(build(), KEY_STATION_JOB)]).toEqual([P.RESULT_OK, [[loaf, 1, undefined]], text(f, KEY_STATION_JOB)]);
    h.run(1500);
    // While it burns, the fire makes crumbs by itself from the berries in it, 3 a second (S1's lanes), so it is given more.
    h.host.items.mint(rec, id(reg, "berry"), 9);
    screen.pointer(0, row(0, RECIPE_MAKE), 0, s);
    h.run(300);
    expect([code, rec.jobs.map((j) => [j.item, j.bp])]).toEqual([P.RESULT_OK, [[loaf, 2]]]);
    h.run(2000);
    // It went out with nobody touching it, and the line and button say so.
    expect([s.station!.kind, text(build(), KEY_STATION_FIRE), text(f, KEY_STATION_LIGHT)]).toEqual([unlit, "out: no sparkpowder in it", "Light"]);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("on S2's fabricator: off with no gasoline the button is greyed; turned on from the panel it burns 15:00, polymer is made from its slots, and a unit under way when it is turned off shows as needing fuel", () => {
  const core = coreRegistry();
  const h = new Harness({}, 1, 60, { dev: true, startingCreatures: 0 }, core);
  try {
    const s = h.join("ada");
    h.run(400);
    const at = flatGround(h, 30, 30);
    h.say(s, "enablecheats");
    h.say(s, `tp ${at.x + 10} ${at.z + 10}`);
    h.say(s, "addxp 10000000");
    const me = h.host.records.byPid.get(h.client(s)!.pid)!;
    const [off, on, polymer] = [id(core, "fabricator"), id(core, "fabricator_lit"), id(core, "polymer")];
    const ref = h.world.structs.add(off, at.x + 11, at.y + 0.65, at.z + 10, 0, me.team, 2500);
    const rec = h.host.fixtures.ensure(ref);
    me.engrams.push(id(core, "engram-polymer"));
    me.progVersion++;
    h.host.items.mint(rec, id(core, "obsidian"), 4);
    h.host.items.mint(rec, id(core, "paste"), 4);
    let code = -1;
    s.onResult = (seq, c) => void (seq !== 0 && (code = c));
    s.command(P.CMD_STRUCT, (w: BitWriter) => (w.u32(ref), w.u8(STRUCT_USE), w.u16(NO_PIN)));
    h.run(300);
    const screen = new InventoryScreen();
    const f = new UiFrame();
    const build = (): UiFrame => {
      f.begin(16 / 9);
      screen.build(f, s, s.registry, null);
      return f;
    };
    const rowOf = (item: number): number => {
      for (let n = 0; n < 12; n++) if (f.find(row(n))?.text.startsWith(`${(s.registry.defs[item] as { label?: string }).label}:`)) return n;
      return -1;
    };
    build();
    while (rowOf(polymer) < 0 && f.find(KEY_STATION_PAGE + 2)?.interactive) {
      screen.pointer(0, KEY_STATION_PAGE + 2, 0, s);
      build();
    }
    const p = rowOf(polymer);
    expect(p).toBeGreaterThanOrEqual(0);
    expect([code, text(f, KEY_STATION_FIRE), text(f, KEY_STATION_LIGHT), f.find(KEY_STATION_LIGHT)!.interactive, text(f, row(p, RECIPE_STATUS))]).toEqual([P.RESULT_OK, "off: no gasoline in it", "Turn on", false, "must be on, with fuel"]);
    h.host.items.mint(rec, id(core, "gasoline"), 1);
    h.run(300);
    build();
    expect(f.find(KEY_STATION_LIGHT)!.interactive).toBe(true);
    screen.pointer(0, KEY_STATION_LIGHT, 0, s);
    h.run(300);
    build();
    expect([code, s.station!.kind, text(f, KEY_STATION_LIGHT), text(f, row(p, RECIPE_STATUS))]).toEqual([P.RESULT_OK, on, "Turn off", "can make 2"]);
    expect(text(f, KEY_STATION_FIRE)).toMatch(/^burns for 1[45]:\d\d$/);
    // One polymer asked for, and turned off in the same moment: the unit pauses with its 2 s left, and the gasoline is lost.
    screen.pointer(0, row(p, RECIPE_MAKE), 0, s);
    screen.pointer(0, KEY_STATION_LIGHT, 0, s);
    h.run(300);
    build();
    expect([s.station!.kind, rec.inv!.total(id(core, "gasoline")), text(f, KEY_STATION_FIRE), text(f, KEY_STATION_JOB)]).toEqual([off, 0, "off: no gasoline in it", "making polymer x1: needs fuel, 2 s left"]);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});
