// Where a shot goes (shared/sim/aim.ts; planning/reference/weapons-plan.md, M1 and M2): the cone, its bloom, the kick and
// the sway, each from the state both sides hold, and a ray's place in the cone from a seed.
import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def, ItemDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { hashBytes } from "../../shared/hash.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { readBody, writeBody } from "../../shared/net/protocol.ts";
import { AIM_MOVE, BLOOM_SHOT, KICK_UNIT, MAX_CONE, STANCE_CONE, UNITS_PER_DEGREE, aimSeed, aimShot, hash32, kickShot, moveShare, shotAim, shotCone, shotDir, shotKick, stepAim, sway, swayOut } from "../../shared/sim/aim.ts";
import { BTN_PRIMARY, BTN_SECONDARY, Body, MODE_SWIM, STANCE_CROUCH, STANCE_PRONE, type MoveParams } from "../../shared/sim/character.ts";
import { FISTS, actionOut, stepAction, type WeaponParams } from "../../shared/sim/weapon.ts";
import { lookDirection } from "../../shared/world/ray.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const params = (name: string): WeaponParams => reg.weapon[reg.index.get(`core:${name}`)!]!;
const survivor: MoveParams = reg.move[reg.index.get("core:survivor")!]!;
const SPRINT = survivor.walkSpeed * survivor.sprintMul;
const DEG = Math.PI / 180;

/** A survivor standing still on the ground. */
function still(): Body {
  const b = new Body();
  b.grounded = true;
  return b;
}

/** The angle between two unit vectors, in degrees. */
function apart(a: readonly number[], b: readonly number[]): number {
  const d = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  return Math.acos(Math.min(1, d)) / DEG;
}

/** Steps `b` as a tick does: the action, then the aim. */
function tick(b: Body, w: WeaponParams, buttons: number, pressed: number, t: number): void {
  stepAction(b, buttons, pressed, w);
  stepAim(b, w, t);
}

test("today's ranged weapons have a cone and a kick, chosen (DEV128 to DEV130), and nothing else has either", () => {
  const near = (v: number | undefined): number => Math.round((v ?? -1) * 1e6) / 1e6;
  const aim = (name: string): number[] => {
    const w = params(name);
    return [w.coneHip, w.coneAim, w.coneMove, w.coneBloom, (w.coneRecover ?? 0) * 30, w.coneSway, w.recoilKick ?? 0, (w.recoilRecover ?? 0) * 30].map(near);
  };
  expect(aim("bow")).toEqual([1.2, 0.2, 2.5, 0, 0, 0, 0, 0]);
  expect(aim("crossbow")).toEqual([1, 0, 2.5, 0, 0, 0, 1.5, 4]);
  expect(aim("rifle")).toEqual([2.5, 0, 3, 0, 0, 0.35, 5, 5]);
  expect(aim("pistol")).toEqual([1.5, 0.4, 2, 1, 1.5, 0, 2, 6]);
  // W3's double-barrel (DEV141).
  expect(aim("shotgun")).toEqual([5, 3.75, 3, 0, 0, 0, 6, 8]);
  for (let i = 1; i < reg.defs.length; i++) {
    const w = reg.weapon[i];
    // The blocked-out bow and guns take their kind's cone and kick (tests/items/blockouts.test.ts), and the plasma guns have their own.
    if (!w || ["core:bow", "core:crossbow", "core:rifle", "core:pistol", "core:shotgun", "core:bow_compound", "core:pistol_fabricated", "core:shotgun_pump", "core:rifle_assault", "core:rifle_sniper", "core:rocket_launcher", "core:rifle_plasma", "core:pistol_plasma"].includes(reg.ids[i]!)) continue;
    expect([reg.ids[i], w.coneHip, w.recoilKick]).toEqual([reg.ids[i], undefined, undefined]);
  }
  // A cone that blooms must close again, and a kick must come back.
  const bad = (to: ItemDef): string[] => compileContent(CORE_CONTENT.map((d): Def => (d.id === to.id && d.type === "item" ? to : d))).errors;
  const pistol = CORE_CONTENT.find((d) => d.id === "core:pistol" && d.type === "item") as ItemDef;
  expect(bad({ ...pistol, weapon: { ...pistol.weapon!, spread: { hip: 1, aim: 0.5, bloom: 1 } } })).toEqual(["core:pistol: weapon.spread that blooms must recover"]);
  expect(bad({ ...pistol, weapon: { ...pistol.weapon!, recoil: { kick: 2, recover: 0 } } })).toEqual(["core:pistol: weapon.recoil that kicks must recover"]);
  expect(bad({ ...pistol, weapon: { ...pistol.weapon!, spread: { hip: 1, aim: 0.5, sway: 91 } } })).toEqual(["core:pistol: weapon.spread is in degrees from 0 to 90"]);
});

