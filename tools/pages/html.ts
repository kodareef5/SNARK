// The guide's markup: escaping, paths and the page every route is written into.

export const BASE = "/guide/";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (value: unknown): string => String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]!);

/** An id as a path: its pack is left out for the core pack's. Each part must be plain words. */
export function slug(id: string): string {
  const [pack, name] = id.includes(":") ? [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)] : ["core", id];
  const parts = pack === "core" ? name.split("/") : [pack, ...name.split("/")];
  if (parts.some((p) => !/^[a-z0-9][a-z0-9_-]*$/i.test(p))) throw new Error(`the guide has no path for the id "${id}"`);
  return parts.join("/");
}

export interface Assets {
  css: string;
  js: string;
  search: string;
  /** The game's files the pages share: its font and its interface sheet. */
  font: string;
  revision: string;
}

const NAV: readonly (readonly [string, string])[] = [
  ["creatures", "Creatures"],
  ["items", "Items"],
  ["engrams", "Engrams"],
  ["vehicles", "Vehicles"],
  ["maps", "Maps"],
  ["sounds", "Sounds"],
  ["commands", "Commands"],
];

export function page(a: Assets, title: string, here: string, body: string): string {
  const nav = NAV.map(([path, label]) => `<a href="${BASE}${path}/"${path === here ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:,">
<title>${esc(title)} · Field guide</title>
<link rel="preload" href="${a.font}" as="font" type="font/ttf" crossorigin>
<link rel="stylesheet" href="${a.css}">
<script type="module" src="${a.js}"></script>
</head>
<body>
<header class="top">
<a class="home" href="${BASE}">Field guide</a>
<nav>${nav}</nav>
<form class="find" action="${BASE}search/" role="search"><input name="q" aria-label="Search the guide" placeholder="Search"></form>
</header>
<main>
${body}
</main>
<footer>Made from the game's build ${esc(a.revision)}. <a href="${BASE}settings/">Server settings</a> · <a href="${BASE}credits/">Credits</a></footer>
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
}

export const img = (p: Image, alt: string, lazy = true, cls = ""): string =>
  `<img${cls ? ` class="${cls}"` : ""} src="${esc(p.file)}" width="${p.width}" height="${p.height}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ""}>`;

/** Links to the pages of a list `count` long, `size` a page: the first at `path`, the others under `path`page/. */
export function pager(path: string, count: number, size: number, at: number): string {
  const pages = Math.ceil(count / size);
  if (pages < 2) return "";
  const links = Array.from({ length: pages }, (_, k) => `<a href="${path}${k ? `page/${k + 1}/` : ""}"${k === at ? ' aria-current="page"' : ""}>${k + 1}</a>`);
  return `<nav class="pager" aria-label="Pages">${links.join("")}</nav>`;
}
