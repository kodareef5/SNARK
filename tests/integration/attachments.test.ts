// Attachments to parity (planning/reference/weapons-plan.md, W7 and M10): N switches a flashlight or laser on the weapon in
// hand, kept on its slot (FLAG_ON), saved, sent to its owner and, for a laser, to others; taking another thing in hand
// switches it off; a flashlight on wears its weapon; a silencer hides the flash and the side; a dart takes the attachment
// off; the scope zooms three times with its reticle, the holo-scope 1.25 with its tint and coloured crosshair; the laser's
// dot lies where the weapon points.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import { zoomed } from "../../client/core/optics.ts";
import { Feedback, CombatModel } from "../../client/core/feedback.ts";
import { HudModel } from "../../client/core/hud.ts";
import { LASER_DAY_FAR, LASER_DAY_NEAR, Lasers, daylight, dotAlpha } from "../../client/core/render/laser.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { RemoteSample, type ClientSession, type CombatEvent } from "../../client/core/session.ts";
import { KEY_CROSS, KEY_DOT, KEY_SIGHT, KEY_TINT, buildHud } from "../../client/core/ui/hud.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { LIGHT_WEAR_TICKS } from "../../server/combat.ts";
import { ZONE_TORSO } from "../../shared/anim/human.ts";
import type { Def, ItemDef } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_ATTACH, CMD_LOAD, CMD_MOVE, CMD_SELECT, BOX_SELF, EVENT_DEATH, EVENT_HURT, EVENT_SHOT, RESULT_INVALID, RESULT_OK, SLOT_ON } from "../../shared/net/protocol.ts";
import { aimShot, shotAim } from "../../shared/sim/aim.ts";
import { BTN_MOD, BTN_PRIMARY, BTN_SECONDARY, Body, STANCE_PRONE, STANCE_STAND } from "../../shared/sim/character.ts";
import { DMG_MELEE } from "../../shared/sim/damage.ts";
import { FLAG_ON } from "../../shared/sim/items.ts";
import { FISTS } from "../../shared/sim/weapon.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-attach-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const TICK_MS = 1000 / 30;
const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

/** Ada and Eve, Ada with cheats. `send` sends one of Ada's commands and returns its result. */
function setup(host = {}, registry: Registry = reg) {
  const h = new Harness({}, 1, 60, { dev: true, ...host }, registry);
  const ada = h.join("ada");
  const eve = h.join("eve");
  h.run(600);
  h.say(ada, "enablecheats");
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(ada)]!)!;
  const items = h.host.items;
  const codes = new Map<number, number>();
  ada.onResult = (seq, code) => codes.set(seq, code);
  const send = (op: number, args: (w: BitWriter) => void): number => {
    const seq = ada.command(op, args);
    h.run(150);
    return codes.get(seq) ?? -1;
  };
  const give = (name: string, n = 1): number => {
    expect(items.mint(rec, registry.index.get(`core:${name}`)!, n)).toBe(n);
    h.run(100);
    return items.inv(rec).item.lastIndexOf(registry.index.get(`core:${name}`)!);
  };
  /** Ada holds `button` down for a few ticks and lets go. */
  const press = (button: number): void => {
    h.pilots[0]!.buttons |= button;
    h.run(TICK_MS * 3);
    h.pilots[0]!.buttons &= ~button;
    h.run(300);
  };
  return { h, ada, eve, rec, items, send, give, press, inv: () => items.inv(rec) };
}

/** Whether `viewer` is shown `of`'s laser on. */
function seenOn(h: Harness, viewer: ClientSession, of: ClientSession): number {
  const r = new RemoteSample();
  viewer.sampleRemote(r);
  for (let i = 0; i < r.count; i++) if (r.id[i] === h.ent(of)) return r.on[i]!;
  return -1;
}

