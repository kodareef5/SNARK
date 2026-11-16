// The site around the worlds of a cluster reached at paths of one host (--public-url /miami): the start screen at /, which
// lists every world running with how many play on it and goes to the one chosen, and the page the source link goes to
// until there is code to see. Every server reached at a path answers the site alike, so whatever is in front of them may
// send it to any (server/front.ts). The pages are plain HTML written here; nothing of them enters the game's bundle.

import type { Destination } from "./cluster/cluster.ts";

/** Where the game's links go (WikiUrl, RepositoryUrl): an http(s) address, or a path of the site; "" hides one. */
export interface SiteLinks {
  wiki: string;
  repository: string;
}

/** A world as the start screen lists it, with the address a page goes to for it. */
export interface SiteWorld {
  name: string;
  map: string;
  address: string;
  players: number;
  max: number;
}

/** The first parts of a path the site answers itself, so no world may be reached at one. */
const SITE_PATHS = new Set(["wiki", "assets", "source"]);

/**
 * The path a server is reached at, from its public address (--public-url): "/miami" for https://play.example/miami and for
 * /miami itself, "" for an address at the root of its host, or none. Throws for a path that is not plain words, or that the
 * site uses.
 */
export function pathOf(publicUrl: string): string {
  const path = (publicUrl.startsWith("/") ? publicUrl : (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(publicUrl)?.[1] ?? "")).replace(/\/+$/, "");
  if (path !== "" && !/^(\/[A-Za-z0-9._~-]+)+$/.test(path)) throw new Error(`--public-url ${publicUrl}: its path must be words of letters, digits, -, _, . and ~ between slashes`);
  if (SITE_PATHS.has(path.split("/")[1] ?? "")) throw new Error(`--public-url ${publicUrl}: /${path.split("/")[1]} is the site's own, so no world may be reached there`);
  return path;
}

/**
 * Where a request falls on a server reached at path `base` (pathOf): in its world, `path` being the part under the base; on
 * the site around it, for any other path; or at the base itself, which is sent on with a slash so that the page's own
 * addresses, all relative, fall under it. Everything a server at the root of its host is asked is its world.
 */
export function placeOf(base: string, pathname: string): { at: "world" | "site" | "slash"; path: string } {
  if (base === "") return { at: "world", path: pathname };
  if (pathname === base) return { at: "slash", path: pathname };
  if (pathname.startsWith(`${base}/`)) return { at: "world", path: pathname.slice(base.length) };
  return { at: "site", path: pathname };
}

/** A link setting's value if it is an http(s) address or a path of the site, and else "", so nothing else is ever a link. */
export function linkOf(value: string): string {
  const v = value.trim();
  return /^(https?:\/\/[^\s"'<>]+|\/[^\s"'<>]*)$/i.test(v) ? v : "";
}

/**
 * Where the start screen sends a page for a world: under its path on the site's own host when it is reached at one, at its
 * address when that is a whole one, and else at its port on the host (`host`, as the request named it) the page came by.
 */
export function worldAddress(w: Pick<Destination, "url" | "port">, host: string): string {
  if (w.url.startsWith("/")) return `${w.url}/`;
  if (w.url !== "") return `${w.url.replace(/\/+$/, "")}/`;
  const name = host.replace(/:\d+$/, "");
  return `//${name}:${w.port}/`;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
:root{color-scheme:dark;--ink:#e9eef2;--dim:#9aa9b4;--ice:#8fd3ff;--glass:rgba(18,28,36,.72);--edge:rgba(143,211,255,.22)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(120% 90% at 50% 0,#22394a 0,#0b1218 70%);color:var(--ink);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:clamp(24px,8vh,72px) 16px 32px}
h1{margin:0;font-size:clamp(34px,8vw,52px);letter-spacing:.14em;font-weight:800}
.sub{margin:2px 0 28px;color:var(--dim);letter-spacing:.08em;text-transform:uppercase;font-size:13px}
h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);font-weight:600;margin:0 0 10px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
li a{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;padding:14px 16px;border:1px solid var(--edge);border-radius:10px;background:var(--glass);color:inherit;text-decoration:none}
li a:hover,li a:focus-visible{border-color:var(--ice);outline:none}
.name{font-weight:700;font-size:18px}
.map{color:var(--dim)}
.count{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--ice)}
.full .count{color:#ffb38a}
.none{color:var(--dim);padding:14px 0}
nav{display:flex;gap:18px;margin-top:28px}
nav a,p a{color:var(--ice)}
`;

function page(title: string, body: string, script = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main>${script}</body></html>`;
}

/** One world's line of the start screen. */
function worldLine(w: SiteWorld): string {
  const full = w.players >= w.max;
  const count = full ? `full, ${w.players} of ${w.max}` : `${w.players} of ${w.max} online`;
  const map = w.map !== "" && w.map.toLowerCase() !== w.name.toLowerCase() ? `<span class="map">${esc(w.map)}</span>` : "";
  return `<li${full ? ' class="full"' : ""}><a href="${esc(w.address)}"><span class="name">${esc(w.name)}</span>${map}<span class="count">${esc(count)}</span></a></li>`;
}

/** The links under the list, for those the operator has not hidden. */
function linkLine(links: SiteLinks): string {
  const shown = [[linkOf(links.wiki), "Wiki"], [linkOf(links.repository), "Source code"]].filter(([href]) => href !== "");
  return shown.length === 0 ? "" : `<nav>${shown.map(([href, text]) => `<a href="${esc(href!)}">${text}</a>`).join("")}</nav>`;
}

/**
 * The start screen: every world running, lowest world first, each a link to its page with how many play there. The page
 * fetches itself every few seconds and puts the new list in place of the old, so the counts stay current while it is open.
 */
export function startPage(worlds: readonly SiteWorld[], links: SiteLinks): string {
  const list = worlds.length === 0 ? `<ul id="worlds"><li class="none">No world is running.</li></ul>` : `<ul id="worlds">${worlds.map(worldLine).join("")}</ul>`;
  const refresh = `<script>setInterval(()=>fetch(location.href,{cache:"no-store"}).then(r=>r.ok?r.text():"").then(t=>{const n=t&&new DOMParser().parseFromString(t,"text/html").getElementById("worlds");if(n)document.getElementById("worlds").replaceWith(n)}).catch(()=>{}),5000)</script>`;
  return page("SNARK", `<h1>SNARK</h1><p class="sub">Survival Unstable</p><h2>Choose a world</h2>${list}${linkLine(links)}`, refresh);
}

/** Where RepositoryUrl goes until the operator names the code's home. */
export function comingSoonPage(): string {
  return page("SNARK: source code", `<h1>SNARK</h1><p class="sub">Source code</p><h2>Coming soon</h2><p>The game's source is not open yet. When it is, this is where it will be.</p><p><a href="/">Back to the game</a></p>`);
}

/** A page's answer: HTML that is written for each request, so it is never kept. */
export function htmlResponse(html: string): Response {
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
}
