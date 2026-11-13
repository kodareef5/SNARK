import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { FOV_MAX, SENSITIVITY_MIN, Settings, VOLUME_MAX } from "../../client/core/settings.ts";
import { KEY_DAMAGE, KEY_HIT_MARK } from "../../client/core/ui/combat.ts";
import { KEY_SETTINGS_MIC, KEY_SETTINGS_PANEL, KEY_SETTINGS_ROW, buildSettings, settingsClick } from "../../client/core/ui/settings.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { createHost } from "../../server/host.ts";
import type { Rules } from "../../server/settings/rules.ts";
import { LOOK_BYTES, randomLook } from "../../shared/anim/look.ts";
import { ZONE_HEAD, ZONE_LEG_L, ZONE_LEG_R, ZONE_TORSO } from "../../shared/anim/human.ts";
import { CMD_CREATE, EVENT_DEATH, EVENT_HIT, EVENT_HURT, EVENT_KILL, SESSION_ALIVE, SESSION_CREATING, SESSION_DEAD } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { launchSpeed } from "../../shared/sim/projectiles.ts";
import { V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness, type Pilot } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-round3-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const TICK_MS = 1000 / 30;
const EYE = 1.62;
const HEAD = 1.66;
const CHEST = 1.25;
const SHIN = 0.45;

