// The admin pages' one gate: the sound board and /admin/. A development server opens them to anyone it lets in, which is
// this machine only unless asked otherwise; any other server only to a browser that gives the admin password, the one
// `enablecheats` takes, as the password of HTTP's basic sign-in, with wrong guesses counted as that command counts them.

import { posix } from "node:path";
import { PAGE_ACTOR, type Actor } from "../acts.ts";
import { sameSecret } from "../commands/core.ts";
import type { Guesses } from "../guesses.ts";

/** Not fatal: bytes that are not UTF-8 read as replacement letters, which no password is, so they are a wrong guess. */
const UTF8 = new TextDecoder();

export interface AdminGate {
  dev: boolean;
  password: string | null;
  guesses: Guesses;
  tick: () => number;
  world?: number;
}

/** Who each request that passed the gate is from. */
const actors = new WeakMap<Request, Actor>();

/** Who a request to an admin page is from: the nameless page where the gate did not say. */
export function actorOf(req: Request): Actor {
  return actors.get(req) ?? PAGE_ACTOR;
}

/** Null where the admin pages may be shown, else the answer that says why not. */
export function refused(req: Request, who: string, gate: AdminGate): Response | null {
  if (gate.dev) return null;
  if (gate.password === null) return new Response("the admin pages open on a development server, or where ServerAdminPassword is set", { status: 404 });
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
  if (!sameSecret(given.slice(given.indexOf(":") + 1), gate.password)) {
    gate.guesses.wrong(who, gate.tick());
    return ask;
  }
  gate.guesses.right(who);
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