test("N switches a fitted laser on and off on the weapon in hand; it is saved, sent to its owner and to others, and goes off when another thing is taken in hand or the weapon moves", () => {
  const db = join(dir, "laser.db");
  const { h, ada, eve, rec, items, send, give, press, inv } = setup({ dbPath: db });
  give("pistol");
  const laser = give("laser");
  const slot = takeInHand(h, ada, id("pistol"));
  // With nothing fitted, N does nothing.
  press(BTN_MOD);
  expect(inv().flags[slot]).toBe(0);
  expect(send(CMD_ATTACH, (w) => (w.varint(slot), w.varint(laser)))).toBe(RESULT_OK);
  press(BTN_MOD);
  const e = h.ent(ada);
  expect([inv().flags[slot]! & FLAG_ON, ada.inventory!.flags[slot]! & SLOT_ON, h.world.ents.on[e]]).toEqual([FLAG_ON, SLOT_ON, 1]);
  h.run(300);
  expect(seenOn(h, eve, ada)).toBe(1);
  press(BTN_MOD);
  expect([inv().flags[slot], h.world.ents.on[e]]).toEqual([0, 0]);
  h.run(300);
  expect(seenOn(h, eve, ada)).toBe(0);
  press(BTN_MOD);
  expect(inv().flags[slot]).toBe(FLAG_ON);
  // The flag changes nothing of how the weapon is counted, loaded or mended.
  expect(inv().total(id("pistol"))).toBe(1);
  expect(items.audit()).toEqual([]);

  // It survives a restart, still in hand.
  const pid = rec.pid;
  ada.close();
  h.run(200);
  h.host.shutdown();
  const h2 = new Harness({}, 1, 60, { dbPath: db, dev: true });
  const rec2 = h2.host.records.byPid.get(pid)!;
  expect(h2.host.items.inv(rec2).flags[slot]).toBe(FLAG_ON);
  const again = h2.join("ada");
  const other = h2.join("eve");
  h2.run(800);
  expect([again.inventory!.flags[slot], h2.world.ents.on[h2.ent(again)]]).toEqual([SLOT_ON, 1]);
  expect(seenOn(h2, other, again)).toBe(1);

  // Taking another thing in hand switches it off, and taking the pistol back does not switch it on again.
  const codes = new Map<number, number>();
  again.onResult = (seq, code) => codes.set(seq, code);
  const select = (k: number): void => {
    again.command(CMD_SELECT, (w) => w.u8(k));
    h2.run(300);
  };
  select(3);
  expect(h2.host.items.inv(rec2).flags[slot]).toBe(0);
  select(slot - h2.host.items.inv(rec2).hotbar);
  expect([h2.host.items.inv(rec2).flags[slot], h2.world.ents.on[h2.ent(again)]]).toEqual([0, 0]);
  h2.run(300);
  expect(seenOn(h2, other, again)).toBe(0);
  // Switched on and then moved to the bag, it is off.
  h2.pilots[0]!.buttons = BTN_MOD;
  h2.run(TICK_MS * 3);
  h2.pilots[0]!.buttons = 0;
  h2.run(300);
  expect(h2.host.items.inv(rec2).flags[slot]).toBe(FLAG_ON);
  const to = h2.host.items.inv(rec2).free();
  again.command(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(slot), w.bits(BOX_SELF, 1), w.varint(to), w.u16(0), w.u16(id("pistol"))));
  h2.run(300);
  expect([h2.host.items.inv(rec2).item[to], h2.host.items.inv(rec2).flags[to], h2.world.ents.on[h2.ent(again)]]).toEqual([id("pistol"), 0, 0]);
  expect(h2.host.items.audit()).toEqual([]);
  h2.host.shutdown();
});