test("standing still and aimed the cone is the weapon's narrowest standing; from the hip wider; a sprint or the air its widest; lower stances narrow it", () => {
  for (const name of ["bow", "crossbow", "rifle", "pistol"]) {
    const w = params(name);
    const b = still();
    const cone = (buttons = 0): number => shotCone(b, buttons, w, survivor, false);
    expect(cone(BTN_SECONDARY)).toBeCloseTo(w.coneAim!, 9);
    expect(cone()).toBeCloseTo(w.coneHip!, 9);
    expect(cone(BTN_SECONDARY)).toBeLessThan(cone());
    // A walk is its share of a sprint; aimed, speed opens it half as much.
    b.vx = survivor.walkSpeed;
    expect(moveShare(b, survivor)).toBeCloseTo(1 / survivor.sprintMul, 9);
    expect(cone()).toBeCloseTo(w.coneHip! + w.coneMove! / survivor.sprintMul, 9);
    expect(cone(BTN_SECONDARY)).toBeCloseTo(w.coneAim! + (AIM_MOVE * w.coneMove!) / survivor.sprintMul, 9);
    b.vx = SPRINT * 0.6;
    b.vz = SPRINT * 0.8;
    const widest = w.coneHip! + w.coneMove!;
    expect(cone()).toBeCloseTo(widest, 9);
    b.vx = b.vz = 0;
    b.grounded = false;
    expect(cone()).toBeCloseTo(widest, 9);
    b.grounded = true;
    b.mode = MODE_SWIM;
    expect(cone()).toBeCloseTo(widest, 9);
    b.mode = still().mode;
    b.stance = STANCE_CROUCH;
    expect(cone()).toBeCloseTo(w.coneHip! * STANCE_CONE[1]!, 9);
    b.stance = STANCE_PRONE;
    expect(cone(BTN_SECONDARY)).toBeCloseTo(w.coneAim! * STANCE_CONE[2]!, 9);
  }
  // Nothing wider than MAX_CONE is drawn, and a weapon without a cone has none.
  const wild: WeaponParams = { ...params("pistol"), coneHip: 80, coneMove: 80 };
  expect(shotCone(still(), 0, wild, survivor, false)).toBe(MAX_CONE);
  expect(shotCone(still(), 0, FISTS, survivor, false)).toBe(0);
  expect(shotCone(still(), 0, params("grenade"), survivor, false)).toBe(0);
});

