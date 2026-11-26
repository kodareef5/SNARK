// The admin pages' API for the cluster's people store (server/people/store.ts), under /admin/people/: what the store
// holds, a new edition, a saved person, outfit or population, a retirement or its undoing, and a print's upload. The
// caller has checked the admin password and, for a POST, the page's origin (server/admin/site.ts). A change is judged
// again at the admin rank once its body is in (gate.ts stillHolds), and written in the admin log as its actor's. Nothing
// is changed or deleted: a stale revision answers 409 with the store as it is now.
//
//   GET  /admin/people/state     every edition, person, outfit and admin population at its latest revision, retired ones
//                                marked, who made each; the garments, the built-in populations, the manifest and the caps
//   POST /admin/people/publish   {revision, garment, colours, name, print?: {hash, place}}: a new edition; answers its id
//   POST /admin/people/save      {kind, id, rev, doc} or, for a new population, {kind, id: null, rev: 0, copyOf, label?}:
//                                a new person, outfit or population where id is null, else the revision after rev
//   POST /admin/people/retire    {revision, id, retired, kind?}: hides a thing from the pick lists, or shows it again
//   POST /admin/people/print     the raw PNG: checked on its own thread and kept by hash; answers the hash
//
// The manifest itself is /media/people.<id>.json, which anyone may fetch and keep for good.
import { classesById, defRefFaults } from "../../shared/content/classes.ts";
import type { Def } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import {
  CHOICES_MAX, EDITION_NAME_MAX, NOTES_MAX, PRINT_BYTES_MAX, PRINT_SCALE_MAX, PRINT_SCALE_MIN, PRINT_SIDE_MAX, REVISED_KINDS, STORE_KINDS, peopleManifestPath, printName, printPath,
  readDraft, readOutfit, readPerson, readPopulation, storePopulation, type Bodies, type EditionDraft, type OutfitDoc, type PersonDoc, type PopulationDoc, type RevisedKind, type StoreKind,
  type WornDoc,
} from "../../shared/people/doc.ts";
import { populationsOf } from "../../shared/people/person.ts";
import { WARDROBE_NAMES } from "../../shared/sim/items.ts";
import type { Acts } from "../acts.ts";
import type { PeopleStore, PeopleView } from "../people/store.ts";
import { entryReply, readEntryJson } from "../survivor-access.ts";
import { actorOf, onlyRead, stillHolds, type Recheck } from "./gate.ts";

const PEOPLE_GETS: readonly string[] = ["/admin/people/state"];
/** The paths that take a POST, which the front passes on (server/front.ts). */
export const PEOPLE_POSTS: readonly string[] = ["/admin/people/publish", "/admin/people/save", "/admin/people/retire", "/admin/people/print"];
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
    people: latest(view, "person"),
    outfits: latest(view, "outfit"),
    populations: latest(view, "population"),
    builtIns: populationsOf(reg).list,
    limits: { name: EDITION_NAME_MAX, notes: NOTES_MAX, choices: CHOICES_MAX },
  };
}

/** Each thing of a kind at its latest revision, with who made that revision and whether the thing is retired. */
function latest(view: PeopleView, kind: RevisedKind): Record<string, unknown>[] {
  const retired = view.retiredOf[kind];
  return [...view.records[kind].values()].map((revs) => {
    const last = revs[revs.length - 1]!;
    return { id: last.id, rev: last.rev, retired: retired.has(last.id), ...last.made, doc: last.body };
  });
}

/** Why a piece may not be worn in wardrobe slot `slot` of the world's content, or null. */
function pieceFault(w: { garment: string; edition: number }, slot: number, dyed: boolean, reg: Registry, store: PeopleStore): string | null {
  const i = reg.index.get(w.garment);
  if (i === undefined || (reg.garmentSlot[i] ?? -1) < 0) return `${w.garment} is not a garment.`;
  if (reg.garmentSlot[i] !== slot) return `${w.garment} is worn as a ${WARDROBE_NAMES[reg.garmentSlot[i]!]}, not a ${WARDROBE_NAMES[slot]}.`;
  if (dyed && reg.garmentDyes[i] !== 1) return `${w.garment} keeps its own colours: its dye is 0.`;
  if (w.edition !== 0 && store.garmentOf(w.edition) !== w.garment) return `The edition ${w.edition} is not one of ${w.garment}.`;
  return null;
}

const dyed = (w: WornDoc | { dye: readonly number[] }): boolean => w.dye.some((c) => c !== 0);

/** Why a thing may not be saved as the world's content and the store have them, or null. */
function worldFault(kind: RevisedKind, doc: Bodies[RevisedKind], reg: Registry, store: PeopleStore): string | null {
  if (kind === "person") {
    const p = doc as PersonDoc, look = p.look;
    if ("seed" in look) {
      if (typeof look.population === "string") {
        const content = populationsOf(reg), n = content.number.get(look.population);
        if (n === undefined) return `${look.population} is not a population.`;
        if (content.list[n]!.revision !== look.revision) return `${look.population} is at revision ${content.list[n]!.revision}.`;
      } else if (!store.population(look.population, look.revision)) return `There is no population ${look.population} at revision ${look.revision}.`;
    }
    if (p.outfit !== null && !store.view().records.outfit.has(p.outfit)) return `There is no outfit ${p.outfit}.`;
    for (const [slot, w] of (p.wardrobe ?? []).entries()) {
      const fault = w && pieceFault(w, slot, dyed(w), reg, store);
      if (fault) return fault;
    }
    return null;
  }
  if (kind === "outfit") {
    for (const [slot, s] of (doc as OutfitDoc).slots.entries()) {
      for (const c of s?.choices ?? []) {
        const fault = pieceFault(c, slot, dyed(s!), reg, store);
        if (fault) return fault;
      }
    }
    return null;
  }
  // Held to the content kind's own reference rules, so the two never differ.
  const def = storePopulation(0, 1, doc as PopulationDoc) as unknown as Def;
  const fault = defRefFaults(def, classesOf(reg))[0];
  return fault === undefined ? null : `${fault.slice(def.id.length + 2)}.`;
}