test("round 3: two survivors made in the creator, one in flak and one bare, fight with bow and rifle at 150 ms; a creature is put to sleep; wood burns; stone is blown; the books balance", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const link = { latencyMs: 75 };
  // Each arrives with no body, sees the creator, and makes one.
  const ada = h.join("ada", link, { look: null });
  const bob = h.join("bob", link, { look: null });
  h.run(700);
  expect([ada.sessionState, bob.sessionState]).toEqual([SESSION_CREATING, SESSION_CREATING]);
  const looks = [new Uint8Array(LOOK_BYTES), new Uint8Array(LOOK_BYTES)];
  randomLook(new Rng(3), looks[0]!);
  randomLook(new Rng(8), looks[1]!);
  ada.command(CMD_CREATE, (w) => looks[0]!.forEach((b) => w.u8(b)));
  bob.command(CMD_CREATE, (w) => looks[1]!.forEach((b) => w.u8(b)));
  h.run(700);
  expect([ada.sessionState, bob.sessionState]).toEqual([SESSION_ALIVE, SESSION_ALIVE]);
  const ents = h.world.ents;
  const [ea, eb] = [h.ent(ada), h.ent(bob)];
  expect([...ents.look[ea]!]).toEqual([...looks[0]!]);
  expect([...ents.look[eb]!]).toEqual([...looks[1]!]);
  const arec = h.host.records.byPid.get(ents.pid[ea]!)!;
  const brec = h.host.records.byPid.get(ents.pid[eb]!)!;
  const [pa, pb] = [h.pilots[0]!, h.pilots[1]!];
  const { combat, survival, items, projectiles } = h.host;

  // A range: Ada at the south end, Bob ten metres north, facing each other. Ada wears flak; Bob nothing.
  h.say(ada, "enablecheats");
  h.say(bob, "enablecheats");
  const g = flatGround(h, 24, 40);
  const at = { x: g.x + 12, z: g.z + 2, y: g.y };
  const APART = 10;
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  h.say(bob, `tp ${at.x.toFixed(3)} ${(at.z + APART).toFixed(3)}`);
  pa.yaw = 0;
  pb.yaw = Math.PI;
  expect(h.say(ada, "armor flak")).toEqual(["wearing flak"]);
  for (const s of [ada, bob]) {
    h.say(s, "kit bow");
    h.say(s, "kit rifle");
  }
  h.say(ada, "kit grenades");
  const ainv = items.inv(arec);
  const binv = items.inv(brec);
  expect([...ents.gear[ea]!.subarray(1)]).toEqual(["hat", "shirt", "gloves", "pants", "boots"].map((p) => id(`flak_${p}`)));
  expect([...ents.gear[eb]!.subarray(1)]).toEqual([0, 0, 0, 0, 0]);

  const health = (rec: typeof arec): number => survival.value(rec, V_HEALTH);
  const drop = (far: number): number => 0.5 * 9.81 * (far / launchSpeed(70, 1)) ** 2;
  /** Aim `pilot` at a point `height` above the feet of someone `far` metres straight ahead, held over by `over`. */
  const aim = (pilot: Pilot, height: number, far = APART, over = 0): void => void (pilot.pitch = Math.atan2(height + over - EYE, far));
  const bow = (pilot: Pilot): void => {
    pilot.buttons |= BTN_PRIMARY;
    h.run(TICK_MS * 46);
    pilot.buttons &= ~BTN_PRIMARY;
    h.run(1400);
  };
  const trigger = (pilot: Pilot, ms = 700): void => {
    pilot.buttons |= BTN_PRIMARY;
    h.run(TICK_MS * 3);
    pilot.buttons &= ~BTN_PRIMARY;
    h.run(ms);
  };
  const told = (s: ClientSession, kind: number) => s.events.filter((ev) => ev.kind === kind);

  // 1. Bob's bow on Ada's flak. A piece of 100 counts five times against an aimed hit: a sixth gets through.
  takeInHand(h, bob, id("bow"));
  h.run(1500);
  const before = health(arec);
  aim(pb, HEAD, APART, drop(APART));
  bow(pb);
  expect([combat.last.zone, combat.last.victim, combat.last.by]).toEqual([ZONE_HEAD, arec.pid, brec.pid]);
  expect(combat.last.damage).toBeCloseTo((55 * 3) / 6, 4);
  aim(pb, CHEST, APART, drop(APART));
  bow(pb);
  expect(combat.last.zone).toBe(ZONE_TORSO);
  expect(combat.last.damage).toBeCloseTo(55 / 6, 4);
  // A shin: aimed a hand's width off the middle, where a leg is. Between the legs there is nothing to hit.
  pb.yaw = Math.atan2(0.11, -APART);
  aim(pb, SHIN, APART, drop(APART));
  bow(pb);
  pb.yaw = Math.PI;
  expect([ZONE_LEG_L, ZONE_LEG_R]).toContain(combat.last.zone);
  expect(combat.last.damage).toBeCloseTo(55 / 6, 4);
  // The three numbers on Bob's screen: the head's is three times a limb's.
  expect(told(bob, EVENT_HIT).map((ev) => [ev.damage, ev.blocked])).toEqual([[28, true], [9, true], [9, true]]);
  // Ada was told of each: how much, which part, and that it came from the north.
  expect(told(ada, EVENT_HURT).map((ev) => [ev.damage, ev.bearing])).toEqual([[28, 0], [9, 0], [9, 0]]);
  // Her armor is worn where it was hit, by what it stopped: one use for each sixteen points.
  const durable = (k: number): number => ainv.dur[ainv.armor + k]!;
  expect([durable(0), durable(1), durable(3)]).toEqual([120 - Math.ceil((165 - 27.5) / 16), 120 - Math.ceil((55 - 55 / 6) / 16), 120 - Math.ceil((55 - 55 / 6) / 16)]);
  expect([durable(2), durable(4)]).toEqual([120, 120]);

  // 2. Bob's rifle on her chest: 280, of which a sixth.
  takeInHand(h, bob, id("rifle"), 1);
  h.run(5200);
  aim(pb, CHEST);
  h.run(200);
  trigger(pb);
  expect(combat.last.zone).toBe(ZONE_TORSO);
  expect(combat.last.damage).toBeCloseTo(280 / 6, 4);
  // She has taken 92 of her 100, a little mended since, and lives: injured, and slowed for it.
  expect(health(arec)).toBeGreaterThan(0);
  expect(before - health(arec)).toBeLessThan(27.5 + 55 / 6 + 55 / 6 + 280 / 6 + 0.01);
  expect(before - health(arec)).toBeGreaterThan(27.5 + 55 / 6 + 55 / 6 + 280 / 6 - 5);
  expect(h.host.buffs.has(arec, id("injured"))).toBe(true);
  expect(ents.speedQ[ea]).toBe(800);
  expect(ada.sessionState).toBe(SESSION_ALIVE);

  // 3. Ada's bow on Bob, who wears nothing: all fifty-five.
  takeInHand(h, ada, id("bow"));
  h.run(1500);
  aim(pa, CHEST, APART, drop(APART));
  bow(pa);
  expect([combat.last.zone, combat.last.victim, combat.last.damage, combat.last.blocked]).toEqual([ZONE_TORSO, brec.pid, 55, 0]);
  // 4. Her rifle on his leg: 280 into what he has left. He dies; she is told, and has the experience.
  takeInHand(h, ada, id("rifle"), 1);
  h.run(5200);
  pa.yaw = Math.atan2(0.11, APART);
  aim(pa, SHIN);
  h.run(200);
  const xp = arec.xp;
  const left = health(brec);
  trigger(pa);
  expect(combat.last.killed).toBe(true);
  expect([ZONE_LEG_L, ZONE_LEG_R]).toContain(combat.last.zone);
  expect(combat.last.damage).toBeCloseTo(left, 0);
  expect([bob.sessionState, brec.dead]).toEqual([SESSION_DEAD, true]);
  const death = told(bob, EVENT_DEATH)[0]!;
  expect([death.name, death.item]).toEqual(["ada", id("rifle")]);
  expect(death.far).toBeCloseTo(APART, 0);
  expect(told(ada, EVENT_KILL).map((ev) => ev.name)).toEqual(["bob"]);
  expect(arec.xp).toBe(xp + 10);
  expect(told(ada, EVENT_HIT).map((ev) => ev.kill)).toEqual([false, true]);
  // At 150 ms every one of those shots was judged some ticks back, within the cap.
  const back = h.world.tick - combat.viewTick(h.client(ada)!);
  expect(back).toBeGreaterThan(5);
  expect(back).toBeLessThanOrEqual(12);

  // 5. A creature, tranquilizer arrows, and it is down.
  const ge = h.host.spawnCreature("core:grazer", at.x - 6, at.z + 8, 1);
  const grec = h.host.records.byPid.get(ents.pid[ge]!)!;
  const slot = takeInHand(h, ada, id("bow"));
  items.load(arec, slot, id("arrow_tranq"), 1);
  h.run(1200);
  for (let n = 0; n < 12 && !grec.out; n++) {
    const dx = ents.x[ge]! - ents.x[ea]!;
    const dz = ents.z[ge]! - ents.z[ea]!;
    const far = Math.hypot(dx, dz);
    pa.yaw = Math.atan2(dx, dz);
    aim(pa, 0.9, far, drop(far));
    pa.buttons |= BTN_PRIMARY;
    h.run(TICK_MS * 46);
    pa.buttons &= ~BTN_PRIMARY;
    h.run(500);
  }
  expect(grec.out).toBe(true);
  expect(survival.value(grec, V_TORPOR)).toBeGreaterThan(100);
  expect(health(grec)).toBeGreaterThan(100);

  // 6. A wooden wall and flame arrows: fire counts three times on wood.
  const structs = h.world.structs;
  const wood = structs.add(id("wall_wood"), at.x + 6, at.y + 1.5, at.z + 9, 0, 0, 1000);
  const hp = (ref: number): number => structs.chunks[Math.floor(ref / 65536)]!.hp[ref & 0xffff]!;
  items.load(arec, slot, id("arrow_flame"), 1);
  h.run(1200);
  pa.yaw = Math.atan2(6, 9);
  aim(pa, 1.5, Math.hypot(6, 9), drop(Math.hypot(6, 9)));
  bow(pa);
  expect(hp(wood)).toBe(1000 - 165);
  bow(pa);
  expect(hp(wood)).toBe(1000 - 330);
  // 7. A stone wall and a grenade thrown to it: the wall takes what its distance from the blast leaves of 788.
  const stone = structs.add(id("wall"), at.x, at.y + 1.5, at.z + 22, 0, 0, 1500);
  takeInHand(h, ada, id("grenade"), 2);
  h.run(700);
  pa.yaw = 0;
  pa.pitch = 0.12;
  pa.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 12);
  pa.buttons &= ~BTN_PRIMARY;
  h.run(5800);
  expect(projectiles.bursts).toBe(1);
  expect(1500 - hp(stone)).toBeGreaterThan(100);
  expect(1500 - hp(stone)).toBeLessThanOrEqual(788);
  expect(hp(wood)).toBe(1000 - 330);

  // The books: every arrow, round and grenade made is carried, loaded, standing where it landed, or written off as spent.
  expect(items.audit()).toEqual([]);
  expect(h.say(ada, "audit")).toEqual(["the ledger balances"]);
  expect(projectiles.fired).toBeGreaterThanOrEqual(11);
  // What was fired wore what fired it, a use a shot: Bob's bow three and his rifle one (they lie in his cache now); Ada's rifle one, her bow one for each arrow.
  expect([binv.dur[binv.hotbar], binv.dur[binv.hotbar + 1]]).toEqual([50 - 3, 70 - 1]);
  expect(ainv.dur[ainv.hotbar + 1]).toBe(70 - 1);
  expect(ainv.dur[ainv.hotbar]).toBe(50 - (projectiles.fired - 3 - 1 - 1 - 1));
  expect(ada.stats.undecodable + bob.stats.undecodable).toBe(0);
});

