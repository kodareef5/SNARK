// Which web pages a server answers when they would change something or open a socket: its own, and those its
// AllowedOrigins setting names (server/main.ts, server/admin/routes.ts).

/**
 * Whether a web page at `origin` may open a socket to the server it asked for as `host`. A request with no Origin is not
 * from a page, so it is not asked: the agent and other programs send none, and could send any. A page is let in if this
 * server served it, which is when its origin's host is the host it asks for, or if `allowed` names its origin. `allowed`
 * is the AllowedOrigins setting: origins separated by commas or spaces, or * for any.
 */
export function originAllowed(origin: string | null, host: string | null, allowed: string): boolean {
  if (origin === null) return true;
  const page = origin.toLowerCase();
  const scheme = page.indexOf("://");
  if (scheme > 0 && host !== null && page.slice(scheme + 3) === host.toLowerCase()) return true;
  for (const name of allowed.toLowerCase().split(/[\s,]+/)) {
    if (name === "*" || (name !== "" && name.replace(/\/+$/, "") === page)) return true;
  }
  return false;
}
