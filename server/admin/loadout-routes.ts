// What the loadouts' admin page asks of a world (planning/workstreams/loadouts.md). It reads with GET and changes with
// POST, behind the admin pages' gate (gate.ts), which the caller has passed. A change is refused as the drop book's
// page's is (supply-routes.ts): 403 from another site, 400 for a body the route does not take, 409 for a book saved
// over another editor's, 422 for a book with faults, each with its path. The store checks and keeps the book
// (server/loadout/store.ts). A loadout is handed to a survivor by the console's own `loadout` command, so the page and
// an operator at the console do one thing and both are in the admin journal. The page names a survivor by its number,
// never by a name another survivor's could be taken for.

import { LOADOUT_ID, MOST } from "../../shared/loadout/book.ts";
import { loadoutCatalog } from "../../shared/loadout/catalog.ts";
import { OP_ADMIN } from "../console.ts";
import type { Host } from "../host.ts";
import { carried } from "../loadout/capture.ts";
import type { LoadoutSave } from "../loadout/store.ts";
import { NAME_NONE, NAME_UNCLEAR, meant } from "../names.ts";
import type { EntityRecord } from "../records.ts";
import { PAGE, body, refusedWrite } from "./supply-routes.ts";

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };
const json = (answer: unknown, status = 200): Response => new Response(JSON.stringify(answer), { status, headers: JSON_HEADERS });
/** The largest body a change may be: a book at its largest, and its note. */
export const LOADOUT_BODY_MOST = MOST.bytes + 4096;
const STALE = "The book was saved by another editor since this page read it.";

/** The console line that hands loadout `id` to the survivor numbered `pid`, or null where either is not what it must be. */
export function applyLine(id: unknown, pid: unknown, clear: boolean): string | null {
  if (typeof id !== "string" || !LOADOUT_ID.test(id) || typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return null;
  return `loadout ${id} #${pid}${clear ? " -clear" : ""}`;
}

export class LoadoutRoutes {
  private readonly host: Host;
  private catalog = "";

  constructor(host: Host) {
    this.host = host;
  }

  /** The answer to a request under /admin/loadouts/, or null for any other path. `at` is the path as the gate reads it. */
  answer(req: Request, at: string, url: URL): Response | Promise<Response> | null {
    if (!at.startsWith("/admin/loadouts/")) return null;
    const what = at.slice("/admin/loadouts/".length);
    if (what.endsWith(".json")) {
      if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
      return this.read(what.slice(0, -5), url);
    }
    const no = refusedWrite(req);
    if (no) return no;
    return body(req, LOADOUT_BODY_MOST).then((b) => (b === null ? json({ error: "Expected a JSON object no larger than a book." }, 400) : this.write(what, b)));
  }

  private read(what: string, url: URL): Response {
    const store = this.host.loadoutBook;
    if (what === "book") return json({ revision: store.book.revision, builtin: store.builtin, kept: store.kept, book: store.book, warnings: store.warnings() });
    if (what === "catalog") {
      // The content does not change while the world runs.
      if (this.catalog === "") this.catalog = JSON.stringify(loadoutCatalog(this.host.world.reg));
      return new Response(this.catalog, { headers: JSON_HEADERS });
    }
    if (what === "capture") {
      const pid = url.searchParams.get("pid");
      const rec = pid !== null ? this.numbered(Number(pid)) : this.survivor(url.searchParams.get("survivor") ?? "");
      if (typeof rec === "string") return json({ error: rec }, 404);
      const all = carried(this.host, rec);
      // `cut` is how many more entries the survivor carries than a loadout holds.
      return json({ survivor: rec.name, entries: all.slice(0, MOST.entries), cut: Math.max(0, all.length - MOST.entries) });
    }
    return json({ error: "No such page." }, 404);
  }

  /** The survivor with the number `pid`, online or saved, or why there is none. */
  private numbered(pid: number): EntityRecord | string {
    for (const known of this.host.survivorIds()) if (known === pid) return this.host.records.byPid.get(pid) ?? `No survivor has the number ${pid}.`;
    return `No survivor has the number ${pid}.`;
  }

  /** The survivor a name means, online or saved, or why there is none. */
  private survivor(name: string): EntityRecord | string {
    if (name === "") return "Name a survivor.";
    const all: EntityRecord[] = [];
    for (const pid of this.host.survivorIds()) {
      const rec = this.host.records.byPid.get(pid);
      if (rec) all.push(rec);
    }
    const which = meant(all.map((r) => r.name), name);
    if (which === NAME_UNCLEAR) return `Several survivors could be meant by ${name}: write the name as it is.`;
    return which === NAME_NONE ? `No survivor is called ${name}.` : all[which]!;
  }

  private write(what: string, b: Record<string, unknown>): Response {
    const store = this.host.loadoutBook;
    const saved = (r: LoadoutSave, did: string): Response => {
      if (r.ok) {
        this.did(`${did}: revision ${r.revision}`);
        return json({ revision: r.revision, warnings: store.warnings() });
      }
      if ("conflict" in r) return json({ error: STALE, revision: r.conflict }, 409);
      // The file could not be written: nothing changed, and the page keeps its draft.
      if ("failed" in r) return json({ error: `${r.failed[0]!.toUpperCase()}${r.failed.slice(1)}.` }, 500);
      return json({ error: "The book has faults.", faults: r.faults }, 422);
    };
    if (what === "reset") {
      // The built-ins come back as a new revision: a page that names the revision it read loses to another editor's save.
      if (b.expected !== undefined && b.expected !== store.book.revision) return json({ error: STALE, revision: store.book.revision }, 409);
      return saved(store.reset(PAGE), "loadouts reset to the built-ins");
    }
    if (what === "book") {
      const expected = b.expected;
      if (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 0) return json({ error: "A save names the revision it was made from." }, 400);
      if (typeof b.book !== "object" || b.book === null) return json({ error: "A save carries the book." }, 400);
      const note = typeof b.note === "string" ? b.note.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200) : "";
      return saved(store.save(b.book, expected, PAGE, note), `loadouts saved${note === "" ? "" : ` (${note})`}`);
    }
    if (what === "apply") {
      const line = applyLine(b.loadout, b.pid, b.clear === true);
      if (line === null) return json({ error: "Name a loadout by its id, and a survivor by its number." }, 400);
      const rec = this.numbered(b.pid as number);
      if (typeof rec === "string") return json({ error: rec }, 404);
      // Only that survivor, and only while it is here: nobody else is dressed, or cleared, in its place.
      if (!this.host.online(rec.pid)) return json({ error: `${rec.name} is not in the world. A loadout is handed to a survivor who is.` }, 409);
      // Run as the operator would type it: the console checks it and writes it in the journal.
      return json({ line, survivor: rec.name, said: this.host.console.exec({ host: this.host, client: null }, line) });
    }
    return json({ error: "No such act." }, 404);
  }

  /** A save is not a console line: it is journaled here as one would be. */
  private did(what: string): void {
    this.host.persistence?.journal(OP_ADMIN, new TextEncoder().encode(`${PAGE}\t${what}`));
  }
}
