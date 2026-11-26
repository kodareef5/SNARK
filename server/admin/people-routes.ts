// The admin pages' API for the cluster's garment editions (server/people/store.ts), under /admin/people/: what the store
// holds, a new edition, a retirement or its undoing, and a print's upload. The caller has checked the admin password and,
// for a POST, the page's origin (server/admin/site.ts). A change is judged again at the admin rank once its body is in
// (gate.ts stillHolds), and written in the admin log as its actor's. An edition is never changed or deleted: a stale
// revision answers 409 with the store as it is now.
//
//   GET  /admin/people/state     the editions, retired ones marked, who made each, the garments, the manifest and the caps
//   POST /admin/people/publish   {revision, garment, colours, name, print?: {hash, place}}: a new edition; answers its id
//   POST /admin/people/retire    {revision, id, retired}: hides an edition from the pick list, or shows it again
//   POST /admin/people/print     the raw PNG: checked on its own thread and kept by hash; answers the hash
//
// The manifest itself is /media/people.<id>.json, which anyone may fetch and keep for good.
import type { Registry } from "../../shared/content/registry.ts";
import {
  EDITION_NAME_MAX, PRINT_BYTES_MAX, PRINT_SCALE_MAX, PRINT_SCALE_MIN, PRINT_SIDE_MAX, peopleManifestPath, printName, printPath, readDraft, type EditionDraft,
} from "../../shared/people/doc.ts";
import { WARDROBE_NAMES } from "../../shared/sim/items.ts";
import type { Acts } from "../acts.ts";
import type { PeopleStore, PeopleView } from "../people/store.ts";
import { entryReply, readEntryJson } from "../survivor-access.ts";
import { actorOf, onlyRead, stillHolds, type Recheck } from "./gate.ts";

const PEOPLE_GETS: readonly string[] = ["/admin/people/state"];
/** The paths that take a POST, which the front passes on (server/front.ts). */
export const PEOPLE_POSTS: readonly string[] = ["/admin/people/publish", "/admin/people/retire", "/admin/people/print"];
export const PEOPLE_PATHS: readonly string[] = [...PEOPLE_GETS, ...PEOPLE_POSTS];

const CHANGE_BYTES_MAX = 16 * 1024;

/** A file's size, as its act says it. */
const sizeOf = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** The garments an edition may be of: every `item/garment` the world's content has. */
function garments(reg: Registry): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  reg.defs.forEach((d, i) => {
    const slot = reg.garmentSlot[i] ?? -1;
    if (d && slot >= 0) out.push({ id: d.id, label: d.type === "item" ? (d.label ?? d.id) : d.id, slot: WARDROBE_NAMES[slot], dyes: reg.garmentDyes[i] === 1, cut: d.type === "item" ? (d.garment?.cut ?? null) : null });
  });
  return out;
}

/** What the admin pages are shown: every edition with whether it is retired and who made it, and what an edition may be. */
export function peopleState(store: PeopleStore, reg: Registry, view: PeopleView = store.view()): Record<string, unknown> {
  return {
    revision: view.revision,
    manifest: view.manifestId === "" ? null : { id: view.manifestId, path: peopleManifestPath(view.manifestId) },
    caps: { side: PRINT_SIDE_MAX, bytes: PRINT_BYTES_MAX, scaleMin: PRINT_SCALE_MIN, scaleMax: PRINT_SCALE_MAX, name: EDITION_NAME_MAX },
    garments: garments(reg),
    editions: view.editions.map((e) => ({ ...e, retired: view.retired.has(e.id), ...view.made.get(e.id), ...(e.print ? { printPath: printPath(e.print.hash) } : {}) })),
  };
}

/** Why a draft may not be an edition of the world's content, or null. */
function garmentFault(draft: EditionDraft, reg: Registry): string | null {
  const i = reg.index.get(draft.garment);
  if (i === undefined || (reg.garmentSlot[i] ?? -1) < 0) return `${draft.garment} is not a garment.`;
  if (reg.garmentDyes[i] !== 1 && draft.colours.some((c) => c !== 0)) return `${draft.garment} keeps its own colours: each of an edition's is 0.`;
  return null;
}

/** An edition in the log's words. */
const named = (id: number, name: string): string => `the edition ${id} "${name}"`;

/** Reads a JSON change, or answers why not. */
async function change(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    return await readEntryJson(req, CHANGE_BYTES_MAX);
  } catch {
    return entryReply({ error: "Expected a small JSON change." }, 400);
  }
}

