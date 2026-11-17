// Which world a page of the wiki shows its figures for, what that world says it runs, and which maps its cluster runs.

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

/** A world as the site's start screen lists it, from worlds.json beside settings.json (server/main.ts `worlds`). */
export interface LiveWorld {
  readonly name: string;
  /** Its map as a person reads it, and the map's id, by which the wiki's maps are found. */
  readonly map: string;
  readonly mapId: string;
  readonly address: string;
  readonly players: number;
  readonly max: number;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * A list of maps once the cluster behind the page says what it runs. `cards` is each map's markup by its id, a <div> that
 * gets a line for each world running it, or one saying it is not running here; the maps running come first, in the
 * cluster's order. With `every`, a map the cluster runs that the list has none of comes too, as a card of its own by name.
 */
export function liveMaps(cards: readonly (readonly [id: string, html: string])[], worlds: readonly LiveWorld[], every: boolean): string {
  const had = new Map(cards);
  const line = (w: LiveWorld): string => {
    const count = w.players >= w.max ? `full, ${w.players} of ${w.max}` : `${w.players} of ${w.max} online`;
    const name = /^(\/|https?:\/\/)/i.test(w.address) ? `<a href="${esc(w.address)}">${esc(w.name)}</a>` : esc(w.name);
    return `<span class="live">Running: ${name}, ${count}</span>`;
  };
  const running = [...new Set(worlds.map((w) => w.mapId))].filter((id) => every || had.has(id));
  return [...running, ...cards.map(([id]) => id).filter((id) => !running.includes(id))].map((id) => {
    const on = worlds.filter((w) => w.mapId === id);
    const name = on[0]?.map ?? id;
    const card = had.get(id) ?? `<div class="card map" data-map="${esc(id)}"><span class="blank">${esc(name.charAt(0))}</span><b>${esc(name)}</b><small>Its page is not built here</small></div>`;
    return card.replace(/<\/div>$/, () => `${on.length ? on.map(line).join("") : '<span class="live">Not running here</span>'}</div>`);
  }).join("");
}
