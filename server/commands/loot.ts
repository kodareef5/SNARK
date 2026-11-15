// The console's loot roll: what a loot definition gives (shared/sim/loot.ts), minted into the caller's bag. One seed gives the
// same items every time; without one the seed is the tick, so a journal replayed at that tick rolls what was rolled.

import { parseNumber } from "../../shared/console.ts";
import { Rng } from "../../shared/rng.ts";
import { FLAG_BLUEPRINT, QUALITY_NAMES } from "../../shared/sim/items.ts";
import { rollLoot } from "../../shared/sim/loot.ts";
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
  ];
}