test("a flashlight switched on wears its weapon a use a minute, is not told to others, and a worn-out weapon's stays off; a scope or silencer is not switched", () => {
  const { h, ada, eve, items, send, give, press, inv } = setup();
  give("pistol");
  const light = give("flashlight");
  const slot = takeInHand(h, ada, id("pistol"));
  expect(send(CMD_ATTACH, (w) => (w.varint(slot), w.varint(light)))).toBe(RESULT_OK);
  press(BTN_MOD);
  expect(inv().flags[slot]).toBe(FLAG_ON);
  // Its light waits for local lights (D436): nobody else is told of it.
  expect(h.world.ents.on[h.ent(ada)]).toBe(0);
  expect(seenOn(h, eve, ada)).toBe(0);
  const uses = inv().dur[slot]!;
  h.run((LIGHT_WEAR_TICKS * 2 + 30) * TICK_MS);
  expect(uses - inv().dur[slot]!).toBe(2);
  // Off, it wears nothing.
  press(BTN_MOD);
  const off = inv().dur[slot]!;
  h.run((LIGHT_WEAR_TICKS + 30) * TICK_MS);
  expect(inv().dur[slot]).toBe(off);
  // At its last use it goes off, and a worn-out weapon's does not come on.
  press(BTN_MOD);
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(ada)]!)!;
  items.wear(rec, slot, inv().dur[slot]!);
  expect([inv().dur[slot], inv().flags[slot]]).toEqual([0, 0]);
  press(BTN_MOD);
  expect(inv().flags[slot]).toBe(0);
  // A scope and a silencer work whenever fitted.
  items.mend(rec, slot);
  for (const name of ["scope", "silencer"]) {
    const from = give(name);
    expect(send(CMD_ATTACH, (w) => (w.varint(slot), w.varint(from)))).toBe(RESULT_OK);
    press(BTN_MOD);
    expect(inv().flags[slot]).toBe(0);
  }
  expect(items.audit()).toEqual([]);
});

test("a silenced round is told to others as silenced, and the survivor it hits is not shown its side; one with no silencer is", () => {
  const { h, ada, eve, rec, items, send, give } = setup();
  const cy = h.join("cy");
  h.run(600);
  h.say(eve, "enablecheats");
  const g = flatGround(h, 20, 20);
  const at = { x: g.x + 10, z: g.z + 2 };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  h.say(eve, `tp ${at.x.toFixed(3)} ${(at.z + 6).toFixed(3)}`);
  h.say(cy, `tp ${(at.x - 4).toFixed(3)} ${at.z.toFixed(3)}`);
  give("pistol");
  give("round_pistol", 12);
  const silencer = give("silencer");
  const slot = takeInHand(h, ada, id("pistol"));
  expect(send(CMD_ATTACH, (w) => (w.varint(slot), w.varint(silencer)))).toBe(RESULT_OK);
  h.run(4000);
  const shots: CombatEvent[] = [];
  const hurts: CombatEvent[] = [];
  const pa = h.pilots[0]!;
  const frame = (): void => {
    for (const ev of cy.events) if (ev.kind === EVENT_SHOT) shots.push({ ...ev });
    cy.events.length = 0;
    for (const ev of eve.events) if (ev.kind === EVENT_HURT || ev.kind === EVENT_DEATH) hurts.push({ ...ev });
    eve.events.length = 0;
    const e = h.ent(eve);
    if (e < 0) return;
    const dx = h.world.ents.x[e]! - ada.own.x;
    const dz = h.world.ents.z[e]! - ada.own.z;
    pa.yaw = Math.atan2(dx, dz);
    pa.pitch = Math.atan2(h.world.ents.y[e]! + 1.2 - (ada.own.y + 1.62), Math.hypot(dx, dz));
  };
  h.run(600, frame);
  pa.buttons = BTN_SECONDARY;
  h.run(600, frame);
  pa.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 2, frame);
  pa.buttons = BTN_SECONDARY;
  h.run(800, frame);
  expect(shots.length).toBe(1);
  expect(shots[0]!.silenced).toBe(true);
  expect(hurts.length).toBe(1);
  expect([hurts[0]!.side, hurts[0]!.bearing]).toEqual([false, 0]);
  // Eve's screen reddens and shows no side.
  const fb = new Feedback();
  const m = new CombatModel();
  eve.events.push(hurts[0]!);
  fb.absorb(eve, reg, 1000);
  fb.fill(m, new Camera(), 0, true, 1010);
  expect([m.hurtCount, m.blood > 0]).toEqual([0, true]);

  // A blow with no silencer shows its side.
  const e = h.ent(eve);
  if (e >= 0) {
    h.host.combat.land({ by: rec, x: at.x, z: at.z, item: 0, base: 5, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 }, e, ZONE_TORSO, h.world.ents.x[e]!, h.world.ents.y[e]! + 1, h.world.ents.z[e]!, 6);
    h.run(300, frame);
    expect(hurts.length).toBe(2);
    expect(hurts[1]!.side).toBe(true);
  }
  // Without the silencer, the round is told as loud.
  pa.buttons = 0;
  h.run(300, frame);
  expect(items.detach(rec, slot)).toBe(true);
  h.run(2000, frame);
  pa.buttons = BTN_SECONDARY | BTN_PRIMARY;
  h.run(TICK_MS * 2, frame);
  pa.buttons = 0;
  h.run(800, frame);
  expect(shots.length).toBe(2);
  expect(shots[1]!.silenced).toBe(false);
  expect(items.audit()).toEqual([]);
});