test("server rules are factors in the damage function, last until the server is started again, and the console shows and sets them", () => {
  const dbPath = join(dir, "rules.db");
  let h = new Harness({}, 1, 60, { dev: true, dbPath });
  let ada = h.join("ada");
  const bob = h.join("bob");
  h.run(500);
  h.say(ada, "enablecheats");
  h.say(bob, "enablecheats");
  const g = flatGround(h, 24, 30);
  const at = { x: g.x + 12, z: g.z + 2 };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  h.say(bob, `tp ${at.x.toFixed(3)} ${(at.z + 1.5).toFixed(3)}`);
  const [pa] = h.pilots;
  pa!.yaw = 0;
  h.run(300);
  const combat = h.host.combat;
  const punch = (height: number): number => {
    pa!.pitch = Math.atan2(height - EYE, 1.5);
    h.run(100);
    const before = combat.hits;
    pa!.buttons |= BTN_PRIMARY;
    h.run(TICK_MS * 8);
    pa!.buttons &= ~BTN_PRIMARY;
    h.run(TICK_MS * 22);
    return combat.hits > before ? combat.last.damage : -1;
  };
  expect(h.say(ada, "settings")).toEqual(["every setting is at its default"]);
  expect(punch(HEAD)).toBe(24);
  // Head shots off: a head is a part like any other.
  expect(h.say(ada, "setting HeadMultipliers False")).toEqual(["HeadMultipliers=False  (until the server is started again)"]);
  expect(punch(HEAD)).toBe(8);
  // Survivors take half from each other.
  h.say(ada, "setting PlayerResistanceMultiplier 0.5");
  expect(punch(CHEST)).toBe(4);
  // Or nothing: the blow lands, and takes nothing.
  h.say(ada, "setting PlayerResistanceMultiplier 0");
  expect(punch(CHEST)).toBe(0);
  // A creature is another matter: its own rule.
  h.say(ada, "setting DinoResistanceMultiplier 2");
  const e = h.host.spawnCreature("core:dummy", at.x + 1.5, at.z, 1);
  expect(e).toBeGreaterThanOrEqual(0);
  pa!.yaw = Math.PI / 2;
  expect(punch(CHEST)).toBe(16);
  // What is built has its own too.
  h.say(ada, "setting StructureResistanceMultiplier 3");
  h.host.death.die(h.host.records.byPid.get(h.world.ents.pid[e]!)!, 0);
  const wall = h.world.structs.add(id("wall_thatch"), at.x + 1.6, g.y + 1.5, at.z, 16384, 0, 250);
  pa!.pitch = -0.1;
  pa!.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 8);
  pa!.buttons &= ~BTN_PRIMARY;
  h.run(TICK_MS * 22);
  expect(h.world.structs.chunks[Math.floor(wall / 65536)]!.hp[wall & 0xffff]).toBe(250 - 24);
  // Nonsense is refused, and says what would be accepted.
  expect(h.say(ada, "setting Gravity 2")).toEqual(["there is no setting called Gravity"]);
  expect(h.say(ada, "setting PlayerResistanceMultiplier -1")[0]).toMatch(/wants a number from 0 to/);
  expect(h.say(ada, "setting PlayerResistanceMultiplier 1e9")[0]).toMatch(/wants a number from 0 to/);
  expect(h.say(bob, "settings")).toHaveLength(4);
  // Clients are told the one they act on: the damage of a hit is not shown as a number unless the server says so.
  expect(ada.damageNumbers).toBe(false);
  h.say(ada, "setting ShowFloatingDamageText True");
  expect([ada.damageNumbers, bob.damageNumbers]).toEqual([true, true]);
  // A change from the console lasts until the server is started again. A host started on the same rules has them still;
  const set = h.host.rules;
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: set });
  const held = (r: Rules) => [r.num("PlayerResistanceMultiplier"), r.num("DinoResistanceMultiplier"), r.num("StructureResistanceMultiplier"), r.on("HeadMultipliers"), r.on("ShowFloatingDamageText")];
  expect(held(h.host.rules)).toEqual([0, 2, 3, false, true]);
  ada = h.join("ada");
  h.run(500);
  expect(ada.damageNumbers).toBe(true);
  h.host.shutdown();
  // one started with none has the defaults, whatever the world it loads was last run under: the files are the truth.
  h = new Harness({}, 1, 60, { dev: true, dbPath });
  expect(held(h.host.rules)).toEqual([1, 1, 1, true, false]);
  h.host.shutdown();
  createHost(reg, {}).shutdown();
});

