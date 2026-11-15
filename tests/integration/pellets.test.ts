// Shots of many rays and damage that falls off (planning/reference/weapons-plan.md, W3, M3): the shotgun's shell is ten
// pellets, each its own ray of the cone from the shot's seed, tested at the shooter's view tick and landed alone, at the
// share of its damage its distance leaves it. The shooter's client draws its own rays, a third client lays the same rays
// from the seed the server sends, and every hit lies on one of them.
import { expect, test } from "bun:test";
import type { CombatEvent, LocalShot } from "../../client/core/session.ts";
import { CORE_CONTENT, CORE_PACK } from "../../content/core.ts";
import type { Def, ItemDef } from "../../shared/content/defs.ts";
import { compilePacks, type ContentPack } from "../../shared/content/packs.ts";
import { compileContent, shotRays } from "../../shared/content/registry.ts";
import { ZONE_HEAD } from "../../shared/anim/human.ts";
import { EVENT_HIT, EVENT_SHOT, S_EVENT } from "../../shared/net/protocol.ts";
import { shotDir } from "../../shared/sim/aim.ts";
import { BTN_PRIMARY, BTN_SECONDARY } from "../../shared/sim/character.ts";
import { DMG_BULLET, falloff, harm, hit, resetHit, resolveDamage } from "../../shared/sim/damage.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";

const TICK_MS = 1000 / 30;
const EYE = 1.62;
const reg = compileContent(CORE_CONTENT).registry!;
const at = (id: string): number => reg.index.get(id)!;

test("the shotgun and its shell are ARK's double-barrel and Simple Shotgun Ammo, made in the hand until the smithy", () => {
  const gun = CORE_CONTENT.find((d) => d.type === "item" && d.id === "core:shotgun") as ItemDef;
  const shell = CORE_CONTENT.find((d) => d.type === "item" && d.id === "core:round_shotgun") as ItemDef;
  // Shotgun: "64*10", magazine 2, reload 3.33, 2.85 a second, 300 durability at 1 a use, weight 10, no attachments.
  expect(gun).toMatchObject({ weight: 10, weapon: { kind: "gun", ammo: ["core:round_shotgun"], power: 1, clip: 2, reload: 3.33, uses: 300 } });
  expect(gun.weapon!.fits).toBeUndefined();
  expect(Math.round(1 / gun.weapon!.interval!)).toBe(3);
  expect(reg.weapon[at("core:shotgun")]!.swingTicks).toBe(11);
  expect(gun.craft).toMatchObject({ needs: [{ item: "core:ingot", count: 80 }, { item: "core:wood", count: 20 }, { item: "core:hide", count: 25 }] });
  expect(gun.craft!.at).toBeUndefined();
  // Simple Shotgun Ammo: weight 0.1, stack 100; 3 simple bullets, an ingot and 3 gunpowder, two shells a craft.
  expect(shell).toMatchObject({ stack: 100, weight: 0.1, ammo: { damage: 64, type: "bullet", pellets: 10, falloff: { full: 10, none: 40 } } });
  expect(shell.craft).toMatchObject({ count: 2, needs: [{ item: "core:round_pistol", count: 3 }, { item: "core:ingot", count: 1 }, { item: "core:gunpowder", count: 3 }] });
  const engram = (item: string) => CORE_CONTENT.find((d) => d.type === "engram" && d.item === item);
  expect([engram("core:shotgun"), engram("core:round_shotgun")]).toMatchObject([{ level: 39, cost: 18 }, { level: 39, cost: 6 }]);
  expect([shotRays(reg, at("core:shotgun"), at("core:round_shotgun")), shotRays(reg, at("core:rifle"), at("core:round_rifle")), shotRays(reg, at("core:bow"), at("core:arrow_stone"))]).toEqual([10, 1, 1]);
});