const classes = new WeakMap<Registry, Map<string, string>>();

/** Each of the world's definitions' class by id, made once for a registry. */
function classesOf(reg: Registry): Map<string, string> {
  let held = classes.get(reg);
  if (!held) classes.set(reg, (held = classesById(reg.defs.filter((d): d is Def => !!d))));
  return held;
}

/** A thing's name in the log's words. */
const thing = (kind: RevisedKind, id: number, doc: Bodies[RevisedKind]): string => `the ${kind} ${id} "${kind === "population" ? (doc as PopulationDoc).label : (doc as PersonDoc | OutfitDoc).name}"`;

/** The body a save sends, read by its kind, or why not. A new population may be a copy of a built-in one. */
function docOf(kind: RevisedKind, body: Record<string, unknown>, reg: Registry): Bodies[RevisedKind] | string {
  if (kind === "population" && body.copyOf !== undefined) {
    if (body.id !== null) return "Only a new population is made as a copy.";
    const content = populationsOf(reg), n = typeof body.copyOf === "string" ? content.number.get(body.copyOf) : undefined;
    if (n === undefined) return `${String(body.copyOf)} is not a built-in population.`;
    const { type: _t, id: _i, revision: _r, aliases: _a, ...rest } = content.list[n]! as unknown as Record<string, unknown>;
    return readPopulation({ ...rest, label: body.label ?? [...`${String(rest.label)} copy`].slice(0, EDITION_NAME_MAX).join("") });
  }
  const doc = body.doc;
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return `Send the ${kind} as doc.`;
  const d = doc as Record<string, unknown>;
  return kind === "person" ? readPerson(d) : kind === "outfit" ? readOutfit(d) : readPopulation(d);
}

async function save(req: Request, store: PeopleStore, reg: Registry, did: (what: string) => void, holds: () => Response | null): Promise<Response> {
  const body = await change(req);
  if (body instanceof Response) return body;
  const lost = holds();
  if (lost) return lost;
  const kind = body.kind as RevisedKind;
  if (!(REVISED_KINDS as readonly unknown[]).includes(kind)) return entryReply({ error: `Name the kind: ${REVISED_KINDS.join(", ")}.` }, 400);
  const id = body.id === null || body.id === undefined ? null : body.id;
  if (id !== null && !(Number.isSafeInteger(id) && (id as number) >= 1)) return entryReply({ error: `Name the ${kind} by its id, or null for a new one.` }, 400);
  if (!(Number.isSafeInteger(body.rev) && (body.rev as number) >= 0)) return entryReply({ error: `Send the revision of the ${kind} the page was showing, 0 for a new one.` }, 400);
  const doc = docOf(kind, body, reg);
  if (typeof doc === "string") return entryReply({ error: doc }, 400);
  const fault = worldFault(kind, doc, reg, store);
  if (fault) return entryReply({ error: fault }, 400);
  const by = actorOf(req);
  const done = store.save(kind, id as number | null, body.rev as number, doc, { name: by.name, id: by.id });
  if ("status" in done) return entryReply({ error: done.error, ...(done.view ? peopleState(store, reg, done.view) : {}) }, done.status);
  if (!done.changed) onlyRead(req);
  else if (id === null) did(`made ${thing(kind, done.id, doc)}${typeof body.copyOf === "string" ? ` from ${body.copyOf}` : ""}`);
  else did(`saved ${thing(kind, done.id, doc)} (revision ${done.rev})`);
  return entryReply({ id: done.id, rev: done.rev, changed: done.changed, ...peopleState(store, reg, done.view) });
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
  const kind = (body.kind ?? "edition") as StoreKind;
  if (!(STORE_KINDS as readonly unknown[]).includes(kind)) return entryReply({ error: `Name the kind: ${STORE_KINDS.join(", ")}.` }, 400);
  if (!Number.isSafeInteger(body.id) || (body.id as number) <= 0 || typeof body.retired !== "boolean") return entryReply({ error: `Name an ${kind === "edition" ? "edition" : kind} by its id, and say whether it is retired.` }, 400);
  const id = body.id as number;
  const done = store.retire(body.revision as number, id, body.retired, kind);
  if ("status" in done) return entryReply({ error: done.error, ...(done.view ? peopleState(store, reg, done.view) : {}) }, done.status);
  let words: string;
  if (kind === "edition") words = named(id, done.view.byId.get(id)!.name);
  else {
    const revs = done.view.records[kind].get(id)!;
    words = thing(kind, id, revs[revs.length - 1]!.body);
  }
  if (!done.changed) onlyRead(req);
  else did(body.retired ? `retired ${words}` : `brought back ${words}`);
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
  if (path === "/admin/people/save") return save(req, store, reg(), did, holds);
  return path === "/admin/people/publish" ? publish(req, store, reg(), did, holds) : retire(req, store, reg(), did, holds);
}