test("loading a dart puts the long rifle's scope in the bag with the ledger whole, and nothing is fitted while darts are loaded", () => {
  const { h, ada, items, send, give, inv, rec } = setup();
  give("rifle");
  give("dart_tranq", 5);
  const scope = give("scope");
  const slot = takeInHand(h, ada, id("rifle"));
  expect(send(CMD_ATTACH, (w) => (w.varint(slot), w.varint(scope)))).toBe(RESULT_OK);
  expect(send(CMD_LOAD, (w) => (w.varint(slot), w.u16(id("dart_tranq"))))).toBe(RESULT_OK);
  // An empty weapon reloads by itself: the dart goes in and the scope comes off.
  h.run(6000);
  expect([inv().ammo[slot], inv().loaded[slot], inv().attach[slot], inv().total(id("scope")), items.total(id("scope"))]).toEqual([id("dart_tranq"), 1, 0, 1, 1]);
  expect(items.audit()).toEqual([]);
  const back = inv().item.indexOf(id("scope"));
  expect(send(CMD_ATTACH, (w) => (w.varint(slot), w.varint(back)))).toBe(RESULT_INVALID);
  expect(inv().attach[slot]).toBe(0);
  // With no room for the scope, a dart is not loaded and the scope stays.
  give("round_rifle", 2);
  items.unload(rec, slot);
  expect(items.attach(rec, slot, inv().item.indexOf(id("scope")))).toBe(true);
  items.mint(rec, id("waterskin"), 60);
  expect(inv().free()).toBe(-1);
  expect(items.load(rec, slot, id("dart_tranq"), 1)).toBe(-1);
  expect([inv().attach[slot], inv().loaded[slot]]).toEqual([id("scope"), 0]);
  // Rifle rounds take no attachment off.
  expect(items.load(rec, slot, id("round_rifle"), 1)).toBe(1);
  expect(inv().attach[slot]).toBe(id("scope"));
  expect(items.audit()).toEqual([]);
});

test("through a scope a long rifle sways less prone than standing, and a pistol not at all", () => {
  const b = new Body();
  b.kind = id("survivor");
  const move = reg.tamedMove[b.kind]!;
  const wander = (w: (typeof reg.weapon)[number], stance: number): number => {
    b.stance = stance;
    let most = 0;
    for (let t = 0; t < 300; t++) {
      aimShot(b, BTN_SECONDARY, w ?? FISTS, move, 0, 0, true, 77, t);
      most = Math.max(most, Math.hypot(shotAim.yaw, shotAim.pitch));
    }
    return most;
  };
  const rifle = reg.weapon[id("rifle")];
  const standing = wander(rifle, STANCE_STAND);
  const prone = wander(rifle, STANCE_PRONE);
  expect(standing).toBeGreaterThan(0);
  expect(prone).toBeGreaterThan(0);
  expect(prone).toBeLessThan(standing * 0.25);
  expect(wander(reg.weapon[id("pistol")], STANCE_STAND)).toBe(0);
});

