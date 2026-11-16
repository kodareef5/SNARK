import type { GuideData } from "../../../shared/pages/types.ts";
import { escape, icon } from "./html.ts";

const NAV = [
  ["overview", "Overview", "/"], ["atlas", "World atlas", "/maps/"], ["servers", "Servers", "/servers/"],
  ["creatures", "Creatures", "/creatures/"], ["characters", "Characters", "/characters/"], ["items", "Items", "/items/"],
  ["engrams", "Engrams", "/engrams/"], ["vehicles", "Vehicles", "/vehicles/"], ["structures", "Structures", "/structures/"],
  ["sounds", "Sounds", "/sounds/"], ["music", "Music", "/music/"],
] as const;

export function layout(data: GuideData, title: string, active: string, body: string, crumbs: { label: string; href: string }[] = []): string {
  const nav = NAV.map(([key, label, href], i) => `${i === 3 ? '<p class="nav-group">Catalogue</p>' : i === 9 ? '<p class="nav-group">Listen</p>' : ""}<a href="${href}" class="nav-link${active === key ? " active" : ""}"${active === key ? ' aria-current="page"' : ""}>${icon(key)}<span>${label}</span>${["creatures", "items", "vehicles"].includes(key) ? `<small>${data.entries.filter((e) => e.kind === key).length}</small>` : ""}</a>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="description" content="Maps, creatures, items, models and sounds from this cluster's content catalogue."><title>${escape(title)} · Field guide</title><link rel="stylesheet" href="/assets/guide.css"><link rel="icon" href="/assets/guide-mark.svg"><script type="module" src="/assets/guide.js"></script></head>
<body><a class="skip-link" href="#content">Skip to content</a><aside class="sidebar"><a class="identity" href="/">${icon("atlas")}<span>FIELD GUIDE<small>${escape(data.cluster.label)}</small></span></a><nav aria-label="Guide navigation">${nav}</nav><div class="sidebar-foot"><span class="signal"></span><span>${data.cluster.mode === "snapshot" ? "Published snapshot" : "Content catalogue"}</span><a href="/credits/">Sources & credits ${icon("arrow")}</a></div></aside>
<div class="workspace"><header class="topbar"><div class="breadcrumbs"><a href="/">Field guide</a>${crumbs.map((c) => `<span>/</span><a href="${escape(c.href)}">${escape(c.label)}</a>`).join("")}${title !== "Overview" ? `<span>/</span><span>${escape(title)}</span>` : ""}</div><form class="global-search" action="/search/" role="search">${icon("search")}<input name="q" aria-label="Search the field guide" placeholder="Search the field guide" autocomplete="off"><kbd>/</kbd></form></header><main id="content">${body}</main><footer class="page-footer"><span>Field guide <i></i> ${escape(data.cluster.label)}</span><span>Built <time datetime="${escape(data.generatedAt)}">${escape(data.generatedAt.slice(0, 10))}</time> <i></i> ${escape(data.revision.slice(0, 8))}</span><a href="/credits/">Sources & credits</a></footer></div></body></html>`;
}

export function heading(title: string, eyebrow: string, description = "", aside = ""): string {
  return `<header class="page-heading"><div><p class="eyebrow">${escape(eyebrow)}</p><h1>${escape(title)}</h1>${description ? `<p class="lede">${escape(description)}</p>` : ""}</div>${aside}</header>`;
}

export function filterBar(count: number, options: { value: string; label: string }[] = [], placeholder = "Filter this collection"): string {
  return `<div class="filter-bar"><label class="filter-search">${icon("search")}<input type="search" data-filter-query aria-label="${escape(placeholder)}" placeholder="${escape(placeholder)}" autocomplete="off"></label>${options.length ? `<label class="filter-select"><span class="sr-only">Category</span><select data-filter-kind><option value="">All types</option>${options.map((o) => `<option value="${escape(o.value)}">${escape(o.label)}</option>`).join("")}</select></label>` : ""}<label class="filter-select"><span class="sr-only">Sort</span><select data-filter-sort><option value="name">Name A–Z</option><option value="reverse">Name Z–A</option></select></label><span class="result-count" data-result-count aria-live="polite">${count} entries</span></div>`;
}
export const noResults = '<div class="no-results" data-no-results hidden><h2>No matches</h2><p>Try a different name, class or material.</p><button class="button" type="button" data-clear-filter>Clear filters</button></div>';