test("the console's combat tools: armor on and off the books, what each part of the body takes, and an audit", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const s = h.join("ada");
  h.run(500);
  // Without cheats only what tells is allowed.
  expect(h.say(s, "armor flak")).toEqual(["denied: cheats are not enabled for you"]);
  expect(h.say(s, "hitzones")[0]).toBe("head        x3  armor 0  takes 300%");
  h.say(s, "enablecheats");
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(s)]!)!;
  const inv = h.host.items.inv(rec);
  expect(h.say(s, "armor hide")).toEqual(["wearing hide"]);
  expect([...inv.item.subarray(inv.armor, inv.armor + 5)]).toEqual(["hat", "shirt", "gloves", "pants", "boots"].map((p) => id(`hide_${p}`)));
  // A hide piece rates 20, a hundred against an aimed hit: half gets through, and a head still counts three times.
  const zones = h.say(s, "hitzones");
  expect(zones.slice(0, 2)).toEqual(["head        x3  armor 100  takes 150%", "torso       x1  armor 100  takes 50%"]);
  expect(zones).toHaveLength(10);
  // Changing sets destroys the old one on the books and makes the new.
  expect(h.say(s, "armor flak")).toEqual(["wearing flak"]);
  expect(inv.total(id("hide_hat"))).toBe(0);
  expect(inv.item[inv.armor]).toBe(id("flak_hat"));
  expect(h.say(s, "armor off")).toEqual(["armor off"]);
  expect(inv.used()).toBe(0);
  expect(h.say(s, "armor plate")[0]).toMatch(/^no armor "plate"/);
  expect(h.say(s, "audit")).toEqual(["the ledger balances"]);
  // An audit that finds something says what.
  inv.set(0, id("berry"), 5, 0, 0, 0);
  expect(h.say(s, "audit")[0]).toContain("core:berry");
});

