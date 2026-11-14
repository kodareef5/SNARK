import type { Console, ConsoleCommand } from "../console.ts";

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
        host.taming.give(rec, me, 0);
        return `tamed ${host.world.reg.ids[rec.kind]} level ${rec.genome ? rec.genome.level : 1}`;
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
