// The weapons program's fire modes, reloads and blows (planning/reference/weapons-plan.md, M4 and W2) through a server and a
// predicting client: what the client's action step counted is what the server loaded, fired and struck.
import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import type { ClientSession } from "../../client/core/session.ts";
import type { Def, ItemDef, WeaponFacet } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { CMD_SELECT } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_MELEE, BTN_PRIMARY, BTN_RELOAD } from "../../shared/sim/character.ts";
import { ACT_NONE, ACT_RELOAD } from "../../shared/sim/weapon.ts";
import { V_TORPOR } from "../../shared/sim/vitals.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness, type Pilot } from "../fixtures/net.ts";

const TICK_MS = 1000 / 30;

/** The core content with some weapons' facets changed. */
function registryWith(changes: Readonly<Record<string, Partial<WeaponFacet>>>): Registry {
  const defs = CORE_CONTENT.map((d): Def => {
    const change = d.type === "item" ? changes[d.id] : undefined;
    return change ? { ...(d as ItemDef), weapon: { ...(d as ItemDef).weapon!, ...change } } : d;
  });
  const made = compileContent(defs);
  expect(made.errors).toEqual([]);
  return made.registry!;
}

/** A pistol that fires while held and loads a round each 0.66 s, as the fabricated firearms and the pump-action will. */
const AUTO = registryWith({ "core:pistol": { auto: true, reloadEach: true, reload: 0.66 }, "core:grenade": { draw: 1.6 } });

/** A survivor with cheats on level ground looking north, holding `weapon` from `kit` once it is loaded. */
function setup(registry: Registry, kit: string, weapon: string, link = {}) {
  const h = new Harness({}, 1, 60, { dev: true }, registry);
  const s = h.join("ada", link);
  h.run(500);
  h.say(s, "enablecheats");
  const pilot = h.pilots[0]!;
  const g = flatGround(h, 12, 12);
  const at = { x: g.x + 6, z: g.z + 1.5 };
  h.say(s, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  pilot.yaw = 0;
  pilot.pitch = 0;
  h.run(300);
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(s)]!)!;
  h.say(s, `kit ${kit}`);
  const slot = takeInHand(h, s, registry.index.get(`core:${weapon}`)!);
  h.run(6000);
  const inv = h.host.items.inv(rec);
  const corrections = (): number => s.stats.corrections + s.stats.stateCorrections;
  return { h, s, pilot, rec, inv, slot, at, corrections };
}

/** Holds `bit` down for `ticks` ticks, then lets it go and waits `after` ms. */
function press(h: Harness, pilot: Pilot, bit: number, ticks: number, after = 300): void {
  pilot.buttons |= bit;
  h.run(TICK_MS * ticks);
  pilot.buttons &= ~bit;
  h.run(after);
}

/** The server's and the client's count of rounds in the held weapon, and what the weapon holds on the books. */
function counts(h: Harness, s: ClientSession, loaded: number): number[] {
  return [h.world.ents.rounds[h.ent(s)]!, s.own.rounds, loaded];
}

test("an automatic gun held empties its clip a pause apart and reloads it a round at a time, predicted without a correction", () => {
  const { h, s, pilot, inv, slot, corrections } = setup(AUTO, "pistol", "pistol");
  const round = AUTO.index.get("core:round_pistol")!;
  // It loaded itself a round at a time on being taken in hand.
  expect([inv.loaded[slot], inv.total(round), s.own.act]).toEqual([6, 54, ACT_NONE]);
  const before = corrections();
  const shots = h.host.projectiles;
  const pause = AUTO.weapon[AUTO.index.get("core:pistol")!]!.swingTicks;
  // Held for five pauses and a little, it fires six; let go, no more.
  press(h, pilot, BTN_PRIMARY, pause * 5 + 4, 100);
  expect(shots.fired).toBe(6);
  expect(inv.loaded[slot]).toBe(0);
  // Empty, it reloads by itself, one round each 20 ticks: after two and a half rounds' time, two are in.
  h.run(TICK_MS * (pause + 50) - 100);
  expect(s.own.act).toBe(ACT_RELOAD);
  expect(counts(h, s, inv.loaded[slot]!)).toEqual([2, 2, 2]);
  h.run(5000);
  expect(counts(h, s, inv.loaded[slot]!)).toEqual([6, 6, 6]);
  expect([inv.total(round), s.own.act, shots.fired]).toEqual([48, ACT_NONE, 6]);
  expect(corrections()).toBe(before);
  expect(h.host.items.audit()).toEqual([]);
});

test("a press of the primary button ends a reload of a round at a time once the round under way is in, and fires if held", () => {
  const { h, s, pilot, inv, slot, corrections } = setup(AUTO, "pistol", "pistol");
  const before = corrections();
  const shots = h.host.projectiles;
  // Each tap waits out the pistol's 14 ticks between shots (2.1 a second, Simple Pistol).
  for (let n = 0; n < 4; n++) press(h, pilot, BTN_PRIMARY, 2, 500);
  expect([shots.fired, inv.loaded[slot]]).toEqual([4, 2]);
  // Reload, and tap the trigger halfway through the second round: that round goes in and no more, and nothing fires.
  press(h, pilot, BTN_RELOAD, 2, 0);
  h.run(TICK_MS * 28);
  press(h, pilot, BTN_PRIMARY, 2, 2000);
  expect(counts(h, s, inv.loaded[slot]!)).toEqual([4, 4, 4]);
  expect([shots.fired, s.own.act]).toEqual([4, ACT_NONE]);
  // Held through the round under way, it fires on the tick that round is in.
  press(h, pilot, BTN_RELOAD, 2, 0);
  h.run(TICK_MS * 8);
  press(h, pilot, BTN_PRIMARY, 16, 1000);
  expect(shots.fired).toBe(5);
  expect(counts(h, s, inv.loaded[slot]!)).toEqual([4, 4, 4]);
  expect(corrections()).toBe(before);
  expect(h.host.items.audit()).toEqual([]);
});

