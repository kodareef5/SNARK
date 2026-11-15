// Rounds that explode, the structure factor, armor penetration and the flare (planning/reference/weapons-plan.md, W6: M8,
// M12 and the flare of M9), against ark.wiki.gg Grenade, Table of explosives (patch 257), Rocket Propelled Grenade, Metal
// Arrow and Flare Gun, read on 2026-11-15.
import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { RemoteSample } from "../../client/core/session.ts";
import type { Source } from "../../server/combat.ts";
import { FLARE_FALL, FLARE_TICKS } from "../../server/projectiles.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { EVENT_BLAST, EVENT_HIT } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY, stanceEye } from "../../shared/sim/character.ts";
import { DMG_EXPLOSIVE, DMG_PIERCE, PIECE_SCALE, harm, hit, resetHit, resolveDamage } from "../../shared/sim/damage.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { W_THROWN } from "../../shared/sim/weapon.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";
import { dress } from "../../server/commands/combat.ts";

const TICK_MS = 1000 / 30;

// Test rounds of the fabricated wave, which is not built: ARK's rocket launcher and its rocket ("250 (7.5 meter radius)",
// Rocket Propelled Grenade; 7,350 to wood and 2,205 to metal, Table of explosives), a round with a blast that does not fly,
// and two rounds alike but for a metal arrow's "-90% armor bypass" (Metal Arrow).
const TEST: readonly Def[] = [
  { type: "item", class: "weapon", id: "core:test_launcher", stack: 1, weapon: { kind: "gun", ammo: ["core:test_rocket", "core:test_shell"], clip: 1, reload: 2, uses: 100, mesh: "core:rifle", hold: "rifle", structures: 7350 / 250 } },
  { type: "item", class: "ammo", id: "core:test_rocket", stack: 100, ammo: { damage: 250, type: "explosive", speed: 80, gravity: 9.81, blast: 7.5, mesh: "core:dart" } },
  { type: "item", class: "ammo", id: "core:test_shell", stack: 100, ammo: { damage: 100, type: "explosive", blast: 3 } },
  { type: "item", class: "weapon", id: "core:test_gun", stack: 1, weapon: { kind: "gun", ammo: ["core:test_plain", "core:test_piercer"], clip: 1, reload: 1, uses: 100, mesh: "core:rifle", hold: "rifle" } },
  { type: "item", class: "ammo", id: "core:test_plain", stack: 100, ammo: { damage: 55, type: "pierce" } },
  { type: "item", class: "ammo", id: "core:test_piercer", stack: 100, ammo: { damage: 55, type: "pierce", pierce: 0.9 } },
];

let built: Registry | null = null;
function registry(): Registry {
  if (built) return built;
  const made = compileContent([...CORE_CONTENT, ...TEST]);
  expect(made.errors).toEqual([]);
  return (built = made.registry!);
}

