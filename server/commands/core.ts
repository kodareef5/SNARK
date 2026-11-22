// Session, server and clock commands.

import { CHEAT_GUESSES, WRONG_PASSWORD, parseNumber } from "../../shared/console.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { REJECT_DENIED, REJECT_KICKED, SESSION_ALIVE, SESSION_DEAD, SESSION_SPECTATING } from "../../shared/net/protocol.ts";
import { formatHour, hourOfDay, offsetForHour } from "../../shared/sim/clock.ts";
import { latLonText, latOf, lonOf } from "../../shared/world/coords.ts";
import type { Console, ConsoleCommand } from "../console.ts";
import { admit } from "../creative.ts";

const STATE_NAMES: Record<number, string> = { [SESSION_ALIVE]: "alive", [SESSION_DEAD]: "dead", [SESSION_SPECTATING]: "spectating" };

const needsSession = "this command needs a session";

function digest(text: string): Uint8Array {
  return new Bun.CryptoHasher("sha256").update(text).digest();
}

/** Hashes both and folds every byte, so timing does not reveal where two secrets differ. */
export function sameSecret(a: string, b: string): boolean {
  const x = digest(a);
  const y = digest(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

export function addCoreCommands(con: Console): void {
  const commands: ConsoleCommand[] = [
    {
      name: "help",
      usage: "[command]",
      examples: ["help give", "help spawn"],
      help: "List commands, or describe one.",
      admin: false,
      run(ctx, args) {
        const one = args[0] && con.commands.get(args[0].toLowerCase());
        if (one) return `${one.name} ${one.usage}\n${one.help}${one.admin ? " (cheat)" : ""}`;
        const admin = con.isAdmin(ctx);
        const names = [...con.commands.values()].filter((c) => admin || !c.admin).map((c) => (c.usage ? `${c.name} ${c.usage}` : c.name));
        return names.sort().join("\n");
      },
    },
    {
      name: "pos",
      usage: "",
      help: "Print where you are: metres on the map, then latitude and longitude as the map screen gives them.",
      admin: false,
      run(ctx) {
        const c = ctx.client;
        if (!c) return needsSession;
        const b = c.body;
        const d = ctx.host.world.hf.dims;
        return `x ${b.x.toFixed(2)}  y ${b.y.toFixed(2)}  z ${b.z.toFixed(2)}  ${latLonText(latOf(d, b.z), lonOf(d, b.x))}  ${STATE_NAMES[c.state]}`;
      },
    },
    {
      name: "who",
      usage: "",
      help: "List connected survivors.",
      admin: false,
      run(ctx) {
        const out: string[] = [];
        // Who has cheats is told to those who have them, and to the operator.
        const admin = con.isAdmin(ctx);
        for (const c of ctx.host.game.clients) {
          if (!c?.active) continue;
          out.push(`${c.name}  ${c.closed ? "disconnected" : STATE_NAMES[c.state]}${admin && c.admin ? "  admin" : ""}`);
        }
        return out.length > 0 ? out.join("\n") : "nobody";
      },
    },
    {
      name: "time",
      usage: "",
      help: "Print the time of day.",
      admin: false,
      run(ctx) {
        const w = ctx.host.world;
        return formatHour(hourOfDay(w.tick, w.dayOffset, w.clock));
      },
    },
    {
      name: "enablecheats",
      usage: "<password>",
      examples: ['enablecheats "<password>"'],
      help: "Enable cheat commands for this session.",
      admin: false,
      secret: true,
      run(ctx, args) {
        const c = ctx.client;
        if (!c) return "the operator already has cheats";
        if (c.admin) return "cheats are already enabled";
        const password = ctx.host.adminPassword;
        if (password === null && !ctx.host.dev) return "cheats are disabled on this server";
        const guesses = ctx.host.game.cheatGuesses;
        const who = c.conn.address ?? c.name;
        const tick = ctx.host.world.tick;
        const wait = guesses.wait(who, tick);
        if (wait > 0) return `too many wrong passwords: wait ${Math.ceil(wait / TICK_RATE)} s`;
        if (password !== null && !sameSecret(args[0] ?? "", password)) {
          guesses.wrong(who, tick);
          if (++c.cheatAttempts >= CHEAT_GUESSES) ctx.host.game.reject(c, REJECT_DENIED);
          return WRONG_PASSWORD;
        }
        guesses.right(who);
        admit(ctx.host.bus, c);
        return "cheats enabled";
      },
    },
    {
      name: "spectate",
      usage: "",
      examples: ["spectate"],
      help: "Leave your body and fly as an unseen camera.",
      admin: false,
      run(ctx) {
        const c = ctx.client;
        if (!c) return needsSession;
        const rule = ctx.host.game.opts.spectators;
        if (rule === "off" || (rule === "admin" && !c.admin)) return "denied: spectating is not allowed for you";
        if (c.state === SESSION_DEAD) return "you are dead";
        ctx.host.game.setSpectating(c, true);
        return "spectating; stopspectating returns you to your body";
      },
    },
    {
      name: "stopspectating",
      usage: "",
      help: "Return to your body where you left it.",
      admin: false,
      run(ctx) {
        const c = ctx.client;
        if (!c) return needsSession;
        if (c.state !== SESSION_SPECTATING) return "you are not spectating";
        return ctx.host.game.setSpectating(c, false) ? "back in your body" : "no room for a body right now";
      },
    },
    {
      name: "settime",
      usage: "<hour[:minute]>",
      examples: ["settime 6:30"],
      help: "Set the time of day. The world clock itself does not move.",
      admin: true,
      run(ctx, args) {
        const parts = (args[0] ?? "").split(":");
        const hour = parseNumber(parts[0]);
        const minute = parts.length > 1 ? parseNumber(parts[1]) : 0;
        if (!(hour >= 0 && hour < 24) || !(minute >= 0 && minute < 60) || parts.length > 2) return "usage: settime <hour[:minute]>, for example settime 6:30";
        const w = ctx.host.world;
        w.dayOffset = offsetForHour(w.tick, hour + minute / 60, w.clock);
        ctx.host.game.replication.markAllOwn();
        return `time is ${formatHour(hourOfDay(w.tick, w.dayOffset, w.clock))}`;
      },
    },
    {
      name: "save",
      usage: "",
      help: "Write the world to disk now.",
      admin: true,
      run(ctx) {
        const p = ctx.host.persistence;
        if (!p) return "this world is not saved to disk";
        p.commit(true);
        return `saved at tick ${ctx.host.world.tick}`;
      },
    },
    {
      name: "modules",
      usage: "",
      help: "List the modules that are loaded, and what each handler has cost.",
      admin: true,
      run(ctx) {
        const names = ctx.host.modules.names;
        if (names.length === 0) return "no modules are loaded";
        const lines = [`modules: ${names.join(", ")}`];
        for (const s of ctx.host.bus.stats()) lines.push(`  ${s.module} ${s.event}: ${s.calls} calls, ${s.ms.toFixed(1)} ms in all, ${s.worst.toFixed(2)} ms at worst${s.off ? ", switched off" : ""}`);
        return lines.join("\n");
      },
    },
    {
      name: "backup",
      usage: "",
      help: "Copy the save into a new backup folder beside it now.",
      admin: true,
      run(ctx) {
        const p = ctx.host.persistence;
        if (!p) return "this world is not saved to disk";
        p.commit(true);
        p.keeper.backup();
        return "a backup was started; the server's log says where it went";
      },
    },
    {
      name: "survivorlog",
      usage: "",
      help: "Say what span the survivor log holds, how much disk it takes and its cap.",
      admin: true,
      run(ctx) {
        const s = ctx.host.survivorLog.span();
        const mb = (n: number): string => `${(n / (1 << 20)).toFixed(1)} MB`;
        const at = (wall: number): string => `${new Date(wall).toISOString().slice(0, 19).replace("T", " ")} UTC`;
        const state = s.on ? "on" : `off: ${s.why}`;
        if (s.from === null || s.to === null) return `survivor log ${state}; it holds nothing yet${s.folder ? ` (${s.folder}, cap ${mb(s.cap)})` : ""}`;
        const minutes = Math.round((s.to - s.from) / 60000);
        return `survivor log ${state}: ${at(s.from)} (tick ${s.fromTick}) to ${at(s.to)} (tick ${s.toTick}), ${Math.floor(minutes / 60)} h ${minutes % 60} min, in ${s.segments} segments; ${mb(s.bytes)} of ${mb(s.cap)} in ${s.folder}`;
      },
    },
    {
      name: "saveas",
      usage: "<file>",
      help: "Write the whole world to a new file and carry on saving there. For the server's own console.",
      admin: true,
      run(ctx, args) {
        const p = ctx.host.persistence;
        if (!p) return "this world is not saved to disk";
        if (ctx.client) return "saveas is for the server's own console";
        if (!args[0]) return "usage: saveas <file>";
        p.saveAs(args[0]);
        return `the world is now saved in ${args[0]}`;
      },
    },
    {
      name: "kick",
      usage: "<name>",
      help: "Disconnect a survivor.",
      admin: true,
      run(ctx, args) {
        const target = ctx.host.game.clients.find((c) => c?.active && !c.closed && c.name === args[0]);
        if (!target) return `nobody named "${args[0] ?? ""}" is connected`;
        ctx.host.game.reject(target, REJECT_KICKED);
        return `kicked ${target.name}`;
      },
    },
  ];
  con.add(...commands);
}
