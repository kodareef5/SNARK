import type { Console, ConsoleCommand } from "../console.ts";
import { CATALOG, rowOf } from "../settings/catalog.ts";
import { FEATURES, NOT_HERE, type Feature, type NotHere, type Row } from "../settings/row.ts";
import type { Rules } from "../settings/rules.ts";

/** A password is never shown. */
function shown(row: Row, rules: Rules): string {
  const v = rules.valueOf(row);
  if (/password/i.test(row.name)) return v === "" ? "(none)" : "****";
  if (Array.isArray(v)) return row.kind === "indexed" ? v.join(",") : `${v.length} ${v.length === 1 ? "entry" : "entries"}`;
  return typeof v === "boolean" ? (v ? "True" : "False") : String(v);
}

export function addSettingsCommands(con: Console): void {
  const commands: ConsoleCommand[] = [
    {
      // ARK's name for it is ForceUpdateDynamicConfig. The console matches command names in any case.
      name: "forceupdatedynamicconfig",
      usage: "",
      help: "Read the live file again now, without waiting for the next time it would be.",
      admin: true,
      run(ctx) {
        return ctx.host.readLive().join("\n");
      },
    },
    {
      name: "settings",
      usage: "",
      help: "Every setting that is not at its default, and where its value came from.",
      admin: true,
      run(ctx) {
        const rules = ctx.host.rules;
        const lines = CATALOG.filter((r) => rules.sourceOf(r) !== "default").map((r) => `${r.kind === "flag" ? "-" : ""}${r.name}=${shown(r, rules)}  (${rules.sourceOf(r)}${r.status === "live" ? "" : ", not effective"})`);
        return lines.length > 0 ? lines.join("\n") : "every setting is at its default";
      },
    },
    {
      name: "setting",
      usage: "<name> [value]",
      examples: ["setting TamingSpeedMultiplier", "setting TamingSpeedMultiplier 2"],
      help: "What a setting is and does; with a value, set it until the server is started again (only those that may change while it runs).",
      admin: true,
      // Keeps a password out of the admin journal.
      redact: (args) => `setting ${args[0] ?? ""}${args.length > 1 ? (/password/i.test(args[0] ?? "") ? " ****" : ` ${args.slice(1).join(" ")}`) : ""}`,
      run(ctx, args) {
        const row = args[0] === undefined ? undefined : rowOf(args[0]);
        if (!row) return args[0] === undefined ? "usage: setting <name> [value]" : `there is no setting called ${args[0]}`;
        const rules = ctx.host.rules;
        if (args.length > 1) {
          const why = ctx.host.setSetting(row.name, args.slice(1).join(" "));
          return why === "" ? `${row.name}=${shown(row, rules)}  (until the server is started again)` : why;
        }
        const standing = row.status === "live" ? (row.live ? "may be changed while the server runs" : "read when the server starts") : row.status === "todo" ? "not effective yet" : row.status === "planned" ? `waits for: ${FEATURES[row.waits as Feature].toLowerCase()}` : `no meaning here: ${NOT_HERE[row.waits as NotHere]}`;
        return `${row.name}=${shown(row, rules)}  (${rules.sourceOf(row)}; ${standing})\n${row.doc}`;
      },
    },
  ];
  con.add(...commands);
}
