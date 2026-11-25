// One table of text commands, used by network sessions, the operator's terminal and tests.
// A line is only a request. Each command decides whether to obey.

import { tokenize } from "../shared/console.ts";
import type { Def } from "../shared/content/defs.ts";
import { find } from "../shared/content/find.ts";
import type { Registry } from "../shared/content/registry.ts";
import { RANK_CLUSTER, RANK_NAMES } from "../shared/ranks.ts";
import { OPERATOR, sessionActor, type Actor } from "./acts.ts";
import { NO_BUS, event, type Bus } from "./events/bus.ts";
import type { Client } from "./game.ts";
import type { Host } from "./host.ts";

export interface CommandContext {
  readonly host: Host;
  /** Null for the operator, who may do anything. */
  readonly client: Client | null;
  /** Who the act is by where it is not the session or the operator: an admin page runs commands with the operator's rights. */
  readonly actor?: Actor;
}

export interface ConsoleCommand {
  readonly name: string;
  /** Argument summary shown by `help`, such as "<name>". */
  readonly usage: string;
  readonly help: string;
  /** Lines as one would type them, for the wiki's command reference. */
  readonly examples?: readonly string[];
  /** Requires cheats to be enabled on the session. */
  readonly admin: boolean;
  /** The lowest rank that may run it (shared/ranks.ts). */
  readonly rank?: number;
  /** Not written to the journal even when admin (it would record a password). */
  readonly secret?: boolean;
  /** Returns the line for the journal, without arguments that must not be kept (a password). Without it the journal gets the line as typed. */
  redact?(args: string[]): string;
  run(ctx: CommandContext, args: string[]): string;
}

/** The one definition of `type` that `name` means (shared/content/find.ts), or what to tell whoever typed it. */
export function named(reg: Registry, name: string | undefined, type: Def["type"]): number | string {
  const found = find(reg, name ?? "", type);
  if (found.kinds.length === 1) return found.kinds[0]!;
  const several = found.kinds.length > 1 ? `is now ${found.kinds.map((k) => reg.ids[k]).join(", ")}` : found.could.length > 0 ? `could be ${found.could.join(" or ")}` : "";
  return several === "" ? `no ${type} "${name ?? ""}"` : `"${name}" ${several}; say which`;
}

/** Journal op for an admin's act (server/acts.ts). */
export { OP_ADMIN } from "./acts.ts";

const COMMAND = event("command");
const COMMAND_RAN = event("command.ran");

/** Who a line's act is by: the page's viewer, the session, or the operator. */
export function actorOf(ctx: CommandContext): Actor {
  return ctx.actor ?? (ctx.client ? sessionActor(ctx.client, ctx.host.records) : OPERATOR);
}

export class Console {
  readonly commands = new Map<string, ConsoleCommand>();
  bus: Bus = NO_BUS;

  /** Throws if a name is taken: one command silently replacing another is a mistake. A line's first word finds it in any case. */
  add(...commands: ConsoleCommand[]): void {
    for (const c of commands) {
      const key = c.name.toLowerCase();
      if (this.commands.has(key)) throw new Error(`there is already a command "${c.name}"`);
      this.commands.set(key, c);
    }
  }

  isAdmin(ctx: CommandContext): boolean {
    return ctx.client === null || ctx.client.admin;
  }

  rankOf(ctx: CommandContext): number {
    return ctx.client === null ? RANK_CLUSTER : ctx.client.rank;
  }

  /** Whether a session without every cheat has this one from its groups (Cheat.<name>, ArkApi's AdminsPermissions). */
  granted(ctx: CommandContext, cmd: ConsoleCommand): boolean {
    const subject = ctx.client && ctx.host.subjectOf(ctx.client);
    return !!subject && ctx.host.permissions.mayRun(subject, cmd.name);
  }

  /** Whether this session or the operator may run `cmd`. */
  allows(ctx: CommandContext, cmd: ConsoleCommand): boolean {
    return (!cmd.admin || this.isAdmin(ctx) || this.granted(ctx, cmd)) && (cmd.rank === undefined || this.rankOf(ctx) >= cmd.rank);
  }

  /** Returns what to print. Never throws. */
  exec(ctx: CommandContext, line: string): string {
    const words = tokenize(line);
    const name = words[0]?.toLowerCase();
    if (!name) return "";
    const cmd = this.commands.get(name);
    if (!cmd) return `unknown command "${name}"; try help`;
    // A session whose powers come from its groups is judged by the file as it is now: another map may have just lowered it.
    const c = ctx.client;
    if (c && c.signed && (cmd.admin || cmd.rank !== undefined) && !ctx.host.freshStanding(c)) {
      const covered = (!cmd.admin || c.passwordCheats || ctx.host.creative.forAll) && (cmd.rank === undefined || c.passwordRank >= cmd.rank);
      if (!covered) return "denied: the permissions file could not be read just now; try again in a moment";
    }
    if (cmd.admin && !this.isAdmin(ctx) && !this.granted(ctx, cmd)) return "denied: cheats are not enabled for you";
    if (cmd.rank !== undefined && this.rankOf(ctx) < cmd.rank) return `denied: this needs the ${RANK_NAMES[cmd.rank]} rank or above`;
    // A module hears the line as the journal would have it: without a password, and for a secret command without anything.
    const told = { byPid: ctx.client?.pid ?? 0, name, line: cmd.secret ? name : cmd.redact ? cmd.redact(words.slice(1)) : line, source: ctx.client ? "session" : "operator" };
    const refused = this.bus.before(COMMAND, { ...told });
    if (refused !== "") return `denied: ${refused}`;
    let out: string;
    try {
      out = cmd.run(ctx, words.slice(1));
    } catch (err) {
      return `${name} failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (cmd.admin && !cmd.secret) {
      ctx.host.acts.write(actorOf(ctx), cmd.redact ? cmd.redact(words.slice(1)) : line);
    }
    this.bus.after(COMMAND_RAN, told);
    return out;
  }
}
