// Cheats for trying combat: something to hit, and things to hit it with.

import { parseNumber } from "../../shared/console.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import { V_TORPOR } from "../../shared/sim/vitals.ts";
import { SLOT_OF_ZONE, ZONE_COUNT, ZONE_NAMES } from "../../shared/anim/human.ts";
import { PIECE_SCALE } from "../../shared/sim/damage.ts";
import { QUALITY_MUL } from "../../shared/sim/items.ts";
import { RULE_NAMES, type RuleName } from "../rules.ts";
import type { Console, ConsoleCommand } from "../console.ts";
import type { Host } from "../host.ts";
import type { EntityRecord } from "../records.ts";

/** What each kit holds: item names without their namespace, and how many. */
const KITS: Readonly<Record<string, readonly (readonly [string, number])[]>> = {
  tools: [["hatchet", 1], ["pick", 1], ["spear", 1]],
  bow: [["bow", 1], ["arrow_stone", 40], ["arrow_tranq", 20], ["arrow_flame", 20]],
  crossbow: [["crossbow", 1], ["arrow_stone", 40]],
  rifle: [["rifle", 1], ["round_rifle", 30], ["dart_tranq", 20], ["scope", 1]],
  pistol: [["pistol", 1], ["round_pistol", 60]],
  grenades: [["grenade", 10]],
};
const TIERS: readonly string[] = ["cloth", "hide", "chitin", "flak"];
const PIECES: readonly string[] = ["hat", "shirt", "gloves", "pants", "boots"];

/** Create one of an item and put it in the armor slot it is worn in. False if the record has no such slot. */
export function dress(host: Host, rec: EntityRecord, item: number): boolean {
  const inv = host.items.inv(rec);
  const slot = host.world.reg.wearSlot[item]!;
  if (inv.armor < 0 || slot < 0 || host.items.mint(rec, item, 1) !== 1) return false;
  for (let s = 0; s < inv.bag; s++) {
    if (inv.item[s] === item) return host.items.move(rec, s, rec, inv.armor + slot, 1) === 1;
  }
  return false;
}

