// The console's map events (server/mapevent/events.ts): call one of any kind, list them, bring a coming one in now, bring
// one down, take one away, and look at the kinds and the event book. The events page acts through these lines, so
// what it does is journaled as typed.

import { parseNumber } from "../../shared/console.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { kindOn } from "../../shared/mapevent/book.ts";
import { MAPEVENT_ENDED, MAPEVENT_LIVE, MAPEVENT_NOTICE, MAPEVENT_STATES } from "../../shared/mapevent/wire.ts";
import type { ConsoleCommand } from "../console.ts";
import type { MapEvent } from "../mapevent/events.ts";

const USAGE = "usage: event call <kind> [here] [seconds] [seed] | list | kinds | hurry <id | all> [seconds] | down <id | all> | cancel <id | all> | book";

export function eventCommands(): ConsoleCommand[] {
  return [
    {
      name: "event",
      usage: "call <kind> [here] [seconds] [seed] | list | kinds | hurry <id | all> [seconds] | down <id | all> | cancel <id | all> | book",
      help: "Map events. `call` calls one of a kind, near the survivors in the world or, with `here`, near you, coming after its kind's notice or after `seconds`, made from `seed` where one is given; `list` shows those that are live; `kinds` lists the kinds modules define; `hurry` brings a coming one in now or in `seconds`; `down` brings its craft down where they are; `cancel` ends one; `book` sums up the event book in force.",
      examples: ["event call ufo", "event call ufo here 5", "event list", "event kinds", "event hurry all", "event down 1", "event cancel all", "event book"],
      admin: true,
      run(ctx, args) {
        const { mapEvents, world, records } = ctx.host;
        const tick = world.tick;
        const secs = (ticks: number): string => `${Math.max(0, Math.round(ticks / TICK_RATE))} s`;
        const line = (e: MapEvent): string => {
          let what = MAPEVENT_STATES[e.state]!;
          if (e.state === MAPEVENT_NOTICE) what += `, comes in ${secs(e.start - tick)}`;
          for (const p of mapEvents.views(e)) {
            if (p.type === "craft") what += `; craft ${p.id} ${p.state}${p.state === "flying" || p.state === "falling" || p.state === "rest" ? ` at ${p.x.toFixed(0)} ${p.y.toFixed(0)} ${p.z.toFixed(0)}` : ""}${p.state === "flying" ? `, ${Math.round((100 * p.health) / p.most)}% of its health${p.shield === "none" ? "" : `, its shield ${p.shield}`}` : ""}`;
            else if (p.type === "crate") what += `; crate ${p.id} at ${p.x.toFixed(0)} ${p.z.toFixed(0)}, ${p.stacks} stacks`;
            else what += `; site ${p.id} at ${p.x.toFixed(0)} ${p.z.toFixed(0)}`;
          }
          return `${e.id}: ${e.kind}, ${what}${e.schedule === "" ? ` (${e.source})` : `, schedule ${e.schedule}`}`;
        };
        const which = (name: string | undefined): MapEvent[] | string => {
          if (name === "all") return mapEvents.events.filter((e) => e.state !== MAPEVENT_ENDED);
          const e = mapEvents.get(parseNumber(name));
          return e && e.state !== MAPEVENT_ENDED ? [e] : `no live event "${name ?? ""}"`;
        };
        const verb = args[0];
        if (verb === "list") return mapEvents.events.length === 0 ? "no events are live" : mapEvents.events.map(line).join("\n");
        if (verb === "kinds") {
          if (mapEvents.kinds.size === 0) return "no module defines a kind of map event";
          return [...mapEvents.kinds.values()].map((k) => `${k.def.id} (${k.def.label}, module ${k.module})${k.off ? ": off, its handlers threw" : kindOn(mapEvents.book, k.def.id) ? "" : ": switched off in the book"}`).join("\n");
        }
        if (verb === "book") {
          const book = mapEvents.book;
          const store = ctx.host.eventBook;
          return [
            `event book revision ${book.revision}${store.starter ? " (the starter book)" : ""}${store.kept ? "" : ", not kept: this world has no save"}`,
            `at most ${book.rules.maxLive} live, with ${book.rules.minPlayers} survivors in the world at the least; told of by ${book.announce}`,
            `${mapEvents.live()} live; ${mapEvents.calls} called and ${mapEvents.downs} craft brought down since the start`,
            ...book.schedules.map((s) => {
              const st = mapEvents.schedules.get(s.key);
              return `schedule ${s.key} (${s.kind}): ${!s.on || !st ? "off" : `looks in ${secs(st.due - tick)}${st.why === "" ? "" : `; last time, ${st.why}`}`}`;
            }),
          ].join("\n");
        }
        if (verb === "call") {
          const kind = args[1];
          if (!kind) return USAGE;
          let near: { x: number; z: number }[] | undefined;
          let notice: number | undefined;
          let seed: number | undefined;
          const rest = args.slice(2);
          if (rest[0] === "here") {
            const body = ctx.client ? records.byPid.get(ctx.client.pid) : undefined;
            const e = body ? records.entOf.get(body.pid) : undefined;
            if (e === undefined) return "this needs a survivor in the world";
            near = [{ x: world.ents.x[e]!, z: world.ents.z[e]! }];
            rest.shift();
          }
          if (rest.length > 2) return USAGE;
          if (rest[0] !== undefined) {
            notice = parseNumber(rest[0]);
            if (!(notice >= 0)) return USAGE;
          }
          if (rest[1] !== undefined) {
            seed = parseNumber(rest[1]);
            if (!(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff)) return USAGE;
          }
          const e = mapEvents.call(kind, { source: ctx.client ? "console" : "operator", near, notice, seed });
          return typeof e === "string" ? e : `called ${line(e)}`;
        }
        if (verb === "hurry") {
          const events = which(args[1]);
          if (typeof events === "string") return events;
          const seconds = args[2] === undefined ? 0 : parseNumber(args[2]);
          if (!(seconds >= 0)) return USAGE;
          const out = events.filter((e) => e.state === MAPEVENT_NOTICE).map((e) => mapEvents.hurry(e, seconds) || `event ${e.id} comes in ${secs(e.start - tick)}`);
          return out.length === 0 ? "none of them is coming" : out.join("\n");
        }
        if (verb === "down") {
          const events = which(args[1]);
          if (typeof events === "string") return events;
          const out = events.filter((e) => e.state === MAPEVENT_LIVE).map((e) => {
            const n = mapEvents.downAll(e);
            return n === 0 ? `event ${e.id} has nothing in the sky` : `event ${e.id}: ${n} craft going down`;
          });
          return out.length === 0 ? "none of them is in the sky" : out.join("\n");
        }
        if (verb === "cancel") {
          const events = which(args[1]);
          if (typeof events === "string") return events;
          for (const e of events) mapEvents.cancel(e);
          return events.length === 0 ? "no events are live" : `ended ${events.map((e) => e.id).join(", ")}`;
        }
        return USAGE;
      },
    },
  ];
}
