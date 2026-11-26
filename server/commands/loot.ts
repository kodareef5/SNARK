// The console's loot roll: what a loot definition gives (shared/sim/loot.ts), minted into the caller's bag. One seed gives the
// same items every time; without one the seed is the tick, so a journal replayed at that tick rolls what was rolled.

import { parseNumber } from "../../shared/console.ts";
import { Rng } from "../../shared/rng.ts";
import { FLAG_BLUEPRINT, QUALITY_NAMES } from "../../shared/sim/items.ts";
import { rollLoot } from "../../shared/sim/loot.ts";
import { rollSource, tierOf } from "../../shared/supply/compile.ts";
import { named, type ConsoleCommand } from "../console.ts";

export function lootCommands(): ConsoleCommand[] {
  return [
    {
      name: "loot",
      usage: "<loot> [seed]",
      help: "Roll a loot definition into your inventory, as a crate it fills would be. The same seed gives the same items.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        const rec = c ? ctx.host.records.byPid.get(c.pid) : undefined;
        if (!c || !rec) return "this needs a survivor";
        const reg = ctx.host.world.reg;
        const kind = named(reg, args[0], "loot");
        if (typeof kind === "string") return kind;
        const def = reg.defs[kind];
        if (def?.type !== "loot") return `no loot "${args[0] ?? ""}"`;
        const seed = args[1] === undefined ? ctx.host.world.tick : parseNumber(args[1]);
        if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return "seed must be a whole number from 0 to 4294967295";
        const drops = rollLoot(def, new Rng(seed), (id) => reg.index.get(id) ?? 0, reg.blueprints);
        const items = ctx.host.items;
        const lines: string[] = [];
        let lost = 0;
        for (const d of drops) {
          const made = items.mint(rec, d.item, d.count, d.quality, 0, -1, "loot", d.blueprint ? FLAG_BLUEPRINT : 0);
          lost += d.count - made;
          if (made > 0) lines.push(`${made} ${reg.ids[d.item]}${d.blueprint ? " blueprint" : ""}${d.quality > 0 || d.blueprint ? ` (${QUALITY_NAMES[d.quality]})` : ""}`);
        }
        const got = lines.length > 0 ? lines.join(", ") : "nothing";
        return `${reg.ids[kind]} seed ${seed}: ${got}${lost > 0 ? `; ${lost} did not fit` : ""}`;
      },
    },
    {
      name: "lootsource",
      usage: "<source> [level] [seed]",
      help: "Roll a source of the drop book into your inventory, as a thing it is the loot of would hold if its chance came up: lootsource body/apex 120. The same seed gives the same items.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        const rec = c ? ctx.host.records.byPid.get(c.pid) : undefined;
        if (!c || !rec) return "this needs a survivor";
        const reg = ctx.host.world.reg;
        const compiled = ctx.host.supply.compiled();
        const sources = compiled.book.sources ?? [];
        const source = sources.find((s) => s.key === args[0]);
        if (!source) return `no source "${args[0] ?? ""}"; there are: ${sources.map((s) => s.key).join(" ")}`;
        const level = args[1] === undefined ? 1 : parseNumber(args[1]);
        if (!Number.isInteger(level) || level < 0 || level > 100000) return "level must be a whole number";
        const seed = args[2] === undefined ? ctx.host.world.tick : parseNumber(args[2]);
        if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return "seed must be a whole number from 0 to 4294967295";
        const tier = tierOf(source, level);
        const items = ctx.host.items;
        const lines: string[] = [];
        for (const d of rollSource(compiled, { ...source, chance: 1 }, tier, new Rng(seed))) {
          const made = items.mint(rec, d.item, d.count, d.quality, 0, -1, "loot", d.blueprint ? FLAG_BLUEPRINT : 0);
          if (made > 0) lines.push(`${made} ${reg.ids[d.item]}${d.blueprint ? " blueprint" : ""}${d.quality > 0 || d.blueprint ? ` (${QUALITY_NAMES[d.quality]})` : ""}`);
        }
        return `${source.key}${tier === "" ? "" : ` at ${tier}`}, seed ${seed}: ${lines.length > 0 ? lines.join(", ") : "nothing"}`;
      },
    },
  ];
}