/** Ada at the south end of level ground looking north, with a range ahead of her. */
function range(friend = false) {
  const reg = registry();
  const h = new Harness({}, 1, 60, { dev: true }, reg);
  const s = h.join("ada");
  const bob = friend ? h.join("bob") : null;
  h.run(500);
  h.say(s, "enablecheats");
  const g = flatGround(h, 40, 40);
  const at = { x: g.x + 20, z: g.z + 2, y: g.y };
  h.say(s, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  if (bob) {
    h.say(bob, "enablecheats");
    h.say(bob, `tp ${(at.x + 3).toFixed(3)} ${at.z.toFixed(3)}`);
  }
  const pilot = h.pilots[0]!;
  pilot.yaw = pilot.pitch = 0;
  h.run(300);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  const ents = h.world.ents;
  const structs = h.world.structs;
  const id = (name: string): number => reg.index.get(`core:${name}`)!;
  const dummy = (dx: number, dz: number): number => h.host.spawnCreature("core:dummy", at.x + dx, at.z + dz, 1);
  const health = (e: number): number => h.host.survival.value(h.host.records.byPid.get(ents.pid[e]!)!, V_HEALTH);
  const hp = (ref: number): number => {
    const t = structs.chunks[Math.floor(ref / 65536)];
    return t && t.kind[ref & 0xffff] !== 0 ? t.hp[ref & 0xffff]! : 0;
  };
  /** Turns to the point (dx, y, dz) from her, waits, and fires once. */
  const fire = (dx: number, y: number, dz: number): void => {
    const me = h.ent(s);
    const eye = ents.y[me]! + stanceEye(reg.move[ents.kind[me]!]!, ents.stance[me]!);
    const far = Math.hypot(dx, dz);
    pilot.yaw = Math.atan2(dx, dz);
    pilot.pitch = Math.atan2(y - eye, far);
    h.run(300);
    pilot.buttons |= BTN_PRIMARY;
    h.run(TICK_MS * 3);
    pilot.buttons &= ~BTN_PRIMARY;
    h.run(800);
  };
  return { h, s, bob, pilot, rec, reg, at, ents, structs, id, dummy, health, hp, fire };
}

test("the grenade does ARK's 175 to a body and, by its structure factor, what it did before to every material", () => {
  const { h, rec, reg, at, ents, structs, id, dummy, health, hp } = range();
  const grenade = id("grenade");
  // "175 (6 meter radius)" (Grenade); 788 to thatch and wood, 1,838 to stone, 237 to metal (Table of explosives, patch 257).
  expect([reg.damage[grenade], reg.blast[grenade], reg.structureMul[grenade]! * 175, reg.weapon[grenade]!.kind]).toEqual([175, 6, 788, W_THROWN]);
  const src = (item: number, base: number): Source => ({ by: rec, x: at.x, z: at.z, item, base, type: DMG_EXPLOSIVE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 });
  // Bare at her feet, a dummy takes all 175, once.
  const d = dummy(0, 20);
  h.run(300);
  const full = health(d);
  const hits = h.host.combat.hits;
  h.host.combat.blast(src(grenade, reg.damage[grenade]!), ents.x[d]!, ents.y[d]! + 0.05, ents.z[d]!, reg.blast[grenade]!);
  expect([full - health(d), h.host.combat.hits - hits]).toEqual([175, 1]);
  // Each material, half a metre from a blast, takes what a grenade of 788 to everything did: the same float, and the table's
  // figure. The old grenade is a source of 788 whose item has no factor of its own (0, bare hands).
  const rows: [string, number, number][] = [];
  for (const [k, [wall, table]] of [["thatch", 788], ["wood", 788], ["stone", 1838], ["metal", 237]].map(([m, t], k) => [k, [`wall_${m}`, t]] as const)) {
    const kind = id(wall as string);
    const [nowRef, wasRef] = [0, 1].map((side) => structs.add(kind, at.x - 16 + side * 8, at.y + 1.5, at.z + 4 + k * 8, 0, 0, 10000));
    for (const [ref, s] of [[nowRef!, src(grenade, reg.damage[grenade]!)], [wasRef!, src(0, 788)]] as const) {
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      h.host.combat.blast(s, t.x[ref & 0xffff]!, t.y[ref & 0xffff]!, t.z[ref & 0xffff]! - 0.6, reg.blast[grenade]!);
    }
    const now = 10000 - hp(nowRef!);
    rows.push([wall as string, now, table as number]);
    expect([wall, now]).toEqual([wall, 10000 - hp(wasRef!)]);
    expect(Math.abs(now - (table as number))).toBeLessThan(0.6);
  }
  expect(rows.map(([w, n]) => [w, Math.round(n)])).toEqual([["wall_thatch", 788], ["wall_wood", 788], ["wall_stone", 1838], ["wall_metal", 237]]);
});

test("a rocket ends on a wall and harms what is round it once each, the wall by its launcher's factor, and not a body behind the wall", () => {
  const { h, s, rec, reg, at, structs, id, dummy, health, hp, fire } = range();
  h.host.items.mint(rec, id("test_launcher"), 1);
  h.host.items.mint(rec, id("test_rocket"), 5);
  h.run(300);
  takeInHand(h, s, id("test_launcher"));
  h.run(2600);
  // A wooden wall 15 m north; a dummy before it and to one side, one behind it, one out of reach.
  const wall = structs.add(id("wall_wood"), at.x, at.y + 1.5, at.z + 15, 0, 0, 10000);
  const [side, behind, away] = [dummy(2.5, 13), dummy(0, 16.5), dummy(12, 15)];
  h.run(300);
  const full = health(side);
  const [hits, walls, blasts] = [h.host.combat.hits, h.host.combat.structureHits, h.host.projectiles.blasts];
  const events = s.events.length;
  fire(0, at.y + 1.5, 15);
  expect(h.host.projectiles.blasts - blasts).toBe(1);
  expect(s.events.slice(events).filter((ev) => ev.kind === EVENT_BLAST).map((ev) => ev.far)).toEqual([7.5]);
  // The wall takes 250 times 29.4, the table's 7,350 to wood, once.
  expect([h.host.combat.structureHits - walls, 10000 - hp(wall)]).toEqual([1, 7350]);
  // The dummy at its side, 2.7 m from the blast at its nearest, takes the falloff's share once; the others none.
  expect(h.host.combat.hits - hits).toBe(1);
  expect(full - health(side)).toBeGreaterThan(150);
  expect(full - health(side)).toBeLessThan(250);
  expect([health(behind), health(away)]).toEqual([full, full]);
  // Against metal it does 7,350 times our metal's 0.3008, fitted to the grenade's 237 / 788, within a third of a percent of
  // the table's 2,205 (D435's check of a new explosive against the table's other columns).
  const metal = reg.structTakes[id("wall_metal")]![DMG_EXPLOSIVE]!;
  expect(Math.abs((7350 * metal) / 2205 - 1)).toBeLessThan(0.004);
});

test("a rocket that hits a body straight on does the blast's whole to it and no more, and a shell that does not fly goes off where it ends", () => {
  const { h, s, rec, at, ents, id, dummy, health, fire } = range();
  h.host.items.mint(rec, id("test_launcher"), 1);
  h.host.items.mint(rec, id("test_rocket"), 1);
  h.run(300);
  takeInHand(h, s, id("test_launcher"));
  h.run(2600);
  const d = dummy(-6, 12);
  h.run(300);
  const full = health(d);
  const [hits, events] = [h.host.combat.hits, s.events.length];
  fire(-6, ents.y[d]! + 1, 12);
  // A dummy mends a little each second, so the blow is read as it landed.
  const last = h.host.combat.last;
  expect([last.victim, last.damage, h.host.combat.hits - hits, h.host.projectiles.blasts]).toEqual([h.world.ents.pid[d], 250, 1, 1]);
  expect(full - health(d)).toBeCloseTo(250, 0);
  expect(s.events.slice(events).filter((ev) => ev.kind === EVENT_HIT).length).toBe(1);
  // The shell has no speed: its one ray ends on the ground before a dummy and goes off there, 3 m across.
  h.host.items.mint(rec, id("test_shell"), 2);
  h.run(2600);
  const e = dummy(6, 11);
  h.run(300);
  const before = health(e);
  fire(6, at.y, 9);
  expect(h.host.projectiles.blasts).toBe(2);
  expect(before - health(e)).toBeGreaterThan(0);
  expect(before - health(e)).toBeLessThan(100);
  // Into the sky it meets nothing and goes off nowhere.
  h.run(1500);
  fire(0, at.y + 400, 10);
  expect(h.host.projectiles.blasts).toBe(2);
  expect(h.host.items.audit()).toEqual([]);
});

test("a round that pierces counts a tenth of the armor it meets, as ARK's metal arrow does", () => {
  // The rule alone: a torso piece of 100 meets five times its rating (DEV11), and a pierce of 0.9 leaves a tenth of that.
  const through = (pierce: number): number => {
    resetHit();
    hit.base = 55;
    hit.type = DMG_PIERCE;
    hit.armor = 100 * PIECE_SCALE;
    hit.pierce = pierce;
    resolveDamage();
    return harm.health;
  };
  expect([through(0), through(0.9), through(1)]).toEqual([(55 * 100) / 600, (55 * 100) / 150, 55]);
  // Through the server: the same dummy in flak, shot in the body with a plain round and then with one that pierces.
  const { h, s, rec, id, ents, dummy, fire } = range();
  h.host.items.mint(rec, id("test_gun"), 1);
  h.host.items.mint(rec, id("test_plain"), 1);
  h.run(300);
  takeInHand(h, s, id("test_gun"));
  h.run(1500);
  const d = dummy(0, 10);
  const drec = h.host.records.byPid.get(ents.pid[d]!)!;
  for (const part of ["hat", "shirt", "gloves", "pants", "boots"]) dress(h.host, drec, id(`flak_${part}`));
  h.run(300);
  const shirt = h.world.reg.armor[id("flak_shirt")]! * PIECE_SCALE;
  fire(0, ents.y[d]! + 1.1, 10);
  const plain = { ...h.host.combat.last };
  h.host.items.mint(rec, id("test_piercer"), 1);
  h.run(1500);
  fire(0, ents.y[d]! + 1.1, 10);
  const pierced = { ...h.host.combat.last };
  expect([plain.zone, pierced.zone]).toEqual([pierced.zone, plain.zone]);
  expect(plain.damage).toBeCloseTo((55 * 100) / (100 + shirt), 3);
  expect(pierced.damage).toBeCloseTo((55 * 100) / (100 + shirt * 0.1), 3);
  expect(pierced.blocked).toBeLessThan(plain.blocked);
});

test("the flare gun is ARK's, fires once and is spent, and its flare rises, sinks slowly, harms nothing, is seen by others and goes out where it lands", () => {
  const { h, s, bob, pilot, rec, reg, ents, id } = range(true);
  const gun = id("flare_gun");
  // Flare Gun: weight 0.5, one flare and then broken, made in the inventory in 5 s at level 15 for 6 points, of 4 wood,
  // 2 fiber, 10 sparkpowder and 2 gunpowder.
  expect(reg.defs[gun]).toMatchObject({ weight: 0.5, stack: 1, weapon: { kind: "thrown", uses: 1 }, ammo: { damage: 0, light: { reach: 40, color: 10 } } });
  expect(reg.defs[gun]!.type === "item" && reg.defs[gun]!.craft).toMatchObject({ seconds: 5, needs: [{ item: "core:wood", count: 4 }, { item: "core:fiber", count: 2 }, { item: "core:sparkpowder", count: 10 }, { item: "core:gunpowder", count: 2 }] });
  expect(reg.defs.find((d) => d?.type === "engram" && d.item === "core:flare_gun")).toMatchObject({ level: 15, cost: 6 });
  expect([reg.ammoLight[gun], reg.ammoLightColor[gun]]).toEqual([40, 10]);
  h.say(s, "kit flare");
  takeInHand(h, s, gun);
  h.run(1000);
  const inv = h.host.items.inv(rec);
  expect(inv.total(gun)).toBe(3);
  const shots = h.host.projectiles;
  const eye = ents.y[h.ent(s)]! + stanceEye(reg.move[ents.kind[h.ent(s)]!]!, ents.stance[h.ent(s)]!);
  // Straight up, as the page advises.
  pilot.pitch = 1.55;
  h.run(300);
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 4);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(TICK_MS * 30);
  expect([shots.flareCount, inv.total(gun)]).toEqual([1, 2]);
  const f = shots.flareAt(0);
  const prop = f.ent;
  expect(ents.kind[prop]).toBe(id("flare_live"));
  // Bob, standing by, sees it as an entity.
  const seen = new RemoteSample();
  bob!.sampleRemote(seen);
  expect(Array.from(seen.kind.subarray(0, seen.count))).toContain(id("flare_live"));
  // It rises some 80 m (40 m/s against 9.81), then sinks no faster than FLARE_FALL.
  let top = f.y;
  let fastest = 0;
  let ticks = 0;
  const hits = h.host.combat.hits;
  while (shots.flareCount > 0 && ticks < FLARE_TICKS + 30) {
    h.run(TICK_MS);
    ticks++;
    if (shots.flareCount === 0) break;
    const g = shots.flareAt(0);
    top = Math.max(top, g.y);
    fastest = Math.min(fastest, g.vy);
  }
  expect(top - eye).toBeGreaterThan(75);
  expect(top - eye).toBeLessThan(85);
  expect(fastest).toBeGreaterThanOrEqual(-FLARE_FALL);
  // About 4 s up and 33 s down, out where it landed, its prop gone.
  expect(ticks / 30).toBeGreaterThan(30);
  expect(ticks).toBeLessThan(FLARE_TICKS);
  expect([shots.flareCount, ents.kind[prop] === id("flare_live") && (ents.flags[prop]! & 1) !== 0]).toEqual([0, false]);
  expect(h.host.combat.hits).toBe(hits);
  expect(h.host.items.audit()).toEqual([]);
});