test("the scope magnifies three times and the holo-scope 1.25; the HUD shows the scope's reticle for the crosshair, and the holo-scope's tint and coloured crosshair", () => {
  // Each sight's zoom is its item's optic facet (D1029).
  const scopeZoom = (reg.defs[id("scope")] as ItemDef).optic!.min;
  const holoReg = withHolo();
  const holoZoom = (holoReg.defs[holoReg.index.get("core:test_holo")!] as ItemDef).optic!.min;
  expect([scopeZoom, holoZoom]).toEqual([3, 1.25]);
  for (const base of [0.9, 1.2217, 1.6]) {
    expect(Math.tan(base / 2) / Math.tan(zoomed(base, scopeZoom) / 2)).toBeCloseTo(3, 9);
    expect(Math.tan(base / 2) / Math.tan(zoomed(base, holoZoom) / 2)).toBeCloseTo(1.25, 9);
  }
  const f = new UiFrame();
  const hud = new HudModel();
  f.begin(16 / 9);
  buildHud(f, hud);
  expect([f.find(KEY_CROSS) !== null, f.find(KEY_SIGHT), f.find(KEY_TINT)]).toEqual([true, null, null]);
  hud.scope = true;
  f.begin(16 / 9);
  buildHud(f, hud);
  expect([f.find(KEY_CROSS), f.find(KEY_SIGHT) !== null, f.find(KEY_SIGHT + 5) !== null]).toEqual([null, true, true]);
  // The holo-scope's crosshair shows even where the rules hide the crosshair, in the colour of what it is on.
  hud.scope = false;
  hud.crosshair = false;
  hud.holo = true;
  hud.crossTint = 0xff3a30;
  hud.tint = 0.22;
  hud.dots[0] = { u: 0.25, v: 0.5, alpha: 0.5 };
  hud.dotCount = 1;
  f.begin(16 / 9);
  buildHud(f, hud);
  expect([f.find(KEY_CROSS)?.tint, f.find(KEY_TINT)?.alpha, f.find(KEY_DOT)?.alpha]).toEqual([0xff3a30, 0.22, 0.5]);
  expect(f.find(KEY_DOT)!.x).toBeCloseTo(f.width / 4 - 2, 6);
});

test("a laser's dot lies where its beam meets the ground or a body, faint far off by day and whole at night", () => {
  const { h } = setup();
  const g = flatGround(h, 20, 20);
  const lasers = new Lasers();
  // Straight down from 1.6 m over flat ground: on the ground.
  lasers.cast(reg, h.world, null, g.x + 5, g.y + 1.6, g.z + 5, 0, -1, 0, 1, 0, -1);
  expect(lasers.count).toBe(1);
  expect(lasers.dots[0]!.y).toBeCloseTo(g.y, 1);
  expect(lasers.dots[0]!.alpha).toBe(1);
  // A body in the way takes the dot.
  const r = new RemoteSample();
  r.count = 1;
  r.id[0] = 9;
  r.kind[0] = id("survivor");
  r.x[0] = g.x + 5;
  r.y[0] = g.y;
  r.z[0] = g.z + 10;
  lasers.clear();
  lasers.cast(reg, h.world, r, g.x + 5, g.y + 1.2, g.z + 5, 0, 0, 1, 1, 0, -1);
  expect(lasers.count).toBe(1);
  expect(lasers.dots[0]!.z).toBeLessThan(g.z + 10);
  expect(lasers.dots[0]!.z).toBeGreaterThan(g.z + 9);
  // Its own beam does not stop at its own body.
  lasers.clear();
  lasers.cast(reg, h.world, r, g.x + 5, g.y + 1.2, g.z + 10, 0, -1, 0, 1, 9, 9);
  expect(lasers.dots[0]!.y).toBeCloseTo(g.y, 1);
  // Another body's laser is drawn from its eye along its look, when the gear says it is on.
  lasers.clear();
  r.on[0] = 0;
  lasers.remotes(reg, h.world, r, 1);
  expect(lasers.count).toBe(0);
  r.on[0] = 1;
  lasers.remotes(reg, h.world, r, 1);
  expect(lasers.count).toBe(1);
  expect(Math.hypot(lasers.dots[0]!.x - r.x[0]!, lasers.dots[0]!.z - r.z[0]!)).toBeGreaterThan(1);
  // By day it fades out past its near reach; at night it does not.
  expect([dotAlpha(LASER_DAY_NEAR, 1), dotAlpha(LASER_DAY_FAR, 1), dotAlpha(LASER_DAY_FAR, 0)]).toEqual([1, 0, 1]);
  expect([daylight(12), daylight(0), daylight(6)]).toEqual([1, 0, 0.5]);
});

