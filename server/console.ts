// One table of text commands, used by network sessions, the operator's terminal and tests.
// A line is only a request. Each command decides whether to obey.

import { tokenize } from "../shared/console.ts";
import type { Def } from "../shared/content/defs.ts";
import { find } from "../shared/content/find.ts";
import type { Registry } from "../shared/content/registry.ts";
import { NO_BUS, event, type Bus } from "./events/bus.ts";
import type { Client } from "./game.ts";
import type { Host } from "./host.ts";

export interface CommandContext {
  readonly host: Host;
  /** Null for the operator, who may do anything. */
  readonly client: Client | null;
}

export interface ConsoleCommand {
  readonly name: string;
  /** Argument summary shown by `help`, such as "<name>". */
  readonly usage: string;
  readonly help: string;
  /** Lines as one would type them, for the field guide's command reference. */
  readonly examples?: readonly string[];
  /** Requires cheats to be enabled on the session. */
  readonly admin: boolean;
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

/** Journal op for an admin command: the session's name, a tab, the line. */
export const OP_ADMIN = 2;

const COMMAND = event("command");
const COMMAND_RAN = event("command.ran");

export class Console {
  readonly commands = new Map<string, ConsoleCommand>();
  bus: Bus = NO_BUS;

  /** Throws if a name is taken: one command silently replacing another is a mistake. */
  add(...commands: ConsoleCommand[]): void {
    for (const c of commands) {
      if (this.commands.has(c.name)) throw new Error(`there is already a command "${c.name}"`);
      this.commands.set(c.name, c);
    }
  }

  isAdmin(ctx: CommandContext): boolean {
    return ctx.client === null || ctx.client.admin;
  }

  /** Returns what to print. Never throws. */
  exec(ctx: CommandContext, line: string): string {
    const words = tokenize(line);
    const name = words[0]?.toLowerCase();
    if (!name) return "";
    const cmd = this.commands.get(name);
    if (!cmd) return `unknown command "${name}"; try help`;
    if (cmd.admin && !this.isAdmin(ctx)) return "denied: cheats are not enabled for you";
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
      ctx.host.persistence?.journal(OP_ADMIN, new TextEncoder().encode(`${ctx.client ? ctx.client.name : "(operator)"}\t${cmd.redact ? cmd.redact(words.slice(1)) : line}`));
    }
    this.bus.after(COMMAND_RAN, told);
    return out;
  }
}
