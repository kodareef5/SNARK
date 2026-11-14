// One table of text commands, used by network sessions, the operator's terminal and tests.
// A line is only a request. Each command decides whether to obey.

import { tokenize } from "../shared/console.ts";
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
  /** Requires cheats to be enabled on the session. */
  readonly admin: boolean;
  /** Not written to the journal even when admin (it would record a password). */
  readonly secret?: boolean;
  /** Returns the line for the journal, without arguments that must not be kept (a password). Without it the journal gets the line as typed. */
  redact?(args: string[]): string;
  run(ctx: CommandContext, args: string[]): string;
}

/** Journal op for an admin command: the session's name, a tab, the line. */
export const OP_ADMIN = 2;

export class Console {
  readonly commands = new Map<string, ConsoleCommand>();

  add(...commands: ConsoleCommand[]): void {
    for (const c of commands) this.commands.set(c.name, c);
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
    let out: string;
    try {
      out = cmd.run(ctx, words.slice(1));
    } catch (err) {
      return `${name} failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (cmd.admin && !cmd.secret) {
      ctx.host.persistence?.journal(OP_ADMIN, new TextEncoder().encode(`${ctx.client ? ctx.client.name : "(operator)"}\t${cmd.redact ? cmd.redact(words.slice(1)) : line}`));
    }
    return out;
  }
}
