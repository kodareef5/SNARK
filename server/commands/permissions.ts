// ArkApi's permission commands: the `Permissions.*` family, `groups`, `acts`, and `cheat` and `admincheat` before a line.
// Each change goes through the host's one door, which logs it as the command it amounts to.

import { RANK_ADMIN, RANK_NAMES, RANK_STAFF } from "../../shared/ranks.ts";
import { isSurvivorId, isTeamKey, memberWorld, type Member } from "../../shared/permissions/model.ts";
import { PERMISSIONS_COMMANDS, memberOp, readPermissions, type PermissionsListing, type Who } from "../../shared/permissions/commands.ts";
import { actorOf, type CommandContext, type Console, type ConsoleCommand } from "../console.ts";
import type { Host } from "../host.ts";
import { idText } from "../survivor-ids.ts";

const MINUTE = 60_000;
const ACTS_SHOWN = 20;
const ACTS_MOST = 200;

/** A survivor's ID or a tribe's team number, and how to name it in a reply; or the reason it is not found. */
type Found = { readonly key: string; readonly label: string } | string;

function find(host: Host, who: Who): Found {
  const word = who.word;
  if (who.kind === "survivor") {
    if (/^[0-9]+$/.test(word)) {
      if (!isSurvivorId(word)) return "That is not a survivor's ID.";
      const here = host.survivorById(word);
      return { key: word, label: here ? `${here.name} (${word})` : word };
    }
    const rec = host.survivorRecord(word);
    const id = rec ? idText(rec) : "";
    if (!rec || id === "") return `There is no survivor called "${word}" on this map: give their ID.`;
    return { key: id, label: `${rec.name} (${id})` };
  }
  if (/^[0-9]+$/.test(word)) {
    if (!isTeamKey(word)) return "That is not a tribe's number.";
    const here = host.tribes.byId.get(Number(word));
    return { key: word, label: here ? `${here.name} (${word})` : `tribe ${word}` };
  }
  const lower = word.toLowerCase();
  for (const t of host.tribes.byId.values()) if (t.name.toLowerCase() === lower) return { key: String(t.id), label: `${t.name} (${t.id})` };
  return `There is no tribe called "${word}" on this map: give its number.`;
}