export function addCombatCommands(con: Console): void {
  const commands: ConsoleCommand[] = [
    {
      name: "dummy",
      usage: "[cloth|hide|chitin|flak]",
      help: "Stand a target three metres in front of you, bare or in a full set of armor. It takes hits by zone as a survivor does.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        if (!c || c.ent < 0) return "this needs a body; you have none right now";
        const host = ctx.host;
        const reg = host.world.reg;
        const tier = args[0];
        if (tier !== undefined && !TIERS.includes(tier)) return `no armor "${tier}"; one of ${TIERS.join(", ")}`;
        const a = (c.heldYaw / 65536) * 2 * Math.PI;
        const e = host.spawnCreature("core:dummy", c.body.x + Math.sin(a) * 3, c.body.z + Math.cos(a) * 3, 1);
        if (e < 0) return "no room for it there";
        const ents = host.world.ents;
        const rec = host.records.byPid.get(ents.pid[e]!)!;
        // It faces whoever put it there.
        ents.yaw[e] = rec.yaw = (c.heldYaw + 32768) & 0xffff;
        if (tier !== undefined) for (const piece of PIECES) dress(host, rec, reg.index.get(`core:${tier}_${piece}`)!);
        host.refreshBody(rec);
        return tier === undefined ? "a bare dummy" : `a dummy in ${tier}`;
      },
    },
    {
      name: "kit",
      usage: `<${[...Object.keys(KITS), ...TIERS].join("|")}>`,
      help: "Give yourself a set of things: a weapon with what it fires, or five pieces of armor.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        const rec = c ? ctx.host.records.byPid.get(c.pid) : undefined;
        if (!c || !rec) return "this needs a survivor";
        const reg = ctx.host.world.reg;
        const name = args[0] ?? "";
        const kit = KITS[name] ?? (TIERS.includes(name) ? PIECES.map((p) => [`${name}_${p}`, 1] as const) : null);
        if (!kit) return `no kit "${name}"; one of ${[...Object.keys(KITS), ...TIERS].join(", ")}`;
        const out: string[] = [];
        for (const [what, n] of kit) {
          const item = reg.index.get(`core:${what}`)!;
          const made = ctx.host.items.mint(rec, item, n);
          const def = reg.defs[item] as ItemDef;
          out.push(`${made} ${def.label ?? what}${made < n ? ` (${n - made} did not fit)` : ""}`);
        }
        return `gave ${out.join(", ")}`;
      },
    },
    {
      name: "armor",
      usage: `<${TIERS.join("|")}|off>`,
      help: "Put a full set of armor on yourself, in place of whatever you wear; or take off what you wear.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        const rec = c ? ctx.host.records.byPid.get(c.pid) : undefined;
        if (!c || !rec) return "this needs a survivor";
        const tier = args[0] ?? "";
        if (tier !== "off" && !TIERS.includes(tier)) return `no armor "${tier}"; one of ${TIERS.join(", ")}, or off`;
        const items = ctx.host.items;
        const inv = items.inv(rec);
        if (inv.armor < 0) return "you cannot wear armor";
        // What is worn now is destroyed, on the books; the new set is made, on the books.
        for (let k = 0; k < PIECES.length; k++) if (inv.item[inv.armor + k] !== 0) items.burn(rec, inv.armor + k, 1);
        if (tier === "off") return "armor off";
        const reg = ctx.host.world.reg;
        let worn = 0;
        for (const piece of PIECES) if (dress(ctx.host, rec, reg.index.get(`core:${tier}_${piece}`)!)) worn++;
        return worn === PIECES.length ? `wearing ${tier}` : `wearing ${worn} pieces of ${tier}; your bag had no room to make the rest`;
      },
    },
    {
      name: "hitzones",
      usage: "",
      help: "What a hit on each part of your body is multiplied by, the armor over each part, and the last blow the server resolved.",
      admin: false,
      run(ctx) {
        const c = ctx.client;
        const rec = c ? ctx.host.records.byPid.get(c.pid) : undefined;
        if (!c || !rec) return "this needs a survivor";
        const reg = ctx.host.world.reg;
        const zones = reg.zoneMul[rec.kind];
        if (!zones) return "your body has no zones";
        const inv = ctx.host.items.inv(rec);
        const lines: string[] = [];
        for (let z = 1; z < ZONE_COUNT; z++) {
          const at = inv.armor >= 0 ? inv.armor + SLOT_OF_ZONE[z]! : -1;
          const rating = at >= 0 && inv.item[at] !== 0 && inv.dur[at]! > 0 ? reg.armor[inv.item[at]!]! * (QUALITY_MUL[inv.quality[at]!] ?? 1) * PIECE_SCALE : 0;
          lines.push(`${ZONE_NAMES[z]!.padEnd(11)} x${zones[z]}  armor ${Math.round(rating)}  takes ${Math.round((100 / (100 + rating)) * zones[z]! * 100)}%`);
        }
        const last = ctx.host.combat.last;
        if (ctx.host.combat.hits > 0) lines.push(`last blow: ${Number(last.damage.toFixed(1))} to the ${ZONE_NAMES[last.zone] ?? "body"}, ${Number(last.blocked.toFixed(1))} stopped by armor${last.killed ? ", fatal" : ""}`);
        return lines.join("\n");
      },
    },
    {
      name: "rule",
      usage: "[name value]",
      help: "Show the server's rules, or set one: playerDamage, creatureDamage, structureDamage, selfDamage (multipliers), headshots, damageNumbers (0 or 1).",
      admin: true,
      run(ctx, args) {
        const rules = ctx.host.rules;
        if (args.length === 0) return RULE_NAMES.map((name) => `${name} ${rules.values[name]}`).join("\n");
        const value = parseNumber(args[1]);
        if (args.length !== 2 || !ctx.host.setRule(args[0]!, value)) return `usage: rule <${RULE_NAMES.join("|")}> <0 to 100>`;
        return `${args[0]} ${rules.values[args[0] as RuleName]}`;
      },
    },
    {
      name: "audit",
      usage: "",
      help: "Check every item in the world against the ledger of what was made and destroyed.",
      admin: true,
      run(ctx) {
        const wrong = ctx.host.items.audit();
        return wrong.length === 0 ? "the ledger balances" : wrong.join("\n");
      },
    },
    {
      name: "place",
      usage: "<structure>",
      help: "Stand something built three metres in front of you, facing you: wall, wall_wood, wall_thatch, wall_metal, crate, and the rest.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        if (!c || c.ent < 0) return "this needs a body; you have none right now";
        const world = ctx.host.world;
        const reg = world.reg;
        const kind = reg.index.get(args[0] ?? "") ?? reg.index.get(`core:${args[0]}`);
        const def = kind === undefined ? null : reg.defs[kind]!;
        if (kind === undefined || def?.type !== "structure") return `no structure "${args[0] ?? ""}"`;
        const a = (c.heldYaw / 65536) * 2 * Math.PI;
        const x = c.body.x + Math.sin(a) * 3;
        const z = c.body.z + Math.cos(a) * 3;
        // It is its builder's team's, as anything built is.
        const ref = world.structs.add(kind, x, world.hf.heightAt(x, z) + def.half[1], z, c.heldYaw, ctx.host.records.byPid.get(c.pid)?.team ?? 0, def.hp);
        return ref < 0 ? "no room for it there" : `placed ${def.id} (${def.hp} health)`;
      },
    },
    {
      name: "buff",
      usage: "<name> [seconds] | off <name>",
      help: "Put something on yourself that acts for a time (burning, stunned, tranquilized, injured, god), or take it off.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        const rec = c ? ctx.host.records.byPid.get(c.pid) : undefined;
        if (!c || !rec) return "this needs a survivor";
        const reg = ctx.host.world.reg;
        const off = args[0] === "off";
        const name = (off ? args[1] : args[0]) ?? "";
        const buff = reg.index.get(name) ?? reg.index.get(`core:${name}`);
        if (buff === undefined || reg.defs[buff]!.type !== "buff") return `no buff "${name}"`;
        if (off) return ctx.host.buffs.take(rec, buff) ? `${reg.ids[buff]} off` : `you are not under ${reg.ids[buff]}`;
        const seconds = args[1] === undefined ? undefined : parseNumber(args[1]);
        if (seconds !== undefined && !(seconds > 0 && seconds <= 86400)) return "seconds must be above 0 and at most 86400";
        ctx.host.buffs.give(rec, buff, 0, seconds);
        return `${reg.ids[buff]} on`;
      },
    },
    {
      name: "hurt",
      usage: "<points> [torpor]",
      help: "Take that much of your own health, and add that much torpor.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        const rec = c ? ctx.host.records.byPid.get(c.pid) : undefined;
        if (!c || !rec) return "this needs a survivor";
        const points = parseNumber(args[0]);
        const torpor = args[1] === undefined ? 0 : parseNumber(args[1]);
        if (!(points >= 0) || !(torpor >= 0)) return "usage: hurt <points> [torpor]";
        const taken = ctx.host.survival.hurt(rec, points, 0);
        if (torpor > 0 && !rec.dead) ctx.host.survival.add(rec, V_TORPOR, torpor);
        return `took ${Number(taken.toFixed(1))} health${torpor > 0 ? ` and ${torpor} torpor` : ""}`;
      },
    },
  ];
  con.add(...commands);
}