test("damage falls off evenly from all of it to none, as one more factor of the damage function", () => {
  expect([0, 10, 25, 34, 40, 600].map((m) => Math.round(falloff(m, 10, 40) * 1000) / 1000)).toEqual([1, 1, 0.5, 0.2, 0, 0]);
  // A round with no falloff keeps its damage at any range.
  expect(falloff(599, 0, 0)).toBe(1);
  resetHit();
  hit.base = 64;
  hit.type = DMG_BULLET;
  hit.far = falloff(25, 10, 40);
  resolveDamage();
  expect(harm.health).toBe(32);
  resetHit();
  expect(hit.far).toBe(1);
});

const pack = (defs: readonly Def[]): ContentPack => ({ name: "arms", requires: ["core"], defs: defs as unknown as ContentPack["defs"] });

test("a gun's own pellet count takes the place of its round's, as the pump-action's 14 do with the same shells", () => {
  const shotgun = CORE_CONTENT.find((d) => d.type === "item" && d.id === "core:shotgun") as ItemDef;
  const pump: ItemDef = { ...shotgun, id: "arms:pump", weapon: { ...shotgun.weapon!, clip: 6, pellets: 14 } };
  const made = compilePacks([CORE_PACK, pack([pump])]);
  expect(made.errors).toEqual([]);
  const r = made.registry!;
  expect(shotRays(r, r.index.get("arms:pump")!, r.index.get("core:round_shotgun")!)).toBe(14);
  const bad = (d: ItemDef): string[] => compilePacks([CORE_PACK, pack([d])]).errors;
  const bow = CORE_CONTENT.find((d) => d.type === "item" && d.id === "core:bow") as ItemDef;
  const arrow = CORE_CONTENT.find((d) => d.type === "item" && d.id === "core:arrow_stone") as ItemDef;
  expect(bad({ ...bow, id: "arms:bow", weapon: { ...bow.weapon!, pellets: 3 } })).toEqual(["arms:bow: weapon.pellets is a gun's, a whole number from 1 to 255"]);
  expect(bad({ ...arrow, id: "arms:arrow", ammo: { ...arrow.ammo!, pellets: 3 } })).toEqual(["arms:arrow: ammo.pellets above 1 is for a round with no speed"]);
});

interface Told {
  ox: number;
  oy: number;
  oz: number;
  yaw: number;
  pitch: number;
  cone: number;
  rays: number;
  seed: number;
  flies: boolean;
}

/**
 * Ada stands `far` metres from a dummy with the shotgun in hand, `latencyMs` from the server with `loss`; Eve stands behind
 * her and is told every shot. Each frame takes Ada's predicted shots and hits and Eve's told shots, then aims Ada at the
 * dummy's chest.
 */