test("each pistol shot blooms the cone a degree, to four at most, and it closes by 1.5 degrees a second; a shot is not widened by its own bloom", () => {
  const w = params("pistol");
  const b = still();
  b.rounds = 6;
  b.reloadTo = 6;
  const cones: number[] = [];
  let t = 1000;
  // Six shots as fast as it fires: a press every 14 ticks (2.1 a second, Simple Pistol).
  for (let n = 0; n < 6; n++) {
    tick(b, w, BTN_PRIMARY, BTN_PRIMARY, t++);
    expect(actionOut.fire).toBe(true);
    cones.push(shotCone(b, 0, w, survivor, true));
    for (let k = 0; k < 13; k++) tick(b, w, 0, 0, t++);
  }
  // The first goes within the hip's 1.5. Each later one sees what the last left, less 14 ticks of closing.
  expect(cones[0]).toBeCloseTo(1.5, 9);
  for (let n = 1; n < 6; n++) expect(cones[n]!).toBeGreaterThan(cones[n - 1]!);
  // Each gap of 14 ticks closes 44.8 of the 64 units a shot opens, so the sixth sees five times 19.2: a cone of 3.
  expect(cones[5]!).toBeCloseTo(1.5 + (5 * (64 - 14 * 3.2)) / 64, 9);
  expect(cones[5]!).toBeCloseTo(3, 9);
  expect(cones[5]!).toBeLessThanOrEqual(1.5 + 4);
  // Units: 64 a shot, at most 255; it closes 1.5 / 1 * 64 / 30 = 3.2 units a tick, exactly over any run of ticks.
  expect(BLOOM_SHOT).toBe(64);
  const full = still();
  for (let n = 0; n < 6; n++) {
    actionOut.fire = true;
    stepAim(full, w, 0);
  }
  expect(full.bloom).toBe(255);
  actionOut.fire = false;
  for (let k = 1; k <= 30; k++) stepAim(full, w, k);
  expect(full.bloom).toBe(255 - Math.floor(31 * 3.2) + Math.floor(1 * 3.2));
  for (let k = 31; k <= 120; k++) stepAim(full, w, k);
  expect(full.bloom).toBe(0);
  // Bloom is the held weapon's: another weapon without it leaves none.
  full.bloom = 200;
  stepAim(full, params("rifle"), 0);
  expect(full.bloom).toBe(0);
  full.bloom = 200;
  full.kick = 30;
  stepAim(full, FISTS, 0);
  expect([full.bloom, full.kick]).toEqual([0, 0]);
});

test("a shot kicks the aim up by its recoil, which comes back before the gun can fire again; the shot leaves along the kick before it", () => {
  for (const [name, kick, back] of [["pistol", 2, 6], ["rifle", 5, 5], ["crossbow", 1.5, 4]] as const) {
    const w = params(name);
    const b = still();
    b.rounds = 1;
    tick(b, w, BTN_PRIMARY, BTN_PRIMARY, 7);
    expect(actionOut.fire).toBe(true);
    expect(b.kick).toBe(kickShot(w));
    expect(b.kick * KICK_UNIT).toBeCloseTo(kick * UNITS_PER_DEGREE, -1.3);
    // Its own kick does not lift it: it leaves along the look.
    expect(shotKick(b, w, true)).toBe(0);
    expect(shotKick(b, w, false)).toBe(b.kick * KICK_UNIT);
    let ticks = 0;
    actionOut.fire = false;
    while (b.kick > 0) stepAim(b, w, 8 + ticks++);
    expect(Math.abs(ticks - (kick / back) * 30)).toBeLessThanOrEqual(1);
    // Before the next shot can leave: a pistol's interval, a single round's reload.
    expect(ticks).toBeLessThanOrEqual(w.clip > 1 ? w.swingTicks : w.reloadTicks);
  }
  // A gun that fires faster than its kick comes back climbs, and each shot leaves along what is left of the last.
  const fast: WeaponParams = { ...params("pistol"), swingTicks: 3, coneHip: 0, coneAim: 0, coneMove: 0, coneBloom: 0, recoilKick: 2, recoilRecover: 1 / 30 };
  const b = still();
  b.rounds = 6;
  const kicks: number[] = [];
  for (let t = 1; t <= 12; t++) {
    tick(b, fast, BTN_PRIMARY, t % 3 === 1 ? BTN_PRIMARY : 0, t);
    if (actionOut.fire) kicks.push(shotKick(b, fast, true));
  }
  expect(kicks.length).toBe(4);
  expect(kicks[0]).toBe(0);
  for (let n = 1; n < 4; n++) expect(kicks[n]!).toBeGreaterThan(kicks[n - 1]!);
  // The shot's pitch is the look's plus that kick.
  aimShot(b, 0, fast, survivor, 0, 1000, false, 1, 12);
  expect(shotAim.pitch).toBe(1000 + kicks[3]!);
  // and never past straight up.
  aimShot(b, 0, fast, survivor, 0, 16380, false, 1, 12);
  expect(shotAim.pitch).toBe(16384);
});