function span(ms: number): string {
  const minutes = Math.ceil(ms / MINUTE);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

/** One membership as a line: its group, how long it holds, and in a cluster on which map. */
function memberLine(m: Member, now: number, world: number): string {
  const time = m.forever ? "for good" : m.from > now ? `from ${span(m.from - now)} from now, for ${span(m.until - m.from)}` : `${span(m.until - now)} left`;
  const map = world === 0 ? "" : m.world === 0 ? ", on every map" : m.world === world ? `, on this map (${m.world})` : `, on map ${m.world}`;
  return `${m.group}: ${time}${map}`;
}

function listing(host: Host, l: PermissionsListing, now: number): string {
  const p = host.permissions;
  const held = (permissions: readonly string[]): string => (permissions.length > 0 ? permissions.join(", ") : "nothing");
  if (l.of === "groups") return p.groups().map((g) => `${g.name} (${RANK_NAMES[g.rank]}): ${held(g.permissions)}`).join("\n");
  if (l.of === "permissions") {
    const g = p.group(l.group);
    return g ? `${g.name} (${RANK_NAMES[g.rank]}) holds ${held(g.permissions)}` : `There is no group ${l.group}.`;
  }
  const found = find(host, l.who);
  if (typeof found === "string") return found;
  const rows = p.membersOf(l.who.kind, found.key).filter((m) => m.forever || m.until > now);
  if (rows.length === 0) return `${found.label} is in no group but Default.`;
  return [`${found.label}:`, ...rows.map((m) => memberLine(m, now, p.world))].join("\n");
}

function permissionsCommand(ctx: CommandContext, name: string, args: string[]): string {
  const host = ctx.host;
  const read = readPermissions(name, args);
  if (!read.ok) return read.reason;
  const req = read.request;
  if (req.type === "list") return listing(host, req.listing, host.permissions.now());
  const actor = actorOf(ctx);
  if (req.type === "change") {
    const why = host.changePermissions(actor, req.op);
    if (why !== "") return why;
    const op = req.op;
    switch (op.op) {
      case "addGroup":
        return `made the group ${op.group}`;
      case "removeGroup":
        return `removed the group ${op.group}`;
      case "setRank":
        return `${op.group} is of the ${RANK_NAMES[op.rank]} rank`;
      case "grant":
        return `${op.group} holds ${op.permission}`;
      case "revoke":
        return `${op.group} no longer holds ${op.permission}`;
    }
  }
  const found = find(host, req.who);
  if (typeof found === "string") return found;
  const world = host.permissions.world;
  const why = host.changePermissions(actor, memberOp(req, found.key, world));
  if (why !== "") return why;
  const c = req.change;
  const group = host.permissions.group(c.group)!;
  if (c.op === "removeMember") return c.timedOnly ? `${found.label} has no more time in ${group.name}` : `${found.label} is out of ${group.name}`;
  const time = c.hours !== undefined ? ` for ${c.hours} h${c.delayHours ? `, from ${c.delayHours} h from now` : ""}` : "";
  const done = `${found.label} is in ${group.name}${time}${world !== 0 && memberWorld({ ...actor, world }, group.rank, req.everyWorld ? 0 : world) === 0 ? " on every map" : ""}`;
  if (group.rank < RANK_STAFF) return done;
  return `${done}. It counts once they sign in with their own password, which is issued on the admin pages or at the server's terminal.`;
}

/** A line's words as one would type them again: a word with a space in it is quoted. */
const retyped = (words: readonly string[]): string => words.map((w) => (w === "" || /[ \t]/.test(w) ? `"${w}"` : w)).join(" ");

/** `cheat` and `admincheat`: the rest of the line, run as the same caller and checked as always. */
function prefix(con: Console, name: string): ConsoleCommand {
  const inner = (args: string[]): ConsoleCommand | undefined => con.commands.get(args[0]?.toLowerCase() ?? "");
  return {
    name,
    usage: "<command line>",
    examples: [`${name} fly`],
    help: "Runs the command that follows, as ARK's cheat prefix does. The command needs what it always needs.",
    admin: false,
    redact(args) {
      const cmd = inner(args);
      if (!cmd) return retyped([name, ...args]);
      return `${name} ${cmd.secret ? cmd.name : cmd.redact ? cmd.redact(args.slice(1)) : retyped(args)}`;
    },
    run(ctx, args) {
      if (args.length === 0) return `usage: ${name} <command line>`;
      const cmd = inner(args);
      if (cmd?.name === "cheat" || cmd?.name === "admincheat") return `${name} runs a command, not another ${cmd.name}`;
      return con.exec(ctx, retyped(args));
    },
  };
}

export function addPermissionsCommands(con: Console): void {
  const family: ConsoleCommand[] = PERMISSIONS_COMMANDS.map((pc) => ({
    name: pc.name,
    usage: pc.usage.slice(pc.name.length).trim(),
    help: pc.help,
    admin: false,
    rank: RANK_ADMIN,
    run: (ctx, args) => permissionsCommand(ctx, pc.name, args),
  }));
  const commands: ConsoleCommand[] = [
    ...family,
    {
      name: "groups",
      usage: "",
      help: "List the permission groups that count for you now.",
      admin: false,
      run(ctx) {
        if (!ctx.client) return "the operator has no survivor and is in every group";
        const subject = ctx.host.subjectOf(ctx.client);
        if (!subject) return "you have no survivor yet";
        return `your groups: ${ctx.host.permissions.groupsOf(subject).map((g) => g.name).join(", ")}`;
      },
    },
    {
      name: "acts",
      usage: "[count]",
      examples: ["acts", "acts 50"],
      help: "List the latest admin acts: when, who, at what rank, and what.",
      admin: false,
      rank: RANK_ADMIN,
      run(ctx, args) {
        const n = args[0] === undefined ? ACTS_SHOWN : Number(args[0]);
        if (!Number.isInteger(n) || n < 1) return "usage: acts [count], a whole number";
        const all = ctx.host.acts.recent(0, Number.MAX_SAFE_INTEGER);
        const shown = all.slice(-Math.min(n, ACTS_MOST));
        if (shown.length === 0) return "no acts yet";
        return shown
          .map((a) => {
            const at = a.at > 0 ? new Date(a.at).toISOString().slice(0, 19).replace("T", " ") + " UTC" : "(time not known)";
            const who = a.id ? `${a.name} ${a.id}` : a.name;
            return `${at}  ${who}  ${RANK_NAMES[a.rank] ?? "unknown"}  ${a.kind === "command" ? "" : `${a.kind}: `}${a.what}`;
          })
          .join("\n");
      },
    },
    prefix(con, "cheat"),
    prefix(con, "admincheat"),
  ];
  con.add(...commands);
}
