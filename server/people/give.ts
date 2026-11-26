// A published garment edition handed to a survivor by staff: the console's `dress` command, which the Wardrobe page's
// give button sends as a line, so both are in the admin log alike (server/admin/people-routes.ts).

import type { Actor } from "../acts.ts";
import type { ConsoleCommand } from "../console.ts";
import type { Client } from "../game.ts";
import type { Host } from "../host.ts";
import { NAME_NONE, NAME_UNCLEAR, meant } from "../names.ts";
import type { EntityRecord } from "../records.ts";

const USAGE = "usage: dress <edition> [survivor | #number] [-dye=a,b,c]";
const NUMBERED = /^#(\d{1,15})$/;
const DYE = /^-dye=(\d{1,3}),(\d{1,3}),(\d{1,3})$/;

/** Three palette colours as one number, the first in the low byte, as a slot keeps its dye. */
const packed = (dye: readonly number[]): number => (dye[0]! | (dye[1]! << 8) | (dye[2]! << 16)) >>> 0;

/**
 * Gives `rec` one of edition `edition`'s garment in it, dyed `dye` (0 for none): worn in its wardrobe slot where that is
 * empty, else in the first empty slot of the bag. Says what it did, or why not.
 */
export function giveEdition(host: Host, rec: EntityRecord, edition: number, dye: number): { worn: boolean; said: string } | string {
  const garment = host.people.garmentOf(edition), reg = host.world.reg;
  if (garment === null) return `no edition ${edition} is published`;
  const item = reg.index.get(garment) ?? 0, slot = reg.garmentSlot[item] ?? -1;
  if (slot < 0) return `${garment} is not a garment here`;
  if (dye !== 0 && reg.garmentDyes[item] !== 1) return `${garment} keeps its own colours and takes no dye`;
  const items = host.items, inv = items.inv(rec);
  if (inv.wardrobe < 0) return `${rec.name} has no wardrobe`;
  let at = inv.wardrobe + slot;
  const worn = inv.item[at] === 0;
  if (!worn) for (at = 0; at < inv.bag && inv.item[at] !== 0; at++);
  if (at >= inv.bag && !worn) return `${rec.name} wears something there and has no room in the bag`;
  if (items.mintAt(rec, at, item, 1, 0, "given") !== 1) return `${garment} could not be given`;
  if (!items.restyle(rec, at, edition, dye)) return `${garment} was given, but not in edition ${edition}`;
  if (worn) host.refreshBody(rec);
  const what = `edition ${edition} "${host.people.view().byId.get(edition)?.name ?? ""}" of ${garment}${dye ? ` dyed ${dye & 0xff},${(dye >>> 8) & 0xff},${dye >>> 16}` : ""}`;
  return { worn, said: worn ? `dressed ${rec.name} in ${what}` : `gave ${rec.name} ${what}, in the bag` };
}

/** The survivor in the world a typed name or #number means, or why there is none. */
export function survivorHere(host: Host, typed: string): { client: Client; rec: EntityRecord } | string {
  const numbered = NUMBERED.exec(typed);
  let client: Client | null = null;
  if (numbered) {
    const pid = Number(numbered[1]);
    if (![...host.survivorIds()].includes(pid)) return `no survivor has the number ${pid}`;
    client = host.game.clients.find((c) => !!c?.active && !c.closed && c.pid === pid) ?? null;
    if (!client) return `${host.records.byPid.get(pid)?.name ?? `#${pid}`} is not in the world`;
  } else {
    const here = host.game.clients.filter((c): c is Client => !!c?.active && !c.closed);
    const which = meant(here.map((c) => c.name), typed);
    if (which === NAME_UNCLEAR) return `more than one survivor here could be "${typed}"; give the name exactly`;
    if (which === NAME_NONE) return `nobody called "${typed}" is here`;
    client = here[which]!;
  }
  const rec = host.records.byPid.get(client.pid);
  if (!rec || client.ent < 0 || rec.dead) return `${rec?.name ?? typed} has no body right now`;
  return { client, rec };
}

export function dressCommands(): ConsoleCommand[] {
  return [
    {
      name: "dress",
      usage: "<edition> [survivor | #number] [-dye=a,b,c]",
      examples: ["dress 3", "dress 3 Ada", "dress 3 #12 -dye=12,40,200"],
      help: "Give a published garment edition (its number on the Wardrobe page), worn where its slot is empty, else in the bag: to yourself, or to a survivor in the world by name or number. -dye sets its three palette colours.",
      admin: true,
      run(ctx, args) {
        const dyed = args.map((a) => DYE.exec(a)).find((m) => m) ?? null;
        const words = args.filter((a) => !DYE.test(a));
        const edition = Number(words[0]);
        if (!Number.isSafeInteger(edition) || edition <= 0) return USAGE;
        const dye = dyed ? [Number(dyed[1]), Number(dyed[2]), Number(dyed[3])] : [0, 0, 0];
        if (dye.some((d) => d > 255)) return "each dye colour is a palette number, 0 to 255";
        const name = words.slice(1).join(" ");
        let rec: EntityRecord | undefined;
        if (name === "") {
          const c = ctx.client;
          rec = c && c.ent >= 0 ? ctx.host.records.byPid.get(c.pid) : undefined;
          if (!rec) return `name a survivor; ${USAGE}`;
        } else {
          const found = survivorHere(ctx.host, name);
          if (typeof found === "string") return found;
          rec = found.rec;
        }
        const done = giveEdition(ctx.host, rec, edition, packed(dye));
        return typeof done === "string" ? done : done.said;
      },
    },
  ];
}

/**
 * What the Wardrobe page's give asks: edition `edition` to the survivor `survivor` (a name or #number) in `dye`, sent as
 * the console's line with `by`'s rights, so the console checks it and the admin log keeps it as theirs. The answer's
 * status is 404 where nobody is meant, 409 where they are not in the world.
 */
export function dressFromPage(host: Host, edition: unknown, survivor: unknown, dye: unknown, by: Actor): { status: number; answer: Record<string, unknown> } {
  if (!Number.isSafeInteger(edition) || (edition as number) <= 0) return { status: 400, answer: { error: "Name the edition by its number." } };
  if (typeof survivor !== "string" || survivor.trim() === "" || survivor.length > 64 || /[\r\n]/.test(survivor)) return { status: 400, answer: { error: "Name a survivor in the world, or give their number as #12." } };
  const colours = dye ?? [0, 0, 0];
  if (!Array.isArray(colours) || colours.length !== 3 || !colours.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) return { status: 400, answer: { error: "A dye is three palette numbers, 0 to 255." } };
  if (host.people.garmentOf(edition as number) === null) return { status: 404, answer: { error: `No edition ${edition} is published.` } };
  const found = survivorHere(host, survivor.trim());
  if (typeof found === "string") return { status: /not in the world|no body/.test(found) ? 409 : 404, answer: { error: `${found[0]!.toUpperCase()}${found.slice(1)}.` } };
  const line = `dress ${edition} #${found.rec.pid}${colours.some((c) => c !== 0) ? ` -dye=${colours.join(",")}` : ""}`;
  return { status: 200, answer: { line, survivor: found.rec.name, said: host.console.exec({ host, client: null, actor: by }, line) } };
}