async function publish(req: Request, store: PeopleStore, reg: Registry, did: (what: string) => void, holds: () => Response | null): Promise<Response> {
  const body = await change(req);
  if (body instanceof Response) return body;
  const lost = holds();
  if (lost) return lost;
  if (!Number.isSafeInteger(body.revision)) return entryReply({ error: "Send the revision the page was showing." }, 400);
  const draft = readDraft(body);
  if (typeof draft === "string") return entryReply({ error: draft }, 400);
  const fault = garmentFault(draft, reg);
  if (fault) return entryReply({ error: fault }, 400);
  const by = actorOf(req);
  const done = store.publish(body.revision as number, draft, { name: by.name, id: by.id });
  if ("status" in done) return entryReply({ error: done.error, ...(done.view ? peopleState(store, reg, done.view) : {}) }, done.status);
  const c = draft.colours;
  did(`published ${named(done.id, draft.name)} of ${draft.garment} (colours ${c.join(", ")}${draft.print ? `; print ${printName(draft.print.hash)}` : ""})`);
  return entryReply({ id: done.id, ...peopleState(store, reg, done.view) });
}

async function retire(req: Request, store: PeopleStore, reg: Registry, did: (what: string) => void, holds: () => Response | null): Promise<Response> {
  const body = await change(req);
  if (body instanceof Response) return body;
  const lost = holds();
  if (lost) return lost;
  if (!Number.isSafeInteger(body.revision)) return entryReply({ error: "Send the revision the page was showing." }, 400);
  if (!Number.isSafeInteger(body.id) || (body.id as number) <= 0 || typeof body.retired !== "boolean") return entryReply({ error: "Name an edition by its id, and say whether it is retired." }, 400);
  const id = body.id as number;
  const done = store.retire(body.revision as number, id, body.retired);
  if ("status" in done) return entryReply({ error: done.error, ...(done.view ? peopleState(store, reg, done.view) : {}) }, done.status);
  const name = done.view.byId.get(id)!.name;
  if (!done.changed) onlyRead(req);
  else did(body.retired ? `retired ${named(id, name)}` : `brought back ${named(id, name)}`);
  return entryReply(peopleState(store, reg, done.view));
}

/**
 * The body of an upload, exactly as long as it says it is and no longer than a print, or the answer why not. A length
 * over the cap is answered before the body is read; the server reads no more than the length a request gives.
 */
async function bodyOf(req: Request): Promise<ArrayBuffer | Response> {
  const length = Number(req.headers.get("content-length") ?? Number.NaN);
  if (!(length > 0) || !Number.isSafeInteger(length)) return entryReply({ error: "An upload says its length." }, 411);
  if (length > PRINT_BYTES_MAX) return entryReply({ error: `A print is ${Math.round(PRINT_BYTES_MAX / 1024)} KB at most.` }, 413);
  let bytes: Uint8Array;
  try {
    // The body as the server holds it, without a copy: reading it chunk by chunk costs the thread twice as much.
    bytes = await req.bytes();
  } catch {
    return entryReply({ error: "The upload broke off." }, 400);
  }
  if (bytes.length !== length) return entryReply({ error: `The upload was ${bytes.length < length ? "shorter" : "longer"} than it said.` }, 400);
  return bytes.byteOffset === 0 && bytes.buffer.byteLength === length ? (bytes.buffer as ArrayBuffer) : bytes.slice().buffer;
}

async function takePrint(req: Request, store: PeopleStore, did: (what: string) => void, holds: () => Response | null): Promise<Response> {
  const bytes = await bodyOf(req);
  if (bytes instanceof Response) return bytes;
  const got = await store.check(bytes);
  const lost = holds();
  if (lost) {
    if ("part" in got) store.drop(got.part);
    return lost;
  }
  if ("fault" in got) return entryReply({ error: "The print could not be checked. Try again." }, 500);
  if ("error" in got) return entryReply({ error: got.error }, 422);
  const { info } = got, fresh = store.place(got.part, info.hash);
  if (fresh) did(`uploaded the print ${printName(info.hash)} (${info.width}×${info.height}, ${sizeOf(info.bytes)})`);
  else onlyRead(req);
  return entryReply({ hash: info.hash, width: info.width, height: info.height, bytes: info.bytes, path: printPath(info.hash), known: !fresh });
}

/**
 * Answers a request under /admin/people/, or null for any other path. `reg` is the world's content, which a garment is
 * checked against. Each change is written in `acts` as the request's actor's; with `recheck`, the actor's rank is judged
 * again once its body is in.
 */
export function peopleAdmin(req: Request, path: string, store: PeopleStore, reg: () => Registry, acts: Pick<Acts, "write"> | null = null, recheck: Recheck | null = null): Promise<Response> | Response | null {
  if (!PEOPLE_PATHS.includes(path)) return null;
  const did = (what: string): void => void acts?.write(actorOf(req), what);
  // A development world's open page passes the gate at staff rank and may change the editions, by design, as on every admin route.
  const holds = (): Response | null => (recheck ? stillHolds(req, recheck) : null);
  if (PEOPLE_GETS.includes(path)) {
    if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET" } });
    return entryReply(peopleState(store, reg()));
  }
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  if (path === "/admin/people/print") return takePrint(req, store, did, holds);
  return path === "/admin/people/publish" ? publish(req, store, reg(), did, holds) : retire(req, store, reg(), did, holds);
}
