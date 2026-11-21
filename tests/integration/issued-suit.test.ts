// The Meridian set a survivor comes to life in (bDisableDefaultMapItemSets, D957): worn new at every spawn, shown as worn on
// its own screens and to others, kept by its survivor alone, through a restart, and left behind when it travels.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import { HudModel, updateHud } from "../../client/core/hud.ts";
import { DRAW_NEAR, DRAW_SKINNED } from "../../client/core/render/packet.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { KEY_JET_FUEL, buildHud } from "../../client/core/ui/hud.ts";
import { KEY_INV_INFO, KEY_INV_SLOT } from "../../client/core/ui/inventory.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { TICKET_SECONDS } from "../../server/cluster/cluster.ts";
import { ISSUED_STAYS } from "../../server/own.ts";
import { loadConfig } from "../../server/settings/config.ts";
import type { Rules } from "../../server/settings/rules.ts";
import { suitPieces } from "../../server/suit.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_DROP, CMD_MOVE, CMD_RESPAWN, CMD_USE, RESULT_DENIED, RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_USE, JET_FULL_SUIT } from "../../shared/sim/character.ts";
import { GEAR_COUNT, GEAR_WORN } from "../../shared/sim/entities.ts";
import { ARMOR_SLOTS, FLAG_ISSUED, type Inventory } from "../../shared/sim/items.ts";
import { TestCluster, beat, keyAt, rec, rise, travel } from "../fixtures/cluster.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { Harness, asShipped } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
/** Head, torso, hands, legs and feet. */
const SUIT = ["hat", "shirt", "gloves", "pants", "boots"].map((piece) => id(`meridian_${piece}`));
const dir = mkdtempSync(join(tmpdir(), "snark-suit-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Rules from lines of Game.ini's section, as the server ships them otherwise. */
function shipped(game: string[] = []): Rules {
  const made = loadConfig({ game: ["[/script/shootergame.shootergamemode]", ...game].join("\n") });
  expect([made.report.refused, made.report.unknown]).toEqual([[], []]);
  return asShipped(made.rules);
}

const worn = (inv: Inventory): number[] => [...inv.item.slice(inv.armor, inv.armor + ARMOR_SLOTS)];

/** A survivor new to a server as it comes. send() sends one command and returns its result code, or -1 if none came. */
function setup(config = shipped(), dbPath?: string) {
  const h = new Harness({}, 1, 60, { config, ...(dbPath ? { dbPath } : {}) });
  const s = h.join("ada");
  h.run(500);
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  const codes = new Map<number, number>();
  s.onResult = (seq, code) => codes.set(seq, code);
  const send = (op: number, args: (w: BitWriter) => void): number => {
    const seq = s.command(op, args);
    h.run(150);
    return codes.get(seq) ?? -1;
  };
  const move = (fromBox: number, from: number, toBox: number, to: number, item: number): number =>
    send(CMD_MOVE, (w) => (w.bits(fromBox, 1), w.varint(from), w.bits(toBox, 1), w.varint(to), w.u16(0), w.u16(item)));
  return { h, s, me, send, move, inv: (): Inventory => h.host.items.inv(me) };
}

test("the set is the five Meridian pieces, one for each place a piece is worn", () => {
  expect(suitPieces(reg)).toEqual(SUIT);
});

test("a new survivor comes to life in the whole Meridian set, new; its inventory, its HUD and everyone else see it", () => {
  const { h, s, inv } = setup();
  const own = inv();
  expect(worn(own)).toEqual(SUIT);
  for (let k = 0; k < ARMOR_SLOTS; k++) {
    const slot = own.armor + k;
    expect([own.count[slot], own.quality[slot], own.dur[slot], own.flags[slot]]).toEqual([1, 0, h.host.items.maxDur(SUIT[k]!, 0), FLAG_ISSUED]);
  }
  expect(own.dur[own.armor + 1]).toBe(300);
  // Its client holds the same pieces in the same places, which its own body is drawn from, without the server's mark.
  const mirror = s.inventory!;
  expect([worn(mirror), [...mirror.flags.slice(mirror.armor, mirror.armor + ARMOR_SLOTS)], [...mirror.dur.slice(mirror.armor, mirror.armor + ARMOR_SLOTS)]])
    .toEqual([SUIT, [0, 0, 0, 0, 0], [...own.dur.slice(own.armor, own.armor + ARMOR_SLOTS)]]);
  // Its body flies on the suit from the first frame, and the HUD shows the gauge of a full one.
  expect(s.own.jetGear).toBe(JET_FULL_SUIT);
  const hud = new HudModel(), frame = new UiFrame();
  updateHud(hud, s, new RemoteSample(), 60);
  frame.begin(16 / 9);
  buildHud(frame, hud);
  expect([frame.find(KEY_JET_FUEL + 1)?.text, frame.find(KEY_JET_FUEL + 4)?.text]).toEqual([expect.stringContaining("10.0 s"), "Full suit · 2× recharge"]);
  // Another sees all five pieces on it, and came to life in a set of its own: two in the world, and the books balance.
  const bo = h.join("bo");
  h.run(400);
  const seen = new RemoteSample();
  bo.sampleRemote(seen);
  const i = seen.id.subarray(0, seen.count).indexOf(h.ent(s));
  expect(i).toBeGreaterThanOrEqual(0);
  expect([...seen.gear.slice(i * GEAR_COUNT + GEAR_WORN, i * GEAR_COUNT + GEAR_WORN + ARMOR_SLOTS)]).toEqual(SUIT);
  expect(SUIT.map((piece) => h.host.items.total(piece))).toEqual([2, 2, 2, 2, 2]);
  expect(h.host.items.audit()).toEqual([]);

  // A server whose Game.ini says bDisableDefaultMapItemSets=True dresses nobody.
  const bare = setup(shipped(["bDisableDefaultMapItemSets=True"]));
  expect([worn(bare.inv()), bare.s.own.jetGear]).toEqual([[0, 0, 0, 0, 0], 0]);
});

artTest("from its first frames a new survivor is drawn in the suit, in first person and to others, and its inventory screen and HUD show it", () => {
  const h = new Harness({}, 1, 60, { config: shipped() });
  const pack = corePack();
  const app = new App(h.join("ada", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  const bo = new App(h.join("bo", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  // Both have chosen the eye's own view (a survivor rises seen from behind unless it chose so), so each draws only the other whole.
  app.ui.settings.thirdPerson = bo.ui.settings.thirdPerson = false;
  let mine = app.frame(0, 1280, 720), seen = bo.frame(0, 1280, 720);
  const run = (ms: number): void => h.run(ms, (now) => ((mine = app.frame(now, 1280, 720)), (seen = bo.frame(now, 1280, 720))));
  run(800);
  const s = app.session;
  const ids = (p: typeof mine, near: boolean): string[] =>
    [...p!.drawMesh.subarray(0, p!.drawCount)].filter((_, d) => (p!.drawFlags[d]! & (DRAW_SKINNED | DRAW_NEAR)) === (near ? DRAW_SKINNED | DRAW_NEAR : DRAW_SKINNED)).map((m) => pack.header.meshes[m]!.id);
  // In first person the helmet is not drawn, as the head is not.
  expect([...new Set(ids(mine, true))].sort()).toEqual(["feet", "hands", "legs", "torso"].map((slot) => "core:human_m/armor/meridian/" + slot));
  // Seen by another, who faces it from four metres, all five pieces are drawn in place of the body's own.
  const ents = h.world.ents, e = h.ent(s), eb = h.ent(bo.session);
  ents.x[e] = ents.x[eb]!;
  ents.z[e] = ents.z[eb]! + 4;
  ents.y[e] = h.world.hf.heightAt(ents.x[e]!, ents.z[e]!);
  bo.controls.yaw = 0;
  run(500);
  expect(ids(seen, false).filter((m) => m.startsWith("core:human_m/")).sort()).toEqual(["feet", "hands", "head", "legs", "torso"].map((slot) => "core:human_m/armor/meridian/" + slot));
  // The HUD shows the full suit's gauge, and the inventory screen each piece where it is worn, at its full durability.
  const f = app.ui.frame;
  expect(f.find(KEY_JET_FUEL + 4)?.text).toBe("Full suit · 2× recharge");
  app.key("KeyI", true);
  run(100);
  const inv = s.inventory!;
  for (let k = 0; k < ARMOR_SLOTS; k++) expect(f.find(KEY_INV_SLOT + (inv.armor + k) * 3 + 1)).not.toBeNull();
  app.pointer(2, KEY_INV_SLOT + (inv.armor + 1) * 3, 0, 0, 0);
  run(34);
  expect(f.find(KEY_INV_INFO)!.text).toBe("primitive Meridian flight cuirass  300/300");
});

test("the suit stays with its survivor: not dropped, stored, swapped out, given or spent; it comes off and goes on again", () => {
  const { h, s, me, send, move, inv } = setup();
  const items = h.host.items;
  const hat = SUIT[0]!;
  const head = inv().armor;
  const drop = (slot: number, item: number): number => send(CMD_DROP, (w) => (w.varint(slot), w.u16(0), w.u16(item)));
  expect(drop(head, hat)).toBe(RESULT_DENIED);
  expect(s.log.at(-1)?.text).toBe(ISSUED_STAYS);
  // Off into the bag and on again, as any piece; from the bag it is not dropped either.
  expect(move(BOX_SELF, head, BOX_SELF, 3, hat)).toBe(RESULT_OK);
  expect([inv().item[head], inv().item[3], inv().flags[3]]).toEqual([0, hat, FLAG_ISSUED]);
  expect(drop(3, hat)).toBe(RESULT_DENIED);
  expect(send(CMD_USE, (w) => (w.varint(3), w.u16(hat)))).toBe(RESULT_OK);
  expect(inv().item[head]).toBe(hat);

  // A stone and a flak hat dropped lie in one bag, which she opens.
  items.mint(me, id("stone"), 5);
  items.mint(me, id("flak_hat"), 1);
  h.run(100);
  expect(drop(inv().item.indexOf(id("stone")), id("stone"))).toBe(RESULT_OK);
  expect(drop(inv().item.indexOf(id("flak_hat")), id("flak_hat"))).toBe(RESULT_OK);
  const bag = [...h.host.records.byPid.values()].find((r) => r.name === "bag")!;
  h.say(s, `tp ${(bag.x - 1.2).toFixed(2)} ${bag.z.toFixed(2)}`);
  const p = h.pilots[0]!;
  p.yaw = Math.PI / 2;
  p.pitch = -0.9;
  h.run(300);
  p.buttons = BTN_USE;
  h.run(100);
  p.buttons = 0;
  h.run(300);
  expect(s.open?.name).toBe("bag");
  const flak = bag.inv!.item.indexOf(id("flak_hat"));
  // Not put in it, and not swapped out of the head for the flak hat in it.
  expect(move(BOX_SELF, head, BOX_OPEN, bag.inv!.item.indexOf(0), hat)).toBe(RESULT_DENIED);
  expect(move(BOX_OPEN, flak, BOX_SELF, head, id("flak_hat"))).toBe(RESULT_DENIED);
  expect([inv().item[head], bag.inv!.item[flak], bag.inv!.item.includes(hat)]).toEqual([hat, id("flak_hat"), false]);
  // Taken off first, the flak hat goes on in its place, and the Meridian one waits in her bag.
  expect(move(BOX_SELF, head, BOX_SELF, 3, hat)).toBe(RESULT_OK);
  expect(move(BOX_OPEN, flak, BOX_SELF, head, id("flak_hat"))).toBe(RESULT_OK);
  expect([inv().item[head], inv().item[3]]).toEqual([id("flak_hat"), hat]);

  // Nothing on the server takes one either: it is not given, moved to another, or spent as an ingredient.
  const other = h.host.records.create(id("bag"), "elsewhere");
  expect([items.give(me, other, hat, 1), items.move(me, 3, other, 0, 0), inv().total(hat), items.burnItem(me, hat, 1)]).toEqual([false, 0, 0, false]);
  h.host.records.delete(other.pid);
  expect(SUIT.map((piece) => items.total(piece))).toEqual([1, 1, 1, 1, 1]);
  expect(items.audit()).toEqual([]);
});

test("a world saved before the suit was given loads as it was: its survivor is dressed at its next rise, and a suit worn stays issued through a restart", () => {
  const db = join(dir, "before.db");
  // Saved by a server that gave no suit, as every one did before.
  const before = setup(shipped(["bDisableDefaultMapItemSets=True"]), db);
  before.h.host.items.mint(before.me, id("stone"), 7);
  before.h.run(200);
  before.s.close();
  before.h.run(200);
  before.h.host.shutdown();

  const after = setup(shipped(), db);
  expect([after.me.pid, worn(after.inv()), after.inv().total(id("stone"))]).toEqual([before.me.pid, [0, 0, 0, 0, 0], 7]);
  expect(after.h.say(after.s, "suicide")).toEqual(["You were killed."]);
  expect(after.send(CMD_RESPAWN, (w) => (w.u8(0), w.u8(after.s.placesList)))).toBe(RESULT_OK);
  expect(worn(after.inv())).toEqual(SUIT);
  after.s.close();
  after.h.run(200);
  after.h.host.shutdown();

  // Back after a restart, it wears the same set, still its own, and is not dressed again.
  const again = setup(shipped(), db);
  const inv = again.inv();
  expect([worn(inv), [...inv.flags.slice(inv.armor, inv.armor + ARMOR_SLOTS)]]).toEqual([SUIT, [FLAG_ISSUED, FLAG_ISSUED, FLAG_ISSUED, FLAG_ISSUED, FLAG_ISSUED]]);
  expect(again.send(CMD_DROP, (w) => (w.varint(inv.armor), w.u16(0), w.u16(SUIT[0]!)))).toBe(RESULT_DENIED);
  expect([SUIT.map((piece) => again.h.host.items.minted[piece]), again.h.host.items.audit()]).toEqual([[1, 1, 1, 1, 1], []]);
  again.h.host.shutdown();
});

test("the suit does not travel: she leaves in it where nothing may be carried, it is not sent, and she rises on the next server in its own", () => {
  const t = new TestCluster();
  try {
    const clock = { ms: Date.now() };
    const a = t.server("Island", "suit", clock, { shipped: true, argv: ["?PreventUploadItems=True"] });
    const b = t.server("Miami", "suit", clock, { shipped: true });
    beat(a, b);
    const ada: ClientSession = a.h.join("ada", {}, { key: keyAt("ada", a.world) });
    a.h.run(300);
    expect(worn(a.h.host.items.inv(rec(a, "ada")!))).toEqual(SUIT);
    const ticket = travel(a, ada, b.world);
    expect(ticket).toBeInstanceOf(Uint8Array);
    // The island burned it as she left: none was sent, and none is left there.
    expect(SUIT.map((piece) => [a.h.host.items.sent[piece], a.h.host.items.burned[piece], a.h.host.items.total(piece)])).toEqual(SUIT.map(() => [0, 1, 0]));
    clock.ms += 30_000;
    beat(a, b);
    const there = b.h.join("ada", {}, { key: keyAt("ada", b.world), ticket: ticket as Uint8Array });
    b.h.run(400);
    rise(b, there);
    expect(worn(b.h.host.items.inv(rec(b, "ada")!))).toEqual(SUIT);
    expect(SUIT.map((piece) => [b.h.host.items.received[piece], b.h.host.items.minted[piece]])).toEqual(SUIT.map(() => [0, 1]));
    expect(t.audit(a, b)).toEqual([]);

    // One whose ticket runs out unused never left: it is back where it stood, in a set as it was.
    const bo: ClientSession = a.h.join("bo", {}, { key: keyAt("bo", a.world) });
    a.h.run(300);
    expect(travel(a, bo, b.world)).toBeInstanceOf(Uint8Array);
    clock.ms += TICKET_SECONDS * 1000;
    beat(a, b);
    const home = a.h.host.items.inv(rec(a, "bo")!);
    expect([worn(home), [...home.flags.slice(home.armor, home.armor + ARMOR_SLOTS)]]).toEqual([SUIT, SUIT.map(() => FLAG_ISSUED)]);
    expect(t.audit(a, b)).toEqual([]);
  } finally {
    t.cleanup();
  }
});
