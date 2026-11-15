// The weapons program's contracts (planning/reference/weapons-plan.md, W0): the numbers it took, the wire fields it added,
// and the stubs later projects build on, each read by nothing yet. A project that builds one moves its pin here in the same
// change.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT, CORE_PACK } from "../../content/core.ts";
import { AMMO } from "../../content/items/ammo.ts";
import { EXPLOSIVES } from "../../content/items/explosives.ts";
import { ITEMS } from "../../content/items/index.ts";
import { WEAPONS } from "../../content/items/weapons.ts";
import { CLASSES, FIELDS, classRow, defFaults } from "../../shared/content/classes.ts";
import type { BuffDef, Def, ItemDef } from "../../shared/content/defs.ts";
import { compilePacks, type ContentPack } from "../../shared/content/packs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import * as P from "../../shared/net/protocol.ts";
import { Body } from "../../shared/sim/character.ts";
import { EntityStore } from "../../shared/sim/entities.ts";
import { FLAG_BLUEPRINT, FLAG_ON } from "../../shared/sim/items.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const root = join(import.meta.dir, "../..");

test("protocol 13 is the weapons program's, and it took no command, own component, event, button or saved component", () => {
  // 14 is the cluster's, which took CMD_TRAVEL (31), 15 the beds', 16 the flyers' (tests/unit/contracts.test.ts), and 17 the
  // vehicles' (tests/integration/vehicle-contracts.test.ts).
  expect(P.PROTOCOL_VERSION).toBe(17);
  // EVENT_NAME_BYTES is a size, not a kind of event.
  const most = (prefix: string): number => Math.max(...Object.entries(P).filter(([k]) => k.startsWith(prefix) && k !== "EVENT_NAME_BYTES").map(([, v]) => v as number));
  expect([most("CMD_"), most("OWN_"), most("EVENT_"), P.BUTTON_BITS]).toEqual([31, 16, 7, 10]);
  // FLAG_ON, W7's: the next slot flag after the blueprint's, the same bit on the slot and on the wire.
  expect([P.SLOT_BLUEPRINT, P.SLOT_ON, FLAG_BLUEPRINT, FLAG_ON]).toEqual([1, 2, 1, 2]);
  const store = readFileSync(join(root, "server/persist/codec.ts"), "utf8");
  expect(Math.max(...[...store.matchAll(/const COMP_\w+ = (\d+);/g)].map((m) => Number(m[1])))).toBe(22);
  // DEADLINE_ 14 is W5's if a cloud's end needs one; 12 and 13 stay the item program's, unused.
  const deadlines = readdirSync(join(root, "server")).filter((f) => f.endsWith(".ts")).flatMap((f) => [...readFileSync(join(root, "server", f), "utf8").matchAll(/export const DEADLINE_\w+ = (\d+);/g)].map((m) => Number(m[1])));
  expect(deadlines.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("a body's bloom and kick travel with it, and every body today has none", () => {
  const a = new Body();
  a.bloom = 200;
  a.kick = 37;
  const w = new BitWriter(64);
  w.bits(5, 3);
  P.writeBody(w, a);
  // 360 bits, the flyers' two counters (20 bits) after them, and the vehicles' two bits: no vehicle, no seat (380 without).
  expect(w.pos).toBe(3 + 382);
  const b = new Body();
  const r = new BitReader(w.bytes());
  r.bits(3);
  P.readBody(r, b);
  expect([r.overflow, b.bloom, b.kick, b.equals(a)]).toEqual([false, 200, 37, true]);
  const c = new Body();
  c.copy(a);
  expect([c.bloom, c.kick]).toEqual([200, 37]);
  c.kick = 0;
  expect(c.equals(a)).toBe(false);
  // The entity store keeps them for the server, and stores what the step left.
  const ents = new EntityStore({ chunksX: 1, chunksZ: 1 }, 4);
  const e = ents.create(1, 1, 1, 1, 0);
  ents.storeBody(e, a);
  const back = new Body();
  ents.loadBody(e, back);
  expect([back.bloom, back.kick]).toEqual([200, 37]);
  expect([new Body().bloom, new Body().kick]).toEqual([0, 0]);
});

test("the ranged gear lives in content/items, each piece once, and is in the core pack", () => {
  const ids = (defs: readonly Def[]): string[] => defs.filter((d) => d.type === "item").map((d) => d.id.slice(5));
  expect(ids(WEAPONS)).toEqual(["bow", "crossbow", "rifle", "pistol", "shotgun", "flare_gun"]);
  expect(ids(AMMO)).toEqual(["arrow_stone", "arrow_tranq", "arrow_flame", "round_rifle", "round_pistol", "round_shotgun", "dart_tranq", "dart_shock", "scope", "silencer", "flashlight", "laser"]);
  // W4 added the bola, with its two buffs and its engram (tests/integration/bola.test.ts); W5 the smoke and poison grenades,
  // the poison's buff and their engrams (tests/integration/clouds.test.ts).
  expect(ids(EXPLOSIVES)).toEqual(["grenade", "bola", "grenade_smoke", "grenade_poison"]);
  expect(EXPLOSIVES.filter((d) => d.type === "buff").map((d) => d.id)).toEqual(["core:entangled", "core:entangle_spent", "core:poisoned"]);
  const all = new Set(CORE_CONTENT.map((d) => `${d.type} ${d.id}`));
  for (const d of [...WEAPONS, ...AMMO, ...EXPLOSIVES]) {
    expect(ITEMS.includes(d)).toBe(true);
    expect(all.has(`${d.type} ${d.id}`)).toBe(true);
    expect(CORE_CONTENT.filter((o) => o.type === d.type && o.id === d.id).length).toBe(1);
  }
  // Each moved item brought its engram (W3 added the shotgun's and its shell's, W5 the two grenades', W6 the flare gun's) and the rename of its old recipe id, and is made as before.
  expect([...WEAPONS, ...AMMO, ...EXPLOSIVES].filter((d) => d.type === "engram").length).toBe(22);
  const pistol = CORE_CONTENT.find((d) => d.id === "core:pistol" && d.type === "item")!;
  // W8 brought its numbers to the wiki's since (tests/unit/ark-weapons.test.ts).
  expect(pistol).toMatchObject({ weight: 5, weapon: { clip: 6, reload: 3.33, interval: 1 / 2.1, uses: 300 }, craft: { seconds: 12, xp: 100.8, needs: [{ item: "core:ingot", count: 60 }, { item: "core:wood", count: 5 }, { item: "core:hide", count: 15 }] } });
});

test("the weapon and ammo facets' stubs wait, as the plan has them", () => {
  // W2 built auto, reloadEach and melee (M4), and W1 spread and recoil (M1, M2): their pins are in the test below,
  // tests/unit/weapon.test.ts and tests/unit/aim.test.ts; W3 pellets and falloff (M3), pinned in tests/integration/pellets.test.ts; W5 the cloud and its class (M7), in tests/integration/clouds.test.ts.
  // W6 built structures, blast, pierce and light (M8, M12, the flare): their pins are below and in
  // tests/integration/explosive-rounds.test.ts. No stub is left in either facet.
  expect([FIELDS.item.weapon!.stubs, FIELDS.item.ammo!.stubs]).toEqual([undefined, undefined]);
  // W4 built the bola's buff fields (M6): their pins are in tests/integration/bola.test.ts.
  expect([FIELDS.buff.only!.waits, FIELDS.buff.survivorSeconds!.waits, FIELDS.buff.after!.waits]).toEqual([undefined, undefined, undefined]);
  expect(classRow("prop/cloud")).toMatchObject({ status: "built", parent: "prop" });
  expect(CLASSES.filter((r) => r.id === "prop/cloud").length).toBe(1);
  // The holo-scope is an attachment kind no item is yet: W7 built its view (tests/integration/attachments.test.ts), and its
  // item waits for the fabricator's wave.
  expect(defFaults({ type: "item", class: "attachment", id: "test:holo", stack: 1, attachment: "holo" })).toEqual([]);
  expect(CORE_CONTENT.some((d) => d.type === "item" && d.attachment === "holo")).toBe(false);
});

/** The rounds that carry a light: reach and colour. */
const LIGHTS: Readonly<Record<string, readonly [number, number]>> = { "core:flare_gun": [40, 10] };

test("every weapon and round today compiles as it did: no stub in its timings, and each stub column at what it means now", () => {
  // W2's: the four ranged weapons strike with ARK's blow (Base Damage); none fires automatically or loads a round at a time.
  const blows = new Set(["core:bow", "core:crossbow", "core:rifle", "core:pistol", "core:shotgun"]);
  // W3's: only the shotgun's shell is shot, and falls off.
  const shot = new Set(["core:round_shotgun"]);
  for (let i = 1; i < reg.defs.length; i++) {
    const w = reg.weapon[i];
    if (w) expect([reg.ids[i], "auto" in w || "reloadEach" in w]).toEqual([reg.ids[i], false]);
    const blow = blows.has(reg.ids[i]!);
    if (w) expect([reg.ids[i], w.meleeTicks, w.meleeStrikeTick]).toEqual(blow ? [reg.ids[i], 15, 5] : [reg.ids[i], undefined, undefined]);
    expect([reg.ids[i], reg.blowDamage[i], Math.round(reg.blowTorpor[i]! * 100) / 100, Math.round(reg.blowReach[i]! * 100) / 100]).toEqual(blow ? [reg.ids[i], 10, 1.4, 2.6] : [reg.ids[i], 0, 0, 0]);
    // W5's: the smoke grenade bursts into 40 s of smoke and the poison grenade into 20 s of gas that poisons.
    const cloud = ({ "core:grenade_smoke": ["core:cloud_smoke", 1200, ""], "core:grenade_poison": ["core:cloud_poison", 600, "core:poisoned"] } as Record<string, [string, number, string]>)[reg.ids[i]!];
    // W6's: only the grenade has a structure factor (788 / 175, D435), and only the flare gun's flare a light.
    expect([reg.ids[i], reg.structureMul[i], reg.cloudProp[i] ? reg.ids[reg.cloudProp[i]!] : "", reg.cloudTicks[i], reg.cloudBuff[i] ? reg.ids[reg.cloudBuff[i]!] : ""]).toEqual([reg.ids[i], reg.ids[i] === "core:grenade" ? 788 / 175 : 1, ...(cloud ?? ["", 0, ""])]);
    expect([reg.ids[i], reg.ammoPellets[i], reg.weaponPellets[i], reg.ammoFalloffFull[i], reg.ammoFalloffNone[i]]).toEqual(shot.has(reg.ids[i]!) ? [reg.ids[i], 10, 0, 10, 40] : [reg.ids[i], 1, 0, 0, 0]);
    const light = LIGHTS[reg.ids[i]!] ?? [0, 0];
    expect([reg.ids[i], reg.ammoBlast[i], reg.ammoPierce[i], reg.ammoLight[i], reg.ammoLightColor[i]]).toEqual([reg.ids[i], 0, 0, ...light]);
  }
});


// A pack that declares every stub of the plan, as its projects will.
const GUN: ItemDef = { id: "arms:gun", type: "item", class: "weapon", stack: 1, weapon: { kind: "gun", ammo: ["arms:shell"], clip: 2, reload: 3.33, interval: 0.35, uses: 300, hold: "rifle", auto: true, reloadEach: true, melee: { damage: 10, torpor: 1.4 }, spread: { hip: 4, aim: 1, move: 3, bloom: 0.5, recover: 6 }, recoil: { kick: 2, recover: 9 }, structures: 2 } };
const SHELL: ItemDef = { id: "arms:shell", type: "item", class: "ammo", stack: 100, ammo: { damage: 64, type: "bullet", pellets: 10, falloff: { full: 5, none: 30 }, blast: 7.5, pierce: 0.4 } };
// A round that carries a light flies (W6): the flare.
const FLARE: ItemDef = { id: "arms:flare", type: "item", class: "ammo", stack: 10, ammo: { damage: 0, type: "fire", speed: 40, light: { reach: 40, color: 3 } } };
const SMOKE: ItemDef = { id: "arms:smoke", type: "item", class: "weapon", stack: 10, weapon: { kind: "thrown", damage: 1, type: "explosive", speed: 18, fuse: 5, blast: 1, uses: 1, hold: "tool", cloud: { prop: "arms:cloud", seconds: 40, buff: "arms:choking" } } };
const CHOKING: BuffDef = { id: "arms:choking", type: "buff", label: "Choking", color: 9, seconds: 30, root: true, only: ["core:dodo"], survivorSeconds: 25, after: "arms:spent" };
const ARMS: readonly Def[] = [GUN, SHELL, FLARE, SMOKE, CHOKING, { id: "arms:cloud", type: "prop", class: "cloud", mesh: "box", color: 2, radius: 4.5, height: 3 }, { id: "arms:spent", type: "buff", label: "Spent", color: 9, seconds: 10 }];
const pack = (defs: readonly Def[]): ContentPack => ({ name: "arms", requires: ["core"], defs: defs as unknown as ContentPack["defs"] });

test("every stub compiles into its column or timing, read by nothing, and what it names is checked", () => {
  const made = compilePacks([CORE_PACK, pack(ARMS)]);
  expect(made.errors).toEqual([]);
  const r = made.registry!;
  const at = (id: string): number => r.index.get(id)!;
  const gun = at("arms:gun");
  expect(r.weapon[gun]).toMatchObject({ auto: true, reloadEach: true, meleeTicks: 15, meleeStrikeTick: 5, coneHip: 4, coneAim: 1, coneMove: 3, coneBloom: 0.5, coneRecover: 0.2, recoilKick: 2, recoilRecover: 0.3 });
  const near = (vs: readonly number[]): number[] => vs.map((v) => Math.round(v * 100) / 100);
  expect(near([r.blowDamage[gun]!, r.blowTorpor[gun]!, r.blowReach[gun]!, r.structureMul[gun]!])).toEqual([10, 1.4, 2.6, 2]);
  const shell = at("arms:shell");
  expect(near([r.ammoPellets[shell]!, r.ammoFalloffFull[shell]!, r.ammoFalloffNone[shell]!, r.ammoBlast[shell]!, r.ammoPierce[shell]!, r.ammoLight[at("arms:flare")]!, r.ammoLightColor[at("arms:flare")]!])).toEqual([10, 5, 30, 7.5, 0.4, 40, 3]);
  const smoke = at("arms:smoke");
  expect([r.cloudProp[smoke], r.cloudTicks[smoke], r.cloudBuff[smoke]]).toEqual([at("arms:cloud"), 1200, at("arms:choking")]);

  const bad = (to: Def): string[] => compilePacks([CORE_PACK, pack(ARMS.map((d) => (d.id === to.id ? to : d)))]).errors;
  expect(bad({ ...FLARE, ammo: { ...FLARE.ammo!, speed: undefined } })).toEqual(["arms:flare: a round that carries a light flies, at its ammo.speed"]);
  expect(bad({ ...SHELL, ammo: { ...SHELL.ammo!, pellets: 0, pierce: 2 } })).toEqual(["arms:shell: ammo.pellets must be a whole number from 1 to 255", "arms:shell: ammo.pierce must be from 0 to 1"]);
  expect(bad({ ...SHELL, ammo: { ...SHELL.ammo!, falloff: { full: 30, none: 5 } } })).toEqual(["arms:shell: ammo.falloff is full from 0 metres or more, and none further than that"]);
  expect(bad({ ...GUN, weapon: { ...GUN.weapon!, spread: { hip: 120, aim: 1 } } })).toEqual(["arms:gun: weapon.spread is in degrees from 0 to 90"]);
  expect(bad({ ...SMOKE, weapon: { ...SMOKE.weapon!, auto: true, cloud: { prop: "core:bag", seconds: 40 } } })).toEqual(["arms:smoke: weapon.auto, reloadEach, spread, recoil and melee are a bow's or gun's", 'arms:smoke: "core:bag" is not a prop/cloud']);
  expect(bad({ ...CHOKING, only: ["core:stone"], after: "core:stone" })).toEqual(['arms:choking: "core:stone" is not a species', 'arms:choking: "core:stone" is not a buff']);
});
