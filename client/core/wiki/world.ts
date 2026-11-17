// Which world a page of the wiki shows its figures for, and what that world says it runs.

/** What a world's settings.json says (server/main.ts worldSettings): its name, its map, and its public settings not at their default. */
export interface ServerSaid {
  readonly name: string;
  readonly map: string;
  readonly settings: Readonly<Record<string, number | boolean | string>>;
}

/**
 * The path of the world whose figures a page shows: one its address names (?world=/miami); else the one it was opened
 * from, a page of the same site outside the wiki; else the one the visitor's last page of the wiki had. "" is a world at
 * the root of its host, which is also where a server not reached at a path answers.
 */
export function worldPath(search: string, referrer: string, origin: string, kept: string | null): string {
  const plain = (p: string | null): p is string => p !== null && /^(\/[A-Za-z0-9._~-]+)*$/.test(p);
  const named = /[?&]world=([^&#]*)/.exec(search)?.[1];
  const asked = named === undefined ? null : decodeURIComponent(named);
  if (plain(asked)) return asked;
  if (referrer.startsWith(`${origin}/`)) {
    const from = referrer.slice(origin.length).split(/[?#]/)[0]!.replace(/\/[^/]*$/, "");
    if (from !== "/wiki" && !from.startsWith("/wiki/") && plain(from)) return from;
  }
  return plain(kept) ? kept : "";
}