test("in the whole client: N with a laser fitted draws its dot in the middle of the view, and aiming through a scope zooms three times and shows the reticle", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, corePack());
  // From the eye, whose middle is where the gun points: a survivor rises seen from behind unless it chose so.
  app.ui.settings.thirdPerson = false;
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(600);
  const s = app.session;
  s.text("enablecheats");
  run(400);
  const g = flatGround(h, 40, 40);
  s.text(`tp ${(g.x + 20).toFixed(3)} ${(g.z + 5).toFixed(3)}`);
  run(400);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  const items = h.host.items;
  items.mint(rec, id("pistol"), 1);
  items.mint(rec, id("laser"), 1);
  run(200);
  const slot = takeInHand(h, s, id("pistol"));
  expect(items.attach(rec, slot, items.inv(rec).item.indexOf(id("laser")))).toBe(true);
  app.controls.yaw = 0;
  app.controls.pitch = -0.3;
  run(400);
  expect(app.hud.dotCount).toBe(0);
  app.key("KeyN", true);
  run(100);
  app.key("KeyN", false);
  run(500);
  expect(items.inv(rec).flags[slot]).toBe(FLAG_ON);
  expect(app.hud.dotCount).toBe(1);
  expect(app.hud.dots[0]!.u).toBeCloseTo(0.5, 2);
  expect(app.hud.dots[0]!.v).toBeCloseTo(0.5, 2);

  // The long rifle with its scope, aimed: three times, and the reticle.
  items.mint(rec, id("rifle"), 1);
  items.mint(rec, id("scope"), 1);
  run(200);
  const rifle = takeInHand(h, s, id("rifle"), 1);
  expect(items.attach(rec, rifle, items.inv(rec).item.indexOf(id("scope")))).toBe(true);
  run(400);
  expect([app.hud.scope, app.hud.dotCount]).toEqual([false, 0]);
  app.controls.mouseButton(2, true);
  run(1500);
  const base = (app.ui.settings.fov * Math.PI) / 180;
  expect(app.hud.scope).toBe(true);
  expect(app.cam.fovY).toBeCloseTo(zoomed(base, 3), 3);
  // The server is told, and widens the view along the look (D1032).
  expect(h.host.gaze.count).toBe(1);
  // The mouse slows on the tangent of the view's half: a third as far a pixel at three times (optics.ts lookScale).
  expect(app.controls.zoom).toBeCloseTo(app.ui.settings.sensitivity / 3, 3);
  app.controls.mouseButton(2, false);
  run(800);
  expect(app.hud.scope).toBe(false);
  expect(app.controls.zoom).toBeCloseTo(app.ui.settings.sensitivity, 3);
  expect(h.host.gaze.count).toBe(0);

  // Aimed, only the scope's window is drawn: the packet's window is the lens's box, a square as tall as the view, and the
  // projection is the whole view's (D1030). Lowered, the whole view again.
  app.controls.mouseButton(2, true);
  run(1500);
  let packet = app.frame(h.now, 1280, 720)!;
  expect(Array.from(packet.window, (v) => +v.toFixed(4))).toEqual([+(0.5 - 360 / 1280).toFixed(4), 0, +(0.5 + 360 / 1280).toFixed(4), 1]);
  expect(app.cam.windowed).toBe(true);
  app.controls.mouseButton(2, false);
  run(800);
  packet = app.frame(h.now, 1280, 720)!;
  expect([...packet.window]).toEqual([0, 0, 0, 0]);
  // Low poly's one depth range splits as the lit tiers' does while magnified, and not otherwise.
  app.ui.settings.tier = "lowpoly";
  run(400);
  expect(app.frame(h.now, 1280, 720)!.split).toBe(0);
  app.controls.mouseButton(2, true);
  run(1500);
  expect(app.frame(h.now, 1280, 720)!.split).toBe(384);
  app.controls.mouseButton(2, false);
  run(800);
  app.ui.settings.tier = "medium";
  run(400);

  // Seen from behind, the scope is still looked through from the eye, and the view goes back behind as it is lowered.
  app.view.thirdPerson = true;
  run(400);
  const eyeGap = (): number => Math.hypot(app.cam.x - s.own.x, app.cam.z - s.own.z);
  expect([app.hud.behind, eyeGap() > 1]).toEqual([true, true]);
  app.controls.mouseButton(2, true);
  run(1500);
  expect([app.view.atEye, app.hud.behind, app.view.thirdPerson]).toEqual([true, false, true]);
  expect(eyeGap()).toBeLessThan(0.5);
  app.controls.mouseButton(2, false);
  run(800);
  expect([app.view.atEye, app.hud.behind]).toEqual([false, true]);
  expect(eyeGap()).toBeGreaterThan(1);
});

