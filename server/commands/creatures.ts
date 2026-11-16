import { parseNumber } from "../../shared/console.ts";
import { named, type Console, type ConsoleCommand } from "../console.ts";

const needsBody = "this needs a body; you have none right now";

export function addCreatureCommands(con: Console): void {
  const commands: ConsoleCommand[] = [
    {
      name: "forcetame",
      usage: "",
      help: "The creature you are looking at, up to 30 metres away, is your tribe's: no taming, and nothing for doing it well.",
      admin: true,
      run(ctx) {
        const c = ctx.client;
        const host = ctx.host;
        const me = c ? host.records.byPid.get(c.pid) : undefined;
        if (!c || c.ent < 0 || !me) return needsBody;
        const hit = host.death.target(c, 30);
        const rec = hit >= 0 ? host.records.byPid.get(host.world.ents.pid[hit]!) : undefined;
        if (!rec || rec.keyHash !== null || rec.egg !== null || !rec.vitals || host.world.reg.defs[rec.kind]?.type !== "species") return "no creature there";
        if (rec.team === me.team) return "it is yours already";
        if (!host.taming.give(rec, me, 0, "forced")) return "a module refused it";
        return `tamed ${host.world.reg.ids[rec.kind]} level ${rec.genome ? rec.genome.level : 1}`;
      },
    },
    {
      name: "gmsummon",
      usage: "<species> [level]",
      help: "Put a creature four metres in front of you, your tribe's already and wearing its saddle where one is made for it. It may be named without its pack: pteranodon for core:pteranodon.",
      admin: true,
      run(ctx, args) {
        const c = ctx.client;
        const host = ctx.host;
        const me = c ? host.records.byPid.get(c.pid) : undefined;
        if (!c || c.ent < 0 || !me) return needsBody;
        const reg = host.world.reg;
        const kind = named(reg, args[0], "species");
        if (typeof kind === "string") return kind;
        const id = reg.ids[kind]!;
        if (reg.vehicle[kind]) return `${id} is a vehicle: spawn it`;
        const level = args[1] === undefined ? 1 : parseNumber(args[1]);
        if (!Number.isInteger(level) || level < 1 || level > 1000) return "level must be a whole number from 1 to 1000";
        const a = (c.heldYaw / 65536) * 2 * Math.PI;
        const e = host.spawnCreature(id, c.body.x + Math.sin(a) * 4, c.body.z + Math.cos(a) * 4, level, "admin");
        if (e < 0) return "no room for it there";
        const rec = host.records.byPid.get(host.world.ents.pid[e]!);
        if (!rec || !host.taming.give(rec, me, 0, "forced")) return "a module refused it";
        const saddle = reg.saddleFits.indexOf(kind);
        const tamed = `summoned ${id} level ${rec.genome ? rec.genome.level : level}, tamed`;
        if (saddle <= 0 || rec.grown !== 0) return tamed;
        // Worn as a saddle put on through its inventory is: out of the ledger until it is taken off.
        rec.saddle = saddle;
        host.records.dirty.add(rec.pid);
        host.refreshBody(rec);
        return `${tamed} and saddled`;
      },
    },
    {
      name: "hatch",
      usage: "[all]",
      help: "The egg you are looking at hatches now; with all, every egg in the world, and everything being carried is born.",
      admin: true,
      run(ctx, args) {
        const host = ctx.host;
        if (args[0] === "all") {
          let n = 0;
          for (const rec of [...host.records.byPid.values()]) if (rec.egg && host.breeding.hatchNow(rec)) n++;
          return `${n} hatched`;
        }
        const c = ctx.client;
        if (!c || c.ent < 0) return needsBody;
        const hit = host.death.target(c, 8);
        const rec = hit >= 0 ? host.records.byPid.get(host.world.ents.pid[hit]!) : undefined;
        return rec && host.breeding.hatchNow(rec) ? "hatched" : "no egg there";
      },
    },
    {
      name: "destroywilddinos",
      usage: "",
      help: "Every wild creature is gone, with what it carried. The spawn regions fill again a group at each check.",
      admin: true,
      run(ctx) {
        const spawner = ctx.host.spawner;
        if (!spawner) return "the wild are not kept here: the map has no spawn region, or a -NoDinos flag is given";
        return `destroyed ${spawner.wipe()} wild creatures`;
      },
    },
    {
      name: "grow",
      usage: "",
      help: "The young creature you are looking at, up to 30 metres away, is grown now.",
      admin: true,
      run(ctx) {
        const c = ctx.client;
        const host = ctx.host;
        if (!c || c.ent < 0) return needsBody;
        const hit = host.death.target(c, 30);
        const rec = hit >= 0 ? host.records.byPid.get(host.world.ents.pid[hit]!) : undefined;
        return rec && host.breeding.growNow(rec) ? "grown" : "nothing young there";
      },
    },
  ];
  con.add(...commands);
}
