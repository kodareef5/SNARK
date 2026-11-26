// Commands that change a made survivor's look (server/people/look.ts): cutting and dyeing one's own hair with what one
// carries, and an admin's offer to make a survivor again in the creator.

import { RESULT_OK } from "../../shared/net/protocol.ts";
import { HAIR_STAGES } from "../../shared/people/hair.ts";
import type { Console, ConsoleCommand } from "../console.ts";
import type { Host } from "../host.ts";
import { NAME_UNCLEAR } from "../names.ts";
import { DYE_MAIN, DYE_SECOND, PART_BEARD, PART_HAIR } from "../people/look.ts";
import type { EntityRecord } from "../records.ts";
import { sessionNamed } from "./social.ts";

const needsSurvivor = "this needs a survivor; you have none right now";

/** The first slot of the survivor's inventory whose item `take` accepts, or -1. */
function slotOf(host: Host, rec: EntityRecord, take: (item: number) => boolean): number {
  const inv = host.items.inv(rec);
  for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0 && take(inv.item[s]!)) return s;
  return -1;
}

export function addLookCommands(con: Console): void {
  const commands: ConsoleCommand[] = [
    {
      name: "cut",
      usage: "<hair|beard> [stage]",
      examples: ["cut hair 0", "cut beard 1"],
      help: `Cut your own hair or beard with scissors you carry, to a stage from 0 (as styled) to ${HAIR_STAGES.length - 1}; with no stage, one shorter.`,
      admin: false,
      run(ctx, args) {
        const host = ctx.host, c = ctx.client;
        const rec = c && c.ent >= 0 ? host.records.byPid.get(c.pid) : undefined;
        if (!c || !rec) return needsSurvivor;
        const what = args[0] === "hair" ? PART_HAIR : args[0] === "beard" ? PART_BEARD : -1;
        if (what < 0) return "say hair or beard";
        const stage = args[1] === undefined ? -1 : Number(args[1]);
        if (args[1] !== undefined && !(Number.isInteger(stage) && stage >= 0 && stage < HAIR_STAGES.length)) return `a stage is 0 to ${HAIR_STAGES.length - 1}`;
        const slot = slotOf(host, rec, (item) => host.world.reg.groomCut[item] === 1);
        if (slot < 0) return "you carry no scissors";
        const item = host.items.inv(rec).item[slot]!;
        const done = host.relook.groomed(c, slot, item, 0, what, stage);
        return done.code === RESULT_OK ? "Cut." : done.why || "That cannot be cut.";
      },
    },
    {
      name: "dye",
      usage: "<hair|second> [dye]",
      examples: ["dye hair", "dye second core:hair_dye_red"],
      help: "Dye your own hair, or its second colour, with a hair dye you carry: the one named, or the first.",
      admin: false,
      run(ctx, args) {
        const host = ctx.host, c = ctx.client;
        const rec = c && c.ent >= 0 ? host.records.byPid.get(c.pid) : undefined;
        if (!c || !rec) return needsSurvivor;
        const what = args[0] === "hair" ? DYE_MAIN : args[0] === "second" ? DYE_SECOND : -1;
        if (what < 0) return "say hair or second";
        const reg = host.world.reg, named = args[1] === undefined ? -1 : (reg.index.get(args[1]) ?? reg.index.get(`core:${args[1]}`) ?? 0);
        if (named === 0) return `no item "${args[1]}"`;
        const slot = slotOf(host, rec, (item) => reg.groomHair[item]! >= 0 && (named < 0 || item === named));
        if (slot < 0) return "you carry no such hair dye";
        const done = host.relook.groomed(c, slot, host.items.inv(rec).item[slot]!, 0, what, 0);
        return done.code === RESULT_OK ? "Dyed." : done.why || "That cannot be dyed.";
      },
    },
    {
      name: "remake",
      usage: "[survivor] [off]",
      examples: ["remake", "remake Ada", "remake Ada off"],
      help: "Let a survivor, or yourself, make itself again in the creator: its look, kept with all it has. Off takes the offer back.",
      admin: true,
      run(ctx, args) {
        const host = ctx.host;
        const off = args[args.length - 1] === "off";
        const name = (off ? args.slice(0, -1) : args).join(" ");
        let rec: EntityRecord | undefined;
        if (name === "") rec = ctx.client ? host.records.byPid.get(ctx.client.pid) : undefined;
        else {
          const here = sessionNamed(host, name);
          if (here === NAME_UNCLEAR) return `more than one survivor here could be "${name}"; give the name exactly`;
          rec = here ? host.records.byPid.get(here.pid) : [...host.records.byPid.values()].find((r) => r.kind === host.relook.survivor && r.name === name);
        }
        if (!rec || rec.kind !== host.relook.survivor || !rec.look) return name === "" ? needsSurvivor : `no survivor named "${name}"`;
        host.relook.offer(rec, !off);
        return off ? `${rec.name} may no longer remake itself.` : `${rec.name} may make itself again in the creator.`;
      },
    },
  ];
  con.add(...commands);
}