test("a ray's place in the cone is the seed's alone, laid evenly on the cone's disc, and never outside it", () => {
  const cone = 3;
  const out = [0, 0, 0];
  const look = [0, 0, 0];
  const yaw = 12345;
  const pitch = -2100;
  lookDirection(yaw, pitch, look);
  const a = (yaw / 65536) * 2 * Math.PI;
  const e = (pitch / 65536) * 2 * Math.PI;
  const right = [-Math.cos(a), 0, Math.sin(a)];
  const up = [-Math.sin(a) * Math.sin(e), Math.cos(e), -Math.cos(a) * Math.sin(e)];
  const radial = new Array<number>(10).fill(0);
  const around = new Array<number>(12).fill(0);
  const N = 1000;
  for (let n = 0; n < N; n++) {
    const seed = aimSeed(0x10003 + n * 7, 4000 + n);
    shotDir(seed, 0, yaw, pitch, cone, out);
    expect(Math.abs(Math.hypot(out[0]!, out[1]!, out[2]!) - 1)).toBeLessThan(1e-12);
    const off = apart(out, look);
    expect(off).toBeLessThanOrEqual(cone + 1e-9);
    // On the disc one metre out: its distance from the middle, squared, over the disc's, is even from 0 to 1.
    const d = out[0]! * look[0]! + out[1]! * look[1]! + out[2]! * look[2]!;
    const u = (out[0]! * right[0]! + out[1]! * right[1]! + out[2]! * right[2]!) / d;
    const v = (out[0]! * up[0]! + out[1]! * up[1]! + out[2]! * up[2]!) / d;
    const r2 = (u * u + v * v) / Math.tan(cone * DEG) ** 2;
    radial[Math.min(9, Math.floor(r2 * 10))]!++;
    around[Math.floor(((Math.atan2(v, u) + Math.PI) / (2 * Math.PI)) * 12) % 12]!++;
  }
  const chi = (bins: number[]): number => bins.reduce((s, o) => s + (o - N / bins.length) ** 2 / (N / bins.length), 0);
  // The 0.1% points of chi-square with 9 and 11 degrees of freedom.
  expect(chi(radial)).toBeLessThan(27.88);
  expect(chi(around)).toBeLessThan(31.26);
  // The same seed, the same ray; another ray of the same shot (W3's pellets) another place.
  const first = [0, 0, 0];
  const again = [0, 0, 0];
  shotDir(77, 0, yaw, pitch, cone, first);
  shotDir(77, 0, yaw, pitch, cone, again);
  expect(again).toEqual(first);
  shotDir(77, 1, yaw, pitch, cone, again);
  expect(apart(again, first)).toBeGreaterThan(0);
  // A cone of nothing is the look itself.
  shotDir(77, 0, yaw, pitch, 0, again);
  expect(again).toEqual(look);
  // The seed is the handle's and the tick's: either changes it.
  expect(new Set([aimSeed(5, 9), aimSeed(6, 9), aimSeed(5, 10), aimSeed(9, 5)]).size).toBe(4);
});

/**
 * A thousand rays, and a body fired, moved and turned by a fixed but irregular sequence with its aim state and every shot's
 * aim, each hashed. It uses only what it is given, so its own source runs under Node too.
 */
