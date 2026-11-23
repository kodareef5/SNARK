// The console's loadouts (server/loadout/loadouts.ts): hand one out now, and list them. The admin page's apply button
// sends the same `loadout` line, so it is journalled as a typed one is.

import type { ConsoleCommand } from "../console.ts";
import { NAME_UNCLEAR } from "../names.ts";
import { sessionNamed } from "./social.ts";

const USAGE = "usage: loadout [id] [survivor] [clear]";
/** A reply is one line of at most this many bytes. */
const REPLY_BYTES = 199;
/** Bytes of a reply kept for what was left out. */
const MISSED_BYTES = 60;
/** Bytes ", 192 more" takes: the most a loadout's entries can leave out. */
const MORE_BYTES = 10;

const bytes = (text: string): number => new TextEncoder().encode(text).length;

/** As many of `labels` as fit in `room` bytes, then how many more there are. */
function listed(labels: readonly string[], room: number): string {
  let out = "";
  let k = 0;
  for (; k < labels.length; k++) {
    const next = out === "" ? labels[k]! : `${out}, ${labels[k]}`;
    if (bytes(next) + (k + 1 < labels.length ? MORE_BYTES : 0) > room) break;
    out = next;
  }
  if (k === labels.length) return out;
  return out === "" ? `${labels.length} things` : `${out}, ${labels.length - k} more`;
}

export function loadoutCommands(): ConsoleCommand[] {
  return [
    {
      name: "loadout",
      usage: "[id] [survivor] [clear]",
      examples: ["loadout", "loadout scout", 'loadout rifleman "Ada Byron" clear'],
      help: 'Hand a loadout out now, its tames too: the one your role is given, or the one named; to yourself, or to a survivor who is in the world. With `clear` as the last word everything they hold is destroyed first, and a full soul ball destroyed so loses its tame. "loadouts" lists them.',
      admin: true,
      run(ctx, args) {
        const host = ctx.host;
        const c = ctx.client;
        const words = [...args];
        const clear = words.at(-1)?.toLowerCase() === "clear";
        if (clear) words.pop();
        const id = words[0];
        const name = words.slice(1).join(" ");
        if (!c && name === "") return `name a survivor; ${USAGE}`;
        let to = c;
        if (name !== "") {
          const found = sessionNamed(host, name);
          if (found === NAME_UNCLEAR) return `more than one survivor here could be "${name}"; give the name exactly`;
          if (!found) return `nobody called "${name}" is here`;
          to = found;
        }
        const rec = to ? host.records.byPid.get(to.pid) : undefined;
        if (!to || !rec || to.ent < 0 || rec.dead) return name === "" ? "this needs a body; you have none right now" : `${name} has no body right now`;
        const loadout = id === undefined ? host.loadouts.of(c!) : host.loadouts.store.find(id);
        if (!loadout) return id === undefined ? "the book gives your role no loadout" : `no loadout "${id}"; "loadouts" lists them`;
        const out = host.loadouts.give(rec, loadout, { clear, tames: true });
        const head = `${loadout.id} for ${rec.name}${clear ? ", cleared first" : ""}: `;
        const missed = out.missed.length === 0 ? "" : `; left out ${listed(out.missed, MISSED_BYTES)}`;
        const given = out.given.length === 0 ? "nothing given" : `gave ${listed(out.given, REPLY_BYTES - bytes(head) - bytes(missed) - 5)}`;
        return `${head}${given}${missed}`;
      },
    },
    {
      name: "loadouts",
      usage: "",
      help: "List the loadouts of the book in force: each one's id and label, whether it is handed out again after a death, and which the players and the admins are given.",
      admin: true,
      run(ctx) {
        const book = ctx.host.loadouts.store.book;
        return book.loadouts
          .map((l) => {
            const who = [book.assign.player === l.id ? "players" : "", book.assign.admin === l.id ? "admins" : ""].filter((w) => w !== "").join(" and ");
            return `${l.id}: ${l.label}${l.respawn ? ", at each respawn" : ""}${who === "" ? "" : ` (given to ${who})`}`;
          })
          .join("\n");
      },
    },
  ];
}
