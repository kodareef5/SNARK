// Tribe and mute commands.

import type { Console, ConsoleCommand } from "../console.ts";
import type { Client } from "../game.ts";
import type { Host } from "../host.ts";
import type { EntityRecord } from "../records.ts";
import { INVITE_RANGE } from "../tribes.ts";

const needsSurvivor = "this needs a survivor; you have none right now";

function survivorOf(host: Host, c: Client | null): EntityRecord | null {
  return c ? (host.records.byPid.get(c.pid) ?? null) : null;
}

function sessionNamed(host: Host, name: string): Client | null {
  const wanted = name.toLowerCase();
  for (const c of host.game.clients) if (c?.active && !c.closed && c.name.toLowerCase() === wanted) return c;
  return null;
}

export function addSocialCommands(con: Console): void {
  const commands: ConsoleCommand[] = [
    {
      name: "tribe",
      usage: "[create <name> | invite <survivor> | accept | decline | leave | kick <member> | name <new name>]",
      help: "Show your tribe, or found, join, leave or run one. Joining gives the tribe everything you own; leaving takes nothing with you.",
      admin: false,
      run(ctx, args) {
        const host = ctx.host;
        const tribes = host.tribes;
        const rec = survivorOf(host, ctx.client);
        if (!rec || !ctx.client) return needsSurvivor;
        const rest = args.slice(1).join(" ");
        switch ((args[0] ?? "").toLowerCase()) {
          case "": {
            const tribe = tribes.of(rec);
            const invite = tribes.inviteOf(rec);
            const out: string[] = [];
            if (!tribe) out.push('You are in no tribe. "tribe create <name>" founds one.');
            else {
              out.push(`${tribe.name}: ${tribe.members.length} ${tribe.members.length === 1 ? "member" : "members"}`);
              for (const pid of tribe.members) {
                const m = host.records.byPid.get(pid);
                if (m) out.push(`  ${m.name}${pid === tribe.owner ? "  owner" : ""}${host.online(pid) ? "" : "  away"}`);
              }
            }
            if (invite) out.push(`${invite.by} has invited you to join ${invite.tribe.name}: "tribe accept" or "tribe decline".`);
            return out.join("\n");
          }
          case "create": {
            const wrong = tribes.create(rec, rest);
            return wrong || `You founded ${tribes.of(rec)!.name}. Everything you own is the tribe's.`;
          }
          case "invite": {
            const to = sessionNamed(host, rest);
            const target = survivorOf(host, to);
            if (!to || !target || to.ent < 0) return `nobody called "${rest}" is here`;
            const c = ctx.client;
            const dx = to.body.x - c.body.x;
            const dy = to.body.y - c.body.y;
            const dz = to.body.z - c.body.z;
            const near = c.ent >= 0 && dx * dx + dy * dy + dz * dz <= INVITE_RANGE * INVITE_RANGE;
            return tribes.invite(rec, target, near) || `You invited ${target.name}.`;
          }
          case "accept": {
            const wrong = tribes.accept(rec);
            return wrong || `You joined ${tribes.of(rec)!.name}. Everything you owned is the tribe's.`;
          }
          case "decline":
            return tribes.decline(rec) || "You declined.";
          case "leave": {
            const name = tribes.of(rec)?.name;
            return tribes.leave(rec) || `You left ${name}. What you had there stays with the tribe.`;
          }
          case "kick":
            return tribes.kick(rec, rest) || `${rest} is out of the tribe.`;
          case "name":
            return tribes.rename(rec, rest) || `The tribe is now ${tribes.of(rec)!.name}.`;
        }
        return "usage: tribe [create <name> | invite <survivor> | accept | decline | leave | kick <member> | name <new name>]";
      },
    },
    {
      name: "mute",
      usage: "[survivor]",
      help: "Stop hearing a survivor, in writing and aloud; with no name, list who you have muted.",
      admin: false,
      run(ctx, args) {
        const c = ctx.client;
        if (!c) return "this command needs a session";
        const chat = ctx.host.chat;
        const name = args.join(" ");
        if (name === "") {
          const all = chat.mutedBy(c.name);
          return all.length === 0 ? "You have muted nobody." : `Muted: ${all.join(", ")}`;
        }
        if (name.toLowerCase() === c.name.toLowerCase()) return "That is you.";
        return chat.mute(c.name, name, true) ? `You will not hear ${name}.` : `${name} is muted already.`;
      },
    },
    {
      name: "unmute",
      usage: "<survivor>",
      help: "Hear a survivor again.",
      admin: false,
      run(ctx, args) {
        const c = ctx.client;
        if (!c) return "this command needs a session";
        const name = args.join(" ");
        return ctx.host.chat.mute(c.name, name, false) ? `You will hear ${name} again.` : `${name} was not muted.`;
      },
    },
  ];
  con.add(...commands);
}