function scenario(m: {
  hash32: typeof hash32; shotDir: typeof shotDir; aimShot: typeof aimShot; shotAim: typeof shotAim; stepAction: typeof stepAction; stepAim: typeof stepAim;
  actionOut: typeof actionOut; Body: typeof Body; hashBytes: typeof hashBytes; w: WeaponParams; survivor: MoveParams;
}): { rays: number; fight: number; shots: number; bloomMost: number } {
  const bytes = new Float64Array(3 * 1000);
  const out = [0, 0, 0];
  for (let n = 0; n < 1000; n++) {
    m.shotDir(m.hash32(n, 99), n % 3, (n * 2654435761) & 0xffff, ((n * 40503) % 32768) - 16384 + 0.25, (n % 50) * 0.4, out);
    bytes.set(out, n * 3);
  }
  const b = new m.Body();
  b.rounds = 6;
  b.reloadTo = 6;
  const log: number[] = [];
  let was = 0;
  let s = 12345;
  let shots = 0;
  let bloomMost = 0;
  for (let t = 1; t <= 3000; t++) {
    s = m.hash32(s, t);
    // The primary and the secondary button.
    const buttons = (s & 1 ? 4 : 0) | (s & 2 ? 16 : 0);
    b.vx = ((s >>> 8) & 15) * 0.5;
    b.vz = ((s >>> 12) & 15) * 0.5 - 3;
    b.grounded = (s & 0x10000) === 0;
    b.stance = (s >>> 17) % 3;
    m.stepAction(b, buttons, buttons & ~was, m.w);
    m.stepAim(b, m.w, t);
    was = buttons;
    if (b.rounds === 0) b.rounds = 6;
    log.push(b.bloom, b.kick);
    bloomMost = Math.max(bloomMost, b.bloom);
    if (m.actionOut.fire) {
      m.aimShot(b, buttons, m.w, m.survivor, s & 0xffff, (s >>> 3) % 8000, (s & 4) !== 0, 0x20007, t);
      log.push(m.shotAim.yaw, m.shotAim.pitch, m.shotAim.cone);
      shots++;
    }
  }
  return { rays: m.hashBytes(new Uint8Array(bytes.buffer)), fight: m.hashBytes(new Uint8Array(Float64Array.from(log).buffer)), shots, bloomMost };
}

const node = Bun.which("node");
const nodeMajor = node ? Number((Bun.spawnSync([node, "--version"]).stdout.toString().match(/v(\d+)/) ?? [])[1]) : 0;

test("the rays and the aim are the same bits on every engine: pinned hashes of a thousand rays and of a fuzzed fight, under JavaScriptCore and V8", () => {
  expect([BTN_PRIMARY, BTN_SECONDARY]).toEqual([4, 16]);
  const got = scenario({ hash32, shotDir, aimShot, shotAim, stepAction, stepAim, actionOut, Body, hashBytes, w: params("pistol"), survivor });
  expect(got.shots).toBeGreaterThan(100);
  expect(got.bloomMost).toBeGreaterThan(BLOOM_SHOT);
  expect([got.rays, got.fight]).toEqual([RAYS_HASH, FIGHT_HASH]);
  if (nodeMajor < 24) return;
  // Node is a development tool here, used only as a second JavaScript engine (as tests/server/determinism.test.ts).
  const script = [
    'import { hash32, shotDir, aimShot, shotAim, stepAim } from "./shared/sim/aim.ts";',
    'import { stepAction, actionOut } from "./shared/sim/weapon.ts";',
    'import { Body } from "./shared/sim/character.ts";',
    'import { hashBytes } from "./shared/hash.ts";',
    'import { CORE_CONTENT } from "./content/core.ts";',
    'import { compileContent } from "./shared/content/registry.ts";',
    "const reg = compileContent(CORE_CONTENT).registry;",
    `const scenario = ${scenario.toString()};`,
    'const got = scenario({ hash32, shotDir, aimShot, shotAim, stepAction, stepAim, actionOut, Body, hashBytes, w: reg.weapon[reg.index.get("core:pistol")], survivor: reg.move[reg.index.get("core:survivor")] });',
    'console.log(got.rays + " " + got.fight);',
  ].join("\n");
  const run = Bun.spawnSync([node!, "--no-warnings", "--input-type=module", "-e", script], { cwd: import.meta.dir + "/../.." });
  expect(run.stderr.toString()).toBe("");
  expect(run.stdout.toString().trim()).toBe(`${RAYS_HASH} ${FIGHT_HASH}`);
});

