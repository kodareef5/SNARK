// Cheats for trying combat: something to hit, and things to hit it with.

import type { ItemDef } from "../../shared/content/defs.ts";
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
  ];
  con.add(...commands);
}
