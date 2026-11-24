// The wiki's markup: escaping, paths and the page every route is written into.

export const BASE = "/wiki/";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (value: unknown): string => String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]!);

/** An id as a path: its pack is left out for the core pack's. Each part must be plain words. */
export function slug(id: string): string {
  const [pack, name] = id.includes(":") ? [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)] : ["core", id];
  const parts = pack === "core" ? name.split("/") : [pack, ...name.split("/")];
  if (parts.some((p) => !/^[a-z0-9][a-z0-9_-]*$/i.test(p))) throw new Error(`the wiki has no path for the id "${id}"`);
  return parts.join("/");
}

export interface Assets {
  css: string;
  js: string;
  search: string;
  font: string;
  logo?: Image;
  revision: string;
}

const NAV = [
  ["", [["", "Home"], ["guides", "Guides"], ["maps", "Maps"]]],
  ["Reference", [["reference", "Overview"], ["creatures", "Creatures"], ["items", "Items"], ["resources", "Resources"], ["vehicles", "Vehicles"], ["characters", "Characters"], ["landmarks", "Landmarks"], ["statuses", "Status effects"], ["engrams", "Engrams"]]],
  ["Media", [["sounds", "Sounds"], ["music", "Music"]]],
  ["Server & controls", [["server", "Overview"], ["controls", "Controls"], ["commands", "Console commands"], ["settings", "Server settings"]]],
] as const;

export function sectionId(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function contents(sections: readonly (readonly [id: string, label: string])[]): string {
  return sections.length > 1
    ? `<nav class="contents" aria-label="On this page"><b>On this page</b><ul>${sections.map(([id, label]) => `<li><a href="#${esc(id)}">${esc(label)}</a></li>`).join("")}</ul></nav>`
    : "";
}

export function trail(links: readonly (readonly [path: string, label: string])[]): string {
  return `<nav class="trail" aria-label="Breadcrumb"><ol><li><a href="${BASE}">Wiki</a></li>${links.map(([path, label]) => `<li><a href="${path}">${esc(label)}</a></li>`).join("")}</ol></nav>`;
}

/** The game's code, which the site around the worlds answers (server/main.ts). */
export const SOURCE = "/source/";

export function page(a: Assets, title: string, here: string, path: string, body: string, footer?: { picture: Image; alt: string; caption?: string }): string {
  const nav = NAV.map(([label, links]) => {
    const rows = links.map(([key, text]) => {
      const route = key ? `${key}/` : "";
      const active = path === route ? ' aria-current="page"' : key !== "" && key === here ? ' class="current"' : "";
      return `<li><a href="${BASE}${route}"${active}>${esc(text)}</a></li>`;
    }).join("");
    return `<div class="nav-group">${label ? `<p>${esc(label)}</p>` : ""}<ul>${rows}</ul></div>`;
  }).join("");
  const search = here === "search" ? "" : `<form class="find nav-find" action="${BASE}search/" role="search"><label class="visually-hidden" for="site-search">Search the wiki</label><input id="site-search" name="q" type="search" placeholder="Search the wiki" required><button type="submit" aria-label="Search"><span class="search-icon" aria-hidden="true"></span></button></form>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<link rel="icon" href="${a.logo?.file ?? "data:,"}">
<title>${title === "SNARK Wiki" ? title : `${esc(title)} · SNARK Wiki`}</title>
<link rel="stylesheet" href="${a.css}">
<script type="module" src="${a.js}"></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<aside class="sidebar">
<details data-sidebar open>
<summary><span class="wordmark">SNARK <span>Wiki</span></span><span class="menu-label">Menu</span></summary>
<a class="site-brand wordmark" href="${BASE}" aria-label="SNARK Wiki home">SNARK <span>Wiki</span></a>
${search}
<nav aria-label="Main navigation">${nav}</nav>
</details>
<a class="mobile-search" href="${BASE}search/" aria-label="Search the wiki"><span class="search-icon" aria-hidden="true"></span></a>
</aside>
<main id="main" tabindex="-1">
${body}
</main>
<footer id="site-footer">
${footer ? img(footer.picture, footer.alt, true, "footer-art", "(min-width: 52rem) 55vw, 100vw") : ""}
<div class="footer-inner"><a class="wordmark" href="${BASE}">SNARK <span>Wiki</span></a>
<nav aria-label="Wiki information"><a href="${BASE}about/">About</a><a href="${BASE}credits/">Credits</a><a href="${SOURCE}">Source code</a></nav>
<small>Build ${esc(a.revision)}</small></div>
${footer ? fullPhoto(footer.picture, footer.caption || footer.alt) : ""}
</footer>
</body>
</html>
`;
}

export const heading = (title: string, kicker = "", lede = ""): string =>
  `<header class="heading">${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ""}<h1>${esc(title)}</h1>${lede ? `<p class="lede">${esc(lede)}</p>` : ""}</header>`;

export interface Image {
  file: string;
  width: number;
  height: number;
  small?: Image;
}

export function img(p: Image, alt: string, lazy = true, cls = "", sizes = "100vw"): string {
  const responsive = p.small ? ` srcset="${esc(p.small.file)} ${p.small.width}w, ${esc(p.file)} ${p.width}w" sizes="${esc(sizes)}"` : "";
  return `<img${cls ? ` class="${cls}"` : ""} src="${esc(p.file)}"${responsive} width="${p.width}" height="${p.height}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ""}>`;
}

export function fullPhoto(picture: Image, subject: string): string {
  return `<a class="photo-open" href="${esc(picture.file)}" aria-label="Open full photograph of ${esc(subject)}" title="Open photograph">⤢</a>`;
}

/** Links to the pages of a list `count` long, `size` a page: the first at `path`, the others under `path`page/. */
export function pager(path: string, count: number, size: number, at: number): string {
  const pages = Math.ceil(count / size);
  if (pages < 2) return "";
  const links = Array.from({ length: pages }, (_, k) => `<a href="${path}${k ? `page/${k + 1}/` : ""}"${k === at ? ' aria-current="page"' : ""}>${k + 1}</a>`);
  return `<nav class="pager" aria-label="Pages">${links.join("")}</nav>`;
}
