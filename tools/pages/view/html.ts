import type { GuideData, GuideEntry, GuideFact, GuideModel, GuideSound } from "../../../shared/pages/types.ts";

export const escape = (value: unknown): string => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function routeId(id: string): string {
  const parts = id.split(/[:/]/);
  if (parts.some((p) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(p) || p === "." || p === "..")) throw new Error(`Unsafe guide id: ${id}`);
  return parts.map(encodeURIComponent).join("/");
}
export function localUrl(url: string): string {
  if (!url) return "";
  const path = decodeURIComponent(url.split(/[?#]/)[0]!);
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\x00-\x1f]/.test(path) || path.split("/").some((p) => p === ".." || p === ".")) throw new Error("Guide media must use a local absolute URL");
  return escape(url);
}
export const entryPath = (e: GuideEntry): string => `/${e.kind}/${routeId(e.id)}/`;
export const mapPath = (id: string): string => `/maps/${routeId(id)}/`;
export const serverPath = (id: string): string => `/servers/${routeId(id)}/`;
export const words = (s: string): string => s.replace(/[_/-]/g, " ").replace(/\b\w/g, (v) => v.toUpperCase());
export const duration = (s: number): string => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
export const modelOf = (data: GuideData, entry: GuideEntry): GuideModel | undefined => data.models[entry.modelId ?? entry.id];

const shapes: Record<string, string> = {
  atlas: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z"/><path d="M9 3v16M15 5v16"/>',
  overview: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
  creatures: '<path d="m3 16 5-2 3-6 5-3 5 3-4 2-1 6-4 3-1 3M8 14l-2 7M15 17l4 4M15 7h.01"/>',
  characters: '<circle cx="12" cy="6" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3M12 13v8"/>',
  vehicles: '<path d="m4 9 2-5h12l2 5M3 9h18v9H3zM6 18v3M18 18v3M6 13h2M16 13h2"/>',
  items: '<path d="m12 2 9 5v10l-9 5-9-5V7ZM3 7l9 5 9-5M12 12v10M7.5 4.5l9 5"/>',
  engrams: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 8h8v8H8zM12 5v3M12 16v3M5 12h3M16 12h3"/>',
  structures: '<path d="m3 10 9-7 9 7v11H3ZM8 21v-8h8v8M3 10h18"/>',
  sounds: '<path d="M3 10v4M7 6v12M12 3v18M17 6v12M21 10v4"/>',
  music: '<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
  servers: '<rect x="3" y="3" width="18" height="7" rx="1"/><rect x="3" y="14" width="18" height="7" rx="1"/><path d="M7 6.5h.01M7 17.5h.01M13 6.5h5M13 17.5h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  cube: '<path d="m12 3 8 5v8l-8 5-8-5V8ZM4 8l8 5 8-5M12 13v8"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  minus: '<path d="M4 12h16"/>',
  reset: '<path d="M4 10a8 8 0 1 1 2 8M4 4v6h6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
};
export function icon(name: string): string {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] ?? shapes.items}</svg>`;
}
export function facts(rows: GuideFact[], cls = "facts"): string {
  return `<dl class="${cls}">${rows.map((f) => `<div><dt>${escape(f.label)}</dt><dd>${escape(f.value)}${f.unit ? `<small>${escape(f.unit)}</small>` : ""}</dd></div>`).join("")}</dl>`;
}
export function sectionHead(title: string, detail = "", link?: { href: string; label: string }): string {
  return `<div class="section-head"><div><h2>${escape(title)}</h2>${detail ? `<p>${escape(detail)}</p>` : ""}</div>${link ? `<a class="text-link" href="${escape(link.href)}">${escape(link.label)} ${icon("arrow")}</a>` : ""}</div>`;
}
export function entryCard(data: GuideData, e: GuideEntry, featured = false): string {
  const m = modelOf(data, e);
  return `<a class="entry-card${featured ? " featured-entry" : ""}" href="${entryPath(e)}" data-record data-query="${escape(`${e.label} ${e.id} ${e.classId} ${e.tags.join(" ")}`.toLowerCase())}" data-kind="${e.kind}" data-model="${Boolean(m)}" data-name="${escape(e.label.toLowerCase())}"><div class="entry-art">${m?.poster ? `<img src="${localUrl(m.poster)}" alt="" loading="lazy" width="640" height="480">` : `<div class="entry-symbol">${icon(e.kind)}</div>`}${m ? `<span class="media-mark">${icon("cube")} 3D${m.clips.length ? ` <i></i> ${m.clips.length} clips` : ""}</span>` : ""}</div><div class="entry-copy"><span class="eyebrow">${escape(words(e.classId.split("/").pop() ?? e.kind))}</span><h3>${escape(e.label)}${icon("arrow")}</h3>${featured ? `<p>${escape(e.description)}</p>` : ""}</div></a>`;
}
export function soundRow(sound: GuideSound, compact = false): string {
  return `<article class="sound-row${compact ? " compact" : ""}" id="sound-${routeId(sound.id).replaceAll("/", "-")}-${sound.take}" data-record data-query="${escape(`${sound.owner} ${sound.label} ${sound.occasion}`.toLowerCase())}" data-kind="${escape(sound.usage)}" data-name="${escape(sound.label.toLowerCase())}"><div class="sound-glyph">${icon("sounds")}</div><div class="sound-info"><h3>${escape(sound.label)}</h3><p>${escape(sound.owner.replace(/^core:/, ""))} <span>·</span> ${escape(words(sound.occasion))} <span>·</span> Take ${sound.take}${sound.usage === "library" ? ' <span class="small-label">Library</span>' : ""}</p></div><span class="duration">${duration(sound.seconds)}${sound.loop ? " · loop" : ""}</span><audio controls preload="none" src="${localUrl(sound.url)}" aria-label="${escape(`${sound.label}, take ${sound.take}`)}"></audio></article>`;
}
