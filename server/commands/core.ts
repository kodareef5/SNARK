// Session, server and clock commands.

import { parseNumber } from "../../shared/console.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { REJECT_DENIED, REJECT_KICKED, SESSION_ALIVE, SESSION_DEAD, SESSION_SPECTATING } from "../../shared/net/protocol.ts";
import { formatHour, hourOfDay, offsetForHour } from "../../shared/sim/clock.ts";
import type { Console, ConsoleCommand } from "../console.ts";

const STATE_NAMES: Record<number, string> = { [SESSION_ALIVE]: "alive", [SESSION_DEAD]: "dead", [SESSION_SPECTATING]: "spectating" };
const MAX_PASSWORD_ATTEMPTS = 3;

const needsSession = "this command needs a session";

function digest(text: string): Uint8Array {
  return new Bun.CryptoHasher("sha256").update(text).digest();
}

/** Hashes both and folds every byte, so timing does not reveal where two secrets differ. */
function sameSecret(a: string, b: string): boolean {
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
      help: "Print where you are.",
      admin: false,
      run(ctx) {
        const c = ctx.client;
        if (!c) return needsSession;
        const b = c.body;
        return `x ${b.x.toFixed(2)}  y ${b.y.toFixed(2)}  z ${b.z.toFixed(2)}  ${STATE_NAMES[c.state]}`;
      },
    },
    {
      name: "who",
      usage: "",
      help: "List connected survivors.",
      admin: false,
      run(ctx) {
        const out: string[] = [];
        for (const c of ctx.host.game.clients) {
          if (!c?.active) continue;
          out.push(`${c.name}  ${c.closed ? "disconnected" : STATE_NAMES[c.state]}${c.admin ? "  admin" : ""}`);
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
      help: "Enable cheat commands for this session.",
      admin: false,
      secret: true,
      run(ctx, args) {
        const c = ctx.client;
        if (!c) return "the operator already has cheats";
        if (c.admin) return "cheats are already enabled";
        const password = ctx.host.adminPassword;
        if (password === null && !ctx.host.dev) return "cheats are disabled on this server";
        const guesses = ctx.host.game.guesses;
        const who = c.conn.address ?? c.name;
        const tick = ctx.host.world.tick;
        const wait = guesses.wait(who, tick);
        if (wait > 0) return `too many wrong passwords: wait ${Math.ceil(wait / TICK_RATE)} s`;
        if (password !== null && !sameSecret(args[0] ?? "", password)) {
          guesses.wrong(who, tick);
          if (++c.cheatAttempts >= MAX_PASSWORD_ATTEMPTS) ctx.host.game.reject(c, REJECT_DENIED);
          return "wrong password";
        }
        guesses.right(who);
        c.admin = true;
        c.ownDirty = true;
        return "cheats enabled";
      },
    },
    {
      name: "spectate",
      usage: "",
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
      help: "Set the time of day. The world clock itself does not move.",
      admin: true,
      run(ctx, args) {
        const parts = (args[0] ?? "").split(":");
        const hour = parseNumber(parts[0]);
        const minute = parts.length > 1 ? parseNumber(parts[1]) : 0;
        if (!(hour >= 0 && hour < 24) || !(minute >= 0 && minute < 60) || parts.length > 2) return "usage: settime <hour[:minute]>, for example settime 6:30";
        const w = ctx.host.world;
        w.dayOffset = offsetForHour(w.tick, hour + minute / 60, w.clock);
        ctx.host.game.markAllOwn();
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
        p.commit();
        return `saved at tick ${ctx.host.world.tick}`;
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
