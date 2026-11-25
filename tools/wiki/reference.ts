// The wiki's reference pages from the server's own tables: every command as it is registered, and the settings rows
// marked public. Nothing is run and no server is started.

import { COMMAND_FAMILIES } from "../../server/commands/families.ts";
import { Console } from "../../server/console.ts";
import { CATALOG } from "../../server/settings/catalog.ts";
import { FILE_OF, SECTION_OF } from "../../server/settings/config.ts";

export interface Command {
  family: string;
  name: string;
  usage: string;
  help: string;
  admin: boolean;
  /** The lowest rank that may run it (shared/ranks.ts), where it needs one. */
  rank?: number;
  examples: readonly string[];
}

export function commands(): Command[] {
  const con = new Console();
  const out: Command[] = [];
  for (const [family, add] of COMMAND_FAMILIES) {
    const before = new Set(con.commands.values());
    add(con);
    for (const c of con.commands.values()) if (!before.has(c)) out.push({ family, name: c.name, usage: c.usage, help: c.help, admin: c.admin, ...(c.rank === undefined ? {} : { rank: c.rank }), examples: c.examples ?? [] });
  }
  return out;
}

/** The line that makes one of a thing with a command, which must be registered: a renamed command fails the build. */
export function consoleLine(list: readonly Command[]): (name: string, id: string) => string {
  return (name, id) => {
    if (!list.some((c) => c.name === name)) throw new Error(`the wiki gives "${name}" lines, and the server registers no such command`);
    return name === "give" ? `${name} ${id} 1` : `${name} ${id}`;
  };
}

export interface Setting {
  name: string;
  def: string;
  doc: string;
  group: string;
  where: string;
  live: boolean;
}

export function publicSettings(): Setting[] {
  return CATALOG.filter((r) => r.public && r.status === "live").map((r) => ({
    name: r.name,
    def: typeof r.def === "boolean" ? (r.def ? "True" : "False") : String(r.def),
    doc: r.doc,
    group: r.group,
    where: `${FILE_OF[r.at]} ${SECTION_OF[r.at]}`.trim(),
    live: r.live,
  }));
}
