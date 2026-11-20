// Tribe and mute commands.

import { EMOTES, EMOTE_NUMBER, emoteOf } from "../../shared/anim/emotes.ts";
import { RESULT_BUSY, RESULT_DENIED, RESULT_FAR, RESULT_OK } from "../../shared/net/protocol.ts";
import type { Console, ConsoleCommand } from "../console.ts";
import { EMOTE_JOIN, EMOTE_PLAY, EMOTE_STOP } from "../emote.ts";
import type { Client } from "../game.ts";
import type { Host } from "../host.ts";
import { NAME_UNCLEAR, meant } from "../names.ts";
import type { EntityRecord } from "../records.ts";
import { INVITE_RANGE } from "../tribes.ts";

const needsSurvivor = "this needs a survivor; you have none right now";

function survivorOf(host: Host, c: Client | null): EntityRecord | null {
  return c ? (host.records.byPid.get(c.pid) ?? null) : null;
}

/** The session a typed name means (server/names.ts), null if none does, or NAME_UNCLEAR. */
function sessionNamed(host: Host, name: string): Client | null | typeof NAME_UNCLEAR {
  const here = host.game.clients.filter((c): c is Client => !!c?.active && !c.closed);
  const which = meant(here.map((c) => c.name), name);
  return which === NAME_UNCLEAR ? NAME_UNCLEAR : (here[which] ?? null);
}

const MAX_MUTED = 100;

export function addSocialCommands(con: Console): void {
  const commands: ConsoleCommand[] = [
    {
      name: "tribe",
      usage: "[create <name> | invite <survivor> | accept | decline | leave | kick <member> | name <new name>]",
      examples: ['tribe create "Example Tribe"'],
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
            if (to === NAME_UNCLEAR) return `more than one survivor here could be "${rest}"; give the name exactly`;
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
        // A survivor's name, and a list of bounded length: each entry is kept for as long as the server runs.
        if (!/^[A-Za-z0-9 _-]{1,24}$/.test(name)) return "That is not a survivor's name.";
        // Whoever here the name means is muted by their own name. A name nobody here has is kept as it was typed.
        const here = sessionNamed(ctx.host, name);
        if (here === NAME_UNCLEAR) return `more than one survivor here could be "${name}"; give the name exactly`;
        const who = here ? here.name : name;
        if (who === c.name) return "That is you.";
        if (chat.mutedBy(c.name).length >= MAX_MUTED) return `You have muted ${MAX_MUTED} survivors. Unmute one first.`;
        return chat.mute(c.name, who, true) ? `You will not hear ${name}.` : `${name} is muted already.`;
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
        const all = ctx.host.chat.mutedBy(c.name);
        const which = meant(all, name);
        if (which === NAME_UNCLEAR) return `more than one survivor you have muted could be "${name}"; give the name exactly`;
        return which >= 0 && ctx.host.chat.mute(c.name, all[which]!, false) ? `You will hear ${name} again.` : `${name} was not muted.`;
      },
    },
    {
      name: "emote",
      usage: "<emote> [survivor] | stop | join <survivor>",
      examples: ["emote wave", "emote high_five Ana", "emote join Ana"],
      help: "Play an emote (\"emotes\" lists them). A pair's emote at someone invites them; they answer with it back at you. \"join\" dances in step with someone dancing.",
      admin: false,
      run(ctx, args) {
        const host = ctx.host, c = ctx.client;
        if (!c || c.ent < 0) return needsSurvivor;
        const word = (args[0] ?? "").toLowerCase();
        if (!word) return 'usage: emote <emote> [survivor]; "emotes" lists them';
        if (word === "stop") return (host.emotes.request(c.ent, EMOTE_STOP, 0), "");
        const who = word === "join" ? args.slice(1).join(" ") : args.slice(1).join(" ");
        let target = -1;
        if (who) {
          const to = sessionNamed(host, who);
          if (to === NAME_UNCLEAR) return `more than one survivor here could be "${who}"; give the name exactly`;
          if (!to || to.ent < 0) return `nobody called "${who}" is here`;
          target = to.ent;
        }
        if (word === "join") return host.emotes.request(c.ent, EMOTE_JOIN, 0, target) === RESULT_OK ? "" : `${who} is not dancing near you`;
        const n = EMOTE_NUMBER.get(word);
        if (!n) return `no emote "${word}"; "emotes" lists them`;
        const result = host.emotes.request(c.ent, EMOTE_PLAY, n, target);
        if (result === RESULT_OK) return emoteOf(n)!.pair && target >= 0 && host.emotes.playingOf(c.ent) !== n ? `You asked ${who}.` : "";
        return result === RESULT_FAR ? "too far away" : result === RESULT_DENIED ? "not now: stand still on the ground, hands free" : result === RESULT_BUSY ? "" : emoteOf(n)!.pair ? `a ${emoteOf(n)!.name.toLowerCase()} needs someone: emote ${word} <survivor>` : "not now";
      },
    },
    {
      name: "emotes",
      usage: "[tag]",
      help: "The emotes, by what they are for, or those with a tag (dance, greeting, fun, scary, rest, pair...).",
      admin: false,
      run(_ctx, args) {
        const tag = (args[0] ?? "").toLowerCase();
        const list = EMOTES.filter((e) => !tag || e.tags.includes(tag));
        if (!list.length) return `no emotes tagged "${tag}"`;
        return list.map((e) => `${e.id}${e.pair ? " <survivor>" : ""}  ${e.tags.join(", ")}`).join("\n");
      },
    },
  ];
  con.add(...commands);
}
