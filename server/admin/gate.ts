// The admin pages' one gate: the sound board and /admin/. A development server opens them to anyone it lets in, which is
// this machine only unless asked otherwise; any other server only to a browser that gives the map's or the cluster's
// password, the ones `enablecheats` takes, as the password of HTTP's basic sign-in, or a survivor's name or ID with their
// own password where their groups make them an admin, with wrong guesses counted as that command counts them.

import { posix } from "node:path";
import { RANK_ADMIN, RANK_CLUSTER, RANK_MAP, RANK_OPEN, RANK_STAFF } from "../../shared/ranks.ts";
import { PAGE_ACTOR, type Actor } from "../acts.ts";
import { sameSecret } from "../commands/core.ts";
import type { Guesses } from "../guesses.ts";
import { DUMMY_HASH, passwordHash, sameHash } from "../permissions/secrets.ts";
import { NAME as SURVIVOR_NAME } from "../sessions.ts";

/** Not fatal: bytes that are not UTF-8 read as replacement letters, which no password is, so they are a wrong guess. */
const UTF8 = new TextDecoder();

export interface AdminGate {
  dev: boolean;
  password: string | null;
  guesses: Guesses;
  tick: () => number;
  world?: number;
  /** The cluster's password, which passes at the cluster's rank. */
  cluster?: string | null;
  /** Told of the actor of each request that passed. */
  passed?: (by: Actor) => void;
  /** Survivors' own passwords (server/permissions/secrets.ts), taken with a survivor's name or ID. */
  staff?: StaffPasswords;
}

/** A survivor as the gate weighs their own password: the hash of it ("" for none), and the rank their groups give signed in. */
export interface StaffSurvivor {
  readonly name: string;
  readonly id: string;
  readonly pid: number;
  readonly hash: string;
  readonly rank: number;
}

export interface StaffPasswords {
  /** Whether any survivor has a password. */
  any(): boolean;
  /** The survivor a name on this world or an ID names, or null. */
  find(user: string): StaffSurvivor | null;
  /** Whether a hash is of a password replaced or cleared within the last day. */
  retired(hash: string): boolean;
}

/** Who a development server's open pages act as. */
export const DEVELOPMENT = "(development)";

/** Who each request that passed the gate is from. */
const actors = new WeakMap<Request, Actor>();

/** Who a request to an admin page is from: the nameless page where the gate did not say. */
export function actorOf(req: Request): Actor {
  return actors.get(req) ?? PAGE_ACTOR;
}

/** POSTs whose handler only read, such as a dry run, which the log of a page's changes leaves out. */
const reads = new WeakSet<Request>();

/** Marks a POST as one that changed nothing. */
export function onlyRead(req: Request): void {
  reads.add(req);
}

export function changedNothing(req: Request): boolean {
  return reads.has(req);
}

/** Null where the admin pages may be shown, else the answer that says why not. */
export function refused(req: Request, who: string, gate: AdminGate): Response | null {
  // A development server's open pages manage nothing: they act at staff rank, with cheats only.
  if (gate.dev) return pass(req, gate, { name: DEVELOPMENT, id: "", pid: 0, rank: RANK_STAFF, via: "page", from: who, baseRank: RANK_STAFF });
  const cluster = gate.cluster ?? null;
  const staff = gate.staff ?? null;
  if (gate.password === null && cluster === null && !staff?.any()) return new Response("the admin pages open on a development server, where ServerAdminPassword or ClusterAdminPassword is set, or once a survivor has claimed a password", { status: 404 });
  const wait = gate.guesses.wait(who, gate.tick());
  if (wait > 0) return new Response("too many wrong passwords: wait a while", { status: 429 });
  const auth = /^Basic (.+)$/.exec(req.headers.get("authorization") ?? "");
  let given: string | null = null;
  try {
    // atob gives the sign-in's bytes one to a letter; the browser sent them as UTF-8, as the charset below asks.
    given = auth ? UTF8.decode(Uint8Array.from(atob(auth[1]!), (c) => c.charCodeAt(0))) : null;
  } catch {
    given = null;
  }
  const realm = gate.world === undefined ? "SNARK admin" : `SNARK admin world ${gate.world}`;
  const ask = new Response("the admin pages ask for the server's admin password with any name, or a survivor's name or ID with their own password", { status: 401, headers: { "www-authenticate": `Basic realm="${realm}", charset="UTF-8"` } });
  if (given === null) return ask;
  const colon = given.indexOf(":");
  const [typed, secret] = [colon < 0 ? "" : given.slice(0, colon), given.slice(colon + 1)];
  // All are compared whatever the others gave, so the time taken says neither which matched nor whether the name has a password.
  const asCluster = cluster !== null && sameSecret(secret, cluster);
  const asMap = gate.password !== null && sameSecret(secret, gate.password);
  const hash = staff ? passwordHash(secret) : "";
  const found = staff?.find(typed) ?? null;
  const asOwn = staff !== null && sameHash(hash, found?.hash || DUMMY_HASH) && found !== null && found.hash !== "" && found.rank >= RANK_ADMIN;
  // Only the highest password there is forgives the count: else a map admin could clear it between guesses at the cluster's.
  const top = cluster !== null ? RANK_CLUSTER : gate.password !== null ? RANK_MAP : RANK_OPEN;
  if (!asCluster && !asMap && asOwn && found !== null) {
    if (found.rank >= top) gate.guesses.right(who);
    return pass(req, gate, { name: found.name, id: found.id, pid: found.pid, rank: found.rank, via: "page", from: who, baseRank: RANK_OPEN, signedHash: found.hash });
  }
  if (!asCluster && !asMap) {
    // A password replaced or cleared is not a guess: an open page goes on sending it every few seconds.
    if (!staff?.retired(hash)) gate.guesses.wrong(who, gate.tick());
    return ask;
  }
  const rank = asCluster ? RANK_CLUSTER : RANK_MAP;
  if (rank >= top) gate.guesses.right(who);
  // Round brackets are in no survivor's name, so a typed name can never pass as a survivor's.
  const name = SURVIVOR_NAME.test(typed) ? `(${typed})` : asCluster ? "(cluster password)" : "(map password)";
  return pass(req, gate, { name, id: "", pid: 0, rank, via: "page", from: who, baseRank: rank });
}

/** Stamps a request that passed with its own actor, and tells the gate's listener. */
function pass(req: Request, gate: AdminGate, by: Actor): null {
  actors.set(req, by);
  gate.passed?.(by);
  return null;
}

/**
 * A request's path as the admin pages are matched by: decoded, dots and doubled slashes resolved, and in lower case, since a
 * file system that ignores case would serve /Sounds.html as the page (D702). Null for one that cannot be decoded.
 */
export function adminPath(pathname: string): string | null {
  try {
    return posix.normalize(decodeURIComponent(pathname)).toLowerCase();
  } catch {
    return null;
  }
}

/** Whether a request's path is an admin page's: the sound board's page, /admin, or anything under /admin/, in any spelling. */
export function adminAsked(pathname: string): boolean {
  const at = adminPath(pathname);
  return at === "/sounds.html" || at === "/admin" || (at?.startsWith("/admin/") ?? false);
}

/**
 * Whether a request that changes something came from a page of this server: its Origin is the host it asked for. A
 * browser sends Origin with every POST from a page, so another site's page cannot make a signed-in browser send one
 * that passes; a request with no Origin is not from a page at all, and is as the admin's own tool sent it.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  const host = req.headers.get("host");
  const page = origin.toLowerCase();
  const scheme = page.indexOf("://");
  return scheme > 0 && host !== null && page.slice(scheme + 3) === host.toLowerCase();
}