function range(far: number, latencyMs: number, loss: number) {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada", { latencyMs, loss });
  const eve = h.join("eve");
  h.run(600);
  h.say(ada, "enablecheats");
  h.say(eve, "enablecheats");
  const g = flatGround(h, 24, far + 6);
  const spot = { x: g.x + 12, z: g.z + 2, y: g.y };
  h.say(ada, `tp ${spot.x.toFixed(3)} ${spot.z.toFixed(3)}`);
  h.say(eve, `tp ${(spot.x - 8).toFixed(3)} ${(spot.z - 1).toFixed(3)}`);
  h.run(400);
  const pa = h.pilots[0]!;
  const dummy = h.host.spawnCreature("core:dummy", spot.x, spot.z + far, 1);
  const drec = h.host.records.byPid.get(h.world.ents.pid[dummy]!)!;
  h.world.ents.yaw[dummy] = drec.yaw = 32768;
  h.host.survival.gods.add(h.world.ents.pid[h.ent(eve)]!);
  h.say(ada, "kit shotgun");
  const slot = takeInHand(h, ada, h.reg.index.get("core:shotgun")!);
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(ada)]!)!;
  const mine: LocalShot[] = [];
  const told: Told[] = [];
  const hits: CombatEvent[] = [];
  const frame = (): void => {
    for (const s of ada.fired) mine.push({ ...s });
    ada.fired.length = 0;
    for (const ev of eve.events) if (ev.kind === EVENT_SHOT) told.push({ ox: ev.x, oy: ev.y, oz: ev.z, yaw: ev.vx, pitch: ev.vy, cone: ev.vz, rays: ev.rays, seed: ev.seed, flies: ev.flies });
    eve.events.length = 0;
    for (const ev of ada.events) if (ev.kind === EVENT_HIT) hits.push({ ...ev });
    ada.events.length = 0;
    const dx = spot.x - ada.own.x;
    const dz = spot.z + far - ada.own.z;
    pa.yaw = Math.atan2(dx, dz);
    pa.pitch = Math.atan2(spot.y + 1.25 - (ada.own.y + EYE), Math.hypot(dx, dz));
  };
  // The gun loads its two shells by itself.
  h.run(5000, frame);
  const fire = (buttons = 0): void => {
    pa.buttons = buttons;
    h.run(600, frame);
    pa.buttons = buttons | BTN_PRIMARY;
    h.run(TICK_MS * 2, frame);
    pa.buttons = buttons;
    h.run(TICK_MS * 12, frame);
  };
  const shells = (): number => h.host.items.inv(rec).total(h.reg.index.get("core:round_shotgun")!) + h.host.items.inv(rec).loaded[slot]!;
  // The size of every shot event the server sends Eve, in bytes with its message type.
  const sizes: number[] = [];
  const conn = h.host.game.clients.find((c) => c?.pid === h.world.ents.pid[h.ent(eve)])!.conn;
  const send = conn.send.bind(conn);
  conn.send = (channel: number, data: Uint8Array): void => {
    if (data[0] === S_EVENT && data[1] === EVENT_SHOT) sizes.push(data.length);
    send(channel, data);
  };
  return { h, ada, pa, rec, slot, mine, told, hits, frame, fire, shells, sizes };
}

/** The rays of a predicted shot, laid as the client lays them (client/core/shots.ts): its aim and cone as 32-bit floats. */
function raysOf(s: LocalShot): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < shotRays(reg, s.weapon, s.ammo); k++) {
    const d = [0, 0, 0];
    shotDir(s.seed, k, Math.fround(s.yaw), Math.fround(s.pitch), Math.fround(s.cone), d);
    out.push(d);
  }
  return out;
}

/** The rays a third client lays from what it was told. */
function toldRays(t: Told): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < t.rays; k++) {
    const d = [0, 0, 0];
    shotDir(t.seed, k, t.yaw, t.pitch, t.cone, d);
    out.push(d);
  }
  return out;
}

/** How far `p` lies from the ray from `o` along unit `d`, in metres; Infinity behind its origin. */
function offRay(o: readonly number[], d: readonly number[], p: readonly number[]): number {
  const v = [p[0]! - o[0]!, p[1]! - o[1]!, p[2]! - o[2]!];
  const t = v[0]! * d[0]! + v[1]! * d[1]! + v[2]! * d[2]!;
  if (t < 0) return Infinity;
  return Math.hypot(v[0]! - d[0]! * t, v[1]! - d[1]! * t, v[2]! - d[2]! * t);
}

/** Every predicted shot was told to the third client as the same ten rays, to the bit. */
function agree(mine: readonly LocalShot[], told: readonly Told[]): void {
  expect(told.length).toBe(mine.length);
  for (let i = 0; i < mine.length; i++) {
    const s = mine[i]!;
    const t = told[i]!;
    expect([t.flies, t.rays, t.seed]).toEqual([false, 10, s.seed]);
    expect(Math.hypot(t.ox - s.x, t.oy - s.y, t.oz - s.z)).toBeLessThan(0.01);
    expect(toldRays(t)).toEqual(raysOf(s));
  }
}