test("bloom and kick travel in the body and step the same after it, as a predicting client's and the server's do", () => {
  const w = params("pistol");
  const server = still();
  const client = still();
  server.rounds = client.rounds = 6;
  server.reloadTo = client.reloadTo = 6;
  const wire = new BitWriter(64);
  let was = 0;
  for (let t = 1; t <= 400; t++) {
    const buttons = hash32(t, 3) & 1 ? BTN_PRIMARY : 0;
    tick(server, w, buttons, buttons & ~was, t);
    tick(client, w, buttons, buttons & ~was, t);
    was = buttons;
    // Every tenth tick the server's body is sent and the client takes it, as a correction would.
    if (t % 10 === 0) {
      wire.reset();
      writeBody(wire, server);
      readBody(new BitReader(wire.bytes()), client);
    }
    expect(client.equals(server)).toBe(true);
  }
});

test("through a scope a long gun sways, less crouched and much less prone but never not at all; a pistol and an unaimed rifle do not", () => {
  const rifle = params("rifle");
  const most = (stance: number): number => {
    let m = 0;
    for (let t = 0; t < 600; t++) {
      sway(rifle, stance, 0x30001, t);
      m = Math.max(m, Math.hypot(swayOut.yaw, swayOut.pitch));
    }
    return m / UNITS_PER_DEGREE;
  };
  const [stand, crouch, prone] = [most(0), most(STANCE_CROUCH), most(STANCE_PRONE)];
  expect(stand).toBeGreaterThan(0.3);
  expect(stand).toBeLessThanOrEqual(0.35 * Math.hypot(1, 0.7));
  expect(crouch).toBeLessThan(stand * 0.6);
  expect(prone).toBeLessThan(stand * 0.25);
  expect(prone).toBeGreaterThan(0);
  // It wanders slowly: a tick moves it a small part of its reach.
  sway(rifle, 0, 0x30001, 100);
  const y0 = swayOut.yaw;
  sway(rifle, 0, 0x30001, 101);
  expect(Math.abs(swayOut.yaw - y0) / UNITS_PER_DEGREE).toBeLessThan(0.03);
  // Two shooters sway apart.
  sway(rifle, 0, 0x30001, 100);
  const mine = swayOut.yaw;
  sway(rifle, 0, 0x40001, 100);
  expect(swayOut.yaw).not.toBe(mine);
  // The pistol does not sway through a scope (Scope Attachment); the rifle only aimed and scoped.
  sway(params("pistol"), 0, 0x30001, 100);
  expect([swayOut.yaw, swayOut.pitch]).toEqual([0, 0]);
  const b = still();
  sway(rifle, 0, 0x30001, 100);
  const swung = { ...swayOut };
  aimShot(b, BTN_SECONDARY, rifle, survivor, 500, 200, true, 0x30001, 100);
  expect([shotAim.yaw, shotAim.pitch, shotAim.cone]).toEqual([500 + swung.yaw, 200 + swung.pitch, 0]);
  aimShot(b, 0, rifle, survivor, 500, 200, true, 0x30001, 100);
  expect([shotAim.yaw, shotAim.pitch]).toEqual([500, 200]);
  aimShot(b, BTN_SECONDARY, rifle, survivor, 500, 200, false, 0x30001, 100);
  expect([shotAim.yaw, shotAim.pitch]).toEqual([500, 200]);
});

const RAYS_HASH = 3894479009;
// The fight is fought with the pistol's timings, so it moved with its 2.1 shots a second and 3.33 s reload (Simple Pistol).
const FIGHT_HASH = 755183566;
