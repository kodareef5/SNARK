// The console's supply drops (server/supply.ts): call one, list them, bring one down, take one away, and look at the
// drop book. The admin page does the same acts through the same calls. Admin commands are journaled as typed.

import { parseNumber } from "../../shared/console.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { QUALITY_NAMES } from "../../shared/sim/items.ts";
import type { ConsoleCommand } from "../console.ts";
import type { Drop } from "../supply.ts";

const USAGE = "usage: supply call <here | x z> <tier> <class> [ringed | plain] [seconds] | list | land <id | all> [seconds] | cancel <id | all> | open <id> | book";

export function supplyCommands(): ConsoleCommand[] {
  return [
    {
      name: "supply",
      usage: "call <here | x z> <tier> <class> [ringed | plain] [seconds] | list | land <id | all> [seconds] | cancel <id | all> | open <id> | book",
      help: "Supply drops. `call` calls one of a tier and class of the drop book at a place, landing after the book's notice or after `seconds`; `list` shows those that are live; `land` brings a pending one down now, or in `seconds`; `cancel` takes one away; `open` lists what a landed one holds; `book` sums up the drop book in force.",
      examples: ["supply call here blue arms", "supply call 2100 1840 red voyage ringed 45", "supply list", "supply land all", "supply cancel 3", "supply book"],
      admin: true,
      run(ctx, args) {
        const { supply, world, records } = ctx.host;
        const tick = world.tick;
        const secs = (ticks: number): string => `${Math.max(0, Math.round(ticks / TICK_RATE))} s`;
        const line = (d: Drop): string => {
          const state = supply.state(d);
          const when = d.left > 0 ? "" : d.landed ? `, ${secs(d.end - tick)} left${d.opened ? ", opened" : ""}` : `, lands in ${secs(d.land - tick)}`;
          return `${d.id}: ${d.ringed ? "ringed " : ""}${d.tierKey} ${d.clsKey} at ${d.x.toFixed(0)} ${d.z.toFixed(0)}, ${state}${when}${d.circuit === "" ? "" : `, circuit ${d.circuit}`}`;
        };
        const which = (name: string | undefined): Drop[] | string => {
          if (name === "all") return supply.drops.filter((d) => d.left === 0);
          const d = supply.get(parseNumber(name));
          return d && d.left === 0 ? [d] : `no live drop "${name ?? ""}"`;
        };
        const verb = args[0];
        if (verb === "list") return supply.drops.length === 0 ? "no drops are live" : supply.drops.map(line).join("\n");
        if (verb === "book") {
          const c = supply.compiled();
          const book = c.book;
          const store = ctx.host.supplyBook;
          return [
            `drop book revision ${book.revision}${store.starter ? " (the starter book)" : ""}${store.kept ? "" : ", not kept: this world has no save"}`,
            `${book.tiers.length} tiers (${book.tiers.map((t) => t.key).join(", ")}), ${book.classes.length} classes (${book.classes.map((k) => k.key).join(", ")})`,
            `${c.tables.size} tables, ${c.report.dormant.length} dormant, ${c.report.waiting.length} ids waiting for the game to have them`,
            `${book.circuits.length} circuits, ${book.sites.length} sites; ${supply.live()} drops live, ${supply.calls} called and ${supply.landings} landed since the start`,
            ...book.circuits.map((k) => {
              const st = supply.circuits.get(k.key);
              return `circuit ${k.key}: ${!k.on || !st ? "off" : `looks in ${secs(st.due - tick)}${st.why === "" ? "" : `; last time, ${st.why}`}`}, ${k.sites.length === 0 ? "open ground" : `${k.sites.length} sites`}`;
            }),
            ...(supply.overrides.size === 0 ? [] : [`ConfigOverrideSupplyCrateItems gives the tables of ${[...supply.overrides].map(([tier, t]) => `${tier}${t.plain && t.ringed ? "" : t.ringed ? " (ringed)" : " (plain)"}`).join(", ")}`]),
          ].join("\n");
        }
        if (verb === "call") {
          const here = args[1] === "here";
          const body = ctx.client ? records.byPid.get(ctx.client.pid) : undefined;
          const e = body ? records.entOf.get(body.pid) : undefined;
          if (here && e === undefined) return "this needs a survivor in the world";
          const x = here ? world.ents.x[e!]! : parseNumber(args[1]);
          const z = here ? world.ents.z[e!]! : parseNumber(args[2]);
          const rest = args.slice(here ? 2 : 3);
          if (Number.isNaN(x) || Number.isNaN(z) || rest.length < 2 || rest.length > 4) return USAGE;
          let ringed: boolean | undefined;
          let notice: number | undefined;
          for (const extra of rest.slice(2)) {
            if (extra === "ringed" || extra === "plain") ringed = extra === "ringed";
            else if (Number.isFinite(parseNumber(extra)) && parseNumber(extra) >= 0) notice = parseNumber(extra);
            else return USAGE;
          }
          const d = supply.call({ x, z, tier: rest[0]!, cls: rest[1]!, ringed, notice, source: "console" });
          return typeof d === "string" ? d : `called ${line(d)}`;
        }
        if (verb === "land") {
          const drops = which(args[1]);
          if (typeof drops === "string") return drops;
          const seconds = args[2] === undefined ? 0 : parseNumber(args[2]);
          if (!(seconds >= 0)) return USAGE;
          const out = drops.filter((d) => !d.landed).map((d) => supply.hurry(d, seconds) || `drop ${d.id} lands in ${secs(d.land - tick)}`);
          return out.length === 0 ? "none of them is pending" : out.join("\n");
        }
        if (verb === "cancel") {
          const drops = which(args[1]);
          if (typeof drops === "string") return drops;
          for (const d of drops) supply.cancel(d);
          return drops.length === 0 ? "no drops are live" : `cancelled ${drops.map((d) => d.id).join(", ")}`;
        }
        if (verb === "open") {
          const d = supply.get(parseNumber(args[1]));
          const box = d && d.pid !== 0 ? records.byPid.get(d.pid) : undefined;
          if (!d || !box?.inv) return `no landed drop "${args[1] ?? ""}"`;
          const reg = world.reg;
          const held: string[] = [];
          for (let s = 0; s < box.inv.cap; s++) {
            const item = box.inv.item[s]!;
            if (item === 0) continue;
            const blueprint = (box.inv.flags[s]! & 1) !== 0;
            held.push(`${box.inv.count[s]} ${reg.ids[item]!.replace(/^core:/, "")}${blueprint ? " blueprint" : ""}${box.inv.quality[s]! > 0 ? ` (${QUALITY_NAMES[box.inv.quality[s]!]})` : ""}`);
          }
          return `${line(d)}\n${held.join(", ")}`;
        }
        return USAGE;
      },
    },
  ];
}