/** Each hit the shooter was told of lies on one ray of one of its shots, and no ray of a shot hits twice. */
function onRays(mine: readonly LocalShot[], hits: readonly CombatEvent[]): void {
  for (const ev of hits) {
    const best = Math.min(...mine.flatMap((s) => raysOf(s).map((d) => offRay([s.x, s.y, s.z], d, [ev.x, ev.y, ev.z]))));
    expect(best).toBeLessThan(0.01);
  }
}

test("at 2 m every pellet of a shell hits the dummy, ten markers of 64, for one shell and one use", () => {
  const { h, rec, slot, mine, told, hits, fire, shells, sizes } = range(2, 0, 0);
  const before = { shells: shells(), dur: h.host.items.inv(rec).dur[slot]!, fired: h.host.projectiles.fired, hits: h.host.combat.hits };
  fire();
  expect(h.host.projectiles.fired - before.fired).toBe(1);
  expect(h.host.projectiles.lastShot).toEqual({ rays: 10, hits: 10 });
  expect(h.host.combat.hits - before.hits).toBe(10);
  expect([before.shells - shells(), before.dur - h.host.items.inv(rec).dur[slot]!]).toEqual([1, 1]);
  expect(hits.map((e) => e.damage)).toEqual(Array(10).fill(64));
  expect(hits.reduce((a, e) => a + e.damage, 0)).toBe(640);
  expect(mine.length).toBe(1);
  agree(mine, told);
  onRays(mine, hits);
  // Ten rays are told in the bytes one is: the type, then 258 bits (aim, cone, rays and seed in place of the end).
  expect(sizes).toEqual([1 + Math.ceil(258 / 8)]);
  // The second barrel, then the gun is empty and reloads.
  fire();
  expect(hits.length).toBe(20);
  expect(h.host.items.inv(rec).loaded[slot]).toBe(0);
  expect(h.host.items.audit()).toEqual([]);
});

test("at 30 m from the hip a few pellets hit, each at a third of its damage", () => {
  const { h, mine, told, hits, fire } = range(30, 0, 0);
  let rays = 0;
  for (let k = 0; k < 6; k++) {
    fire();
    rays += h.host.projectiles.lastShot.rays;
    if (k % 2 === 1) h.run(4000);
  }
  expect(rays).toBe(60);
  expect(mine.length).toBe(6);
  agree(mine, told);
  onRays(mine, hits);
  // A dummy's chest is about a tenth of the cone's disc at 30 m: a pellet or two a shot, never most of them.
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.length).toBeLessThan(25);
  // falloff(30, 10, 40) is a third: 21 of 64 (a pellet in the head, three times that).
  for (const e of hits) expect([e.zone, e.damage]).toEqual([e.zone, e.zone === ZONE_HEAD ? 64 : 21]);
});

test("at 100 ms with loss, shells fired aimed and from the hip at 8 m land on the rays the client drew, and others are told the same rays", () => {
  const { h, mine, told, hits, fire } = range(8, 100, 0.02);
  for (let k = 0; k < 8; k++) {
    fire(k % 4 < 2 ? BTN_SECONDARY : 0);
    if (k % 2 === 1) h.run(4000);
  }
  h.run(600);
  expect(h.host.projectiles.fired).toBe(8);
  expect(mine.length).toBe(8);
  agree(mine, told);
  onRays(mine, hits);
  // About half the pellets hit at 8 m, where the cone is 1 to 1.4 m across, each for 64 inside the falloff's full range
  // (three times that in the head).
  expect(hits.length).toBeGreaterThan(25);
  expect(hits.length).toBeLessThan(70);
  for (const e of hits) expect([e.zone, e.damage]).toEqual([e.zone, e.zone === ZONE_HEAD ? 192 : 64]);
  // Aimed, the cone is the narrower.
  expect(mine.filter((_, i) => i % 4 < 2).every((s) => Math.abs(s.cone - 3.75) < 1e-6)).toBe(true);
  expect(mine.filter((_, i) => i % 4 >= 2).every((s) => Math.abs(s.cone - 5) < 1e-6)).toBe(true);
});
