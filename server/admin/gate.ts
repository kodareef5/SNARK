// The admin pages' one gate: the sound board and /admin/. A development server opens them to anyone it lets in, which is
// this machine only unless asked otherwise; any other server only to a browser that gives the map's or the cluster's
// password, the ones `enablecheats` takes, as the password of HTTP's basic sign-in, with wrong guesses counted as that
// command counts them.

import { posix } from "node:path";
import { RANK_CLUSTER, RANK_MAP, RANK_STAFF } from "../../shared/ranks.ts";
import { PAGE_ACTOR, type Actor } from "../acts.ts";
import { sameSecret } from "../commands/core.ts";
import type { Guesses } from "../guesses.ts";
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
}

/** Who a development server's open pages act as. */
export const DEVELOPMENT = "(development)";

/** Who each request that passed the gate is from. */
const actors = new WeakMap<Request, Actor>();

/** Who a request to an admin page is from: the nameless page where the gate did not say. */
export function actorOf(req: Request): Actor {
  return actors.get(req) ?? PAGE_ACTOR;
}

/** Null where the admin pages may be shown, else the answer that says why not. */
export function refused(req: Request, who: string, gate: AdminGate): Response | null {
  // A development server's open pages manage nothing: they act at staff rank, with cheats only.
  if (gate.dev) return pass(req, gate, { name: DEVELOPMENT, id: "", pid: 0, rank: RANK_STAFF, via: "page", from: who });
  const cluster = gate.cluster ?? null;
  if (gate.password === null && cluster === null) return new Response("the admin pages open on a development server, or where ServerAdminPassword or ClusterAdminPassword is set", { status: 404 });
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
  const ask = new Response("the admin pages ask for the server's admin password (any name will do)", { status: 401, headers: { "www-authenticate": `Basic realm="${realm}", charset="UTF-8"` } });
  if (given === null) return ask;
  const colon = given.indexOf(":");
  const [typed, secret] = [colon < 0 ? "" : given.slice(0, colon), given.slice(colon + 1)];
  // Both are compared whatever the first gave, so the time taken does not say which matched.
  const asCluster = cluster !== null && sameSecret(secret, cluster);
  const asMap = gate.password !== null && sameSecret(secret, gate.password);
  if (!asCluster && !asMap) {
    gate.guesses.wrong(who, gate.tick());
    return ask;
  }
  const rank = asCluster ? RANK_CLUSTER : RANK_MAP;
  // Only the highest password there is forgives the count: else a map admin could clear it between guesses at the cluster's.
  if (rank === (cluster !== null ? RANK_CLUSTER : RANK_MAP)) gate.guesses.right(who);
  // Round brackets are in no survivor's name, so a typed name can never pass as a survivor's.
  const name = SURVIVOR_NAME.test(typed) ? `(${typed})` : asCluster ? "(cluster password)" : "(map password)";
  return pass(req, gate, { name, id: "", pid: 0, rank, via: "page", from: who });
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