/** The core content with a holo-scope (an attachment kind no item is yet: it waits for the fabricator) fitting the pistol. */
function withHolo(): Registry {
  const pistol = CORE_CONTENT.find((d) => d.id === "core:pistol" && d.type === "item") as ItemDef;
  const holo: ItemDef = { type: "item", class: "attachment", id: "core:test_holo", stack: 1, weight: 0.5, color: 8, attachment: "holo", optic: { min: 1.25 } };
  const fits: ItemDef = { ...pistol, weapon: { ...pistol.weapon!, fits: [...(pistol.weapon!.fits ?? []), "core:test_holo"] } };
  const made = compileContent([...CORE_CONTENT.filter((d) => d !== pistol), fits as Def, holo as Def]);
  expect(made.errors).toEqual([]);
  return made.registry!;
}

test("in the whole client: a holo-scope fitted shows its crosshair unaimed, and aimed it zooms 1.25 times with its tint", () => {
  const registry = withHolo();
  const h = new Harness({}, 1, 60, { dev: true }, registry);
  const app = new App(h.join("ada", {}, { manual: true }), registry, corePack());
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(600);
  const s = app.session;
  s.text("enablecheats");
  run(400);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  const items = h.host.items;
  const at = (name: string): number => registry.index.get(name)!;
  items.mint(rec, at("core:pistol"), 1);
  items.mint(rec, at("core:test_holo"), 1);
  run(200);
  const slot = takeInHand(h, s, at("core:pistol"));
  expect(items.attach(rec, slot, items.inv(rec).item.indexOf(at("core:test_holo")))).toBe(true);
  run(400);
  expect([app.hud.holo, app.hud.tint, app.hud.scope]).toEqual([true, 0, false]);
  app.controls.mouseButton(2, true);
  run(1500);
  const base = (app.ui.settings.fov * Math.PI) / 180;
  expect(app.hud.tint).toBeGreaterThan(0);
  expect(app.cam.fovY).toBeCloseTo(zoomed(base, 1.25), 3);
  // At 1.25 times it is still seen from wherever the player chose.
  expect(app.view.atEye).toBe(false);
  app.controls.mouseButton(2, false);
  run(400);
});