test("a gun's butt strikes for ARK's 10 and 14 torpor, spends no round and wears the gun a use", () => {
  const { h, pilot, rec, inv, slot, at, corrections } = setup(AUTO, "pistol", "pistol");
  const e = h.host.spawnCreature("core:dummy", at.x, at.z + 1.5, 1);
  const drec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  h.world.ents.yaw[e] = drec.yaw = 32768;
  h.run(200);
  pilot.pitch = Math.atan2(1.25 - 1.62, 1.5);
  h.run(200);
  const before = corrections();
  const combat = h.host.combat;
  const hits = combat.hits;
  const dur = inv.dur[slot]!;
  const torpor = h.host.survival.value(drec, V_TORPOR);
  pilot.buttons |= BTN_MELEE;
  h.run(TICK_MS * 8);
  const got = h.host.survival.value(drec, V_TORPOR) - torpor;
  pilot.buttons &= ~BTN_MELEE;
  h.run(1000);
  // Held for eight ticks, the button struck once.
  expect(combat.hits).toBe(hits + 1);
  expect([combat.last.by, combat.last.victim, combat.last.damage]).toEqual([rec.pid, drec.pid, 10]);
  // The dummy sheds 4 torpor a second; at most a tenth of a second passed.
  expect(got).toBeGreaterThan(13.5);
  expect(got).toBeLessThanOrEqual(14 + 1e-4);
  expect([inv.loaded[slot], dur - inv.dur[slot]!, h.host.projectiles.fired]).toEqual([6, 1, 0]);
  expect(corrections()).toBe(before);
  expect(h.host.items.audit()).toEqual([]);
});

test("a charged throw leaves on release, its draw how long it was held", () => {
  const { h, pilot, rec, corrections } = setup(AUTO, "grenades", "grenade");
  const draws: number[] = [];
  const combat = h.host.combat;
  combat.onThrow.on((_c, _r, _item, _quality, draw) => void draws.push(draw));
  const before = corrections();
  const grenade = AUTO.index.get("core:grenade")!;
  const inv = h.host.items.inv(rec);
  // A click throws nothing; a hold of 24 ticks half charges it; a hold past 48 fully.
  press(h, pilot, BTN_PRIMARY, 2);
  press(h, pilot, BTN_PRIMARY, 25);
  press(h, pilot, BTN_PRIMARY, 80);
  expect(draws.length).toBe(2);
  expect(draws[0]).toBeGreaterThan(0.4);
  expect(draws[0]).toBeLessThan(0.6);
  expect(draws[1]).toBe(1);
  expect(inv.total(grenade)).toBe(8);
  expect(corrections()).toBe(before);
  h.run(6000);
  expect(h.host.items.audit()).toEqual([]);
});

test("the ledger stays whole through a fuzz of firing, reloading, striking and swapping, and the client agrees with the server", () => {
  const registry = registryWith({ "core:pistol": { reloadEach: true, reload: 0.66 }, "core:rifle": { auto: true } });
  const { h, s, pilot, inv, slot } = setup(registry, "pistol", "pistol");
  h.say(s, "kit rifle");
  takeInHand(h, s, registry.index.get("core:rifle")!, 1);
  const select = (k: number): void => {
    s.command(CMD_SELECT, (w) => w.u8(k));
  };
  const rng = new Rng(7);
  const bits = [BTN_PRIMARY, BTN_PRIMARY, BTN_RELOAD, BTN_MELEE];
  for (let n = 0; n < 120; n++) {
    const pick = rng.u32() % 6;
    if (pick === 5) select(rng.u32() % 2);
    else if (pick === 4) h.run(rng.u32() % 1500);
    else press(h, pilot, bits[pick]!, 1 + (rng.u32() % 40), rng.u32() % 300);
  }
  pilot.buttons = 0;
  select(0);
  h.run(8000);
  expect(h.host.items.audit()).toEqual([]);
  // A reload cut short leaves the clip part full, the same on both sides and on the books.
  const [server, client, books] = counts(h, s, inv.loaded[slot]!);
  expect([server, client]).toEqual([books!, books!]);
  expect(books).toBeGreaterThan(0);
  expect(h.host.projectiles.fired).toBeGreaterThan(10);
});

test("over a slow line that drops packets, an automatic clip and its reload end with the server, client and books agreeing", () => {
  const { h, s, pilot, inv, slot } = setup(AUTO, "pistol", "pistol", { latencyMs: 100, loss: 0.05 });
  expect(inv.loaded[slot]).toBe(6);
  const pause = AUTO.weapon[AUTO.index.get("core:pistol")!]!.swingTicks;
  press(h, pilot, BTN_PRIMARY, pause * 3 + 4, 500);
  expect(h.host.projectiles.fired).toBe(4);
  press(h, pilot, BTN_RELOAD, 3, 0);
  h.run(TICK_MS * 30);
  press(h, pilot, BTN_PRIMARY, 3, 3000);
  expect(counts(h, s, inv.loaded[slot]!)).toEqual([4, 4, 4]);
  expect(h.host.projectiles.fired).toBe(4);
  expect(h.host.items.audit()).toEqual([]);
});