test("settings: a player's own, stepped from a screen, and what they change", () => {
  const s = new Settings();
  const f = new UiFrame();
  for (const aspect of [9 / 16, 4 / 3, 16 / 9, 32 / 9]) {
    f.begin(aspect);
    buildSettings(f, s);
    const panel = f.find(KEY_SETTINGS_PANEL)!;
    for (let i = 0; i < f.count; i++) {
      const n = f.nodes[i]!;
      expect(n.x).toBeGreaterThanOrEqual(panel.x);
      expect(n.x + n.w).toBeLessThanOrEqual(panel.x + panel.w + 0.5);
      expect(n.y + n.h).toBeLessThanOrEqual(panel.y + panel.h + 0.5);
    }
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.w).toBeLessThanOrEqual(f.width);
  }
  expect(f.find(KEY_SETTINGS_ROW + 1)!.text).toBe("on");
  // The first row's buttons toggle; the others step, and stop at their ends.
  expect(settingsClick(KEY_SETTINGS_ROW + 3, s)).toBe(true);
  expect(s.damageNumbers).toBe(false);
  expect(settingsClick(KEY_SETTINGS_ROW + 1, s)).toBe(false);
  for (let n = 0; n < 40; n++) settingsClick(KEY_SETTINGS_ROW + 4 + 2, s);
  expect(s.sensitivity).toBe(SENSITIVITY_MIN);
  for (let n = 0; n < 40; n++) settingsClick(KEY_SETTINGS_ROW + 8 + 3, s);
  expect(s.fov).toBe(FOV_MAX);
  f.begin(16 / 9);
  buildSettings(f, s);
  expect([f.find(KEY_SETTINGS_ROW + 1)!.text, f.find(KEY_SETTINGS_ROW + 5)!.text, f.find(KEY_SETTINGS_ROW + 9)!.text]).toEqual(["off", "20%", "100 degrees"]);
  // Voice: how loud others are, from silence to twice as loud; and whether the talk key is held or switches.
  expect([f.find(KEY_SETTINGS_ROW + 13)!.text, f.find(KEY_SETTINGS_ROW + 17)!.text]).toEqual(["100%", "hold"]);
  for (let n = 0; n < 40; n++) settingsClick(KEY_SETTINGS_ROW + 12 + 3, s);
  expect(s.voiceVolume).toBe(VOLUME_MAX);
  for (let n = 0; n < 40; n++) settingsClick(KEY_SETTINGS_ROW + 12 + 2, s);
  expect(s.voiceVolume).toBe(0);
  settingsClick(KEY_SETTINGS_ROW + 16 + 3, s);
  expect(s.toggleTalk).toBe(true);
  // The microphone's meter: empty in silence, about half for quiet speech, full at the loudest.
  const meter = (level: number): number => {
    f.begin(16 / 9);
    buildSettings(f, s, level);
    return f.find(KEY_SETTINGS_MIC + 1)!.value;
  };
  expect([meter(0), meter(1), meter(2)]).toEqual([0, 1, 1]);
  expect(meter(0.03)).toBeCloseTo(0.49, 1);
  expect(meter(0.0001)).toBe(0);
  expect([f.find(KEY_SETTINGS_ROW + 13)!.text, f.find(KEY_SETTINGS_ROW + 17)!.text]).toEqual(["0%", "on and off"]);

  // In the client: O opens the screen and frees the mouse; the view, the mouse and the numbers follow what is set.
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, corePack());
  app.frame(0, 1280, 720);
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(500);
  app.session.text("enablecheats");
  run(200);
  expect(app.ui.wantsPointerLock).toBe(true);
  app.key("KeyO", true);
  run(50);
  expect(app.ui.wantsPointerLock).toBe(false);
  expect(app.ui.frame.find(KEY_SETTINGS_PANEL)).not.toBeNull();
  app.pointer(0, KEY_SETTINGS_ROW + 8 + 3, 0, 0, 0);
  app.pointer(0, KEY_SETTINGS_ROW + 4 + 2, 0, 0, 0);
  run(400);
  expect(app.ui.settings.fov).toBe(75);
  expect(app.cam.fovY).toBeCloseTo((75 * Math.PI) / 180, 2);
  expect(app.controls.zoom).toBeCloseTo(0.9, 2);
  app.key("Escape", true);
  run(50);
  expect(app.ui.frame.find(KEY_SETTINGS_PANEL)).toBeNull();
  expect(app.ui.wantsPointerLock).toBe(true);
  // A punch on a dummy shows its mark and, on a server that shows the damage of hits, its number; with the player's own numbers off, the mark alone.
  app.session.text("setting ShowFloatingDamageText True");
  run(300);
  app.session.text("dummy");
  run(300);
  const ents = h.world.ents;
  const e = h.ent(app.session);
  let d = -1;
  for (let i = 0; i < ents.cap; i++) if ((ents.flags[i]! & 1) !== 0 && ents.kind[i] === id("dummy")) d = i;
  app.session.text(`tp ${ents.x[d]!.toFixed(3)} ${(ents.z[d]! - 1.4).toFixed(3)}`);
  app.controls.yaw = 0;
  app.controls.pitch = Math.atan2(CHEST - EYE, 1.4);
  run(300);
  expect(Math.hypot(ents.x[d]! - ents.x[e]!, ents.z[d]! - ents.z[e]!)).toBeCloseTo(1.4, 1);
  const strike = (): void => {
    app.controls.mouseButton(0, true);
    run(TICK_MS * 8);
    app.controls.mouseButton(0, false);
    run(TICK_MS * 5);
  };
  strike();
  expect(app.ui.frame.find(KEY_HIT_MARK)).not.toBeNull();
  expect(app.ui.frame.find(KEY_DAMAGE)!.text).toBe("8");
  run(1500);
  app.ui.settings.damageNumbers = false;
  strike();
  expect(app.ui.frame.find(KEY_HIT_MARK)).not.toBeNull();
  expect(app.ui.frame.find(KEY_DAMAGE)).toBeNull();
});
