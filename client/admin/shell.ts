import { esc } from "../core/admin/format.ts";
import { address, cluster, clusterPath, resolveAdmin, sections, worldPath, type AdminWorld } from "../core/admin/navigation.ts";

const readUrl = (href: string, base?: string) => new URL(href, base);
type Context = ReturnType<typeof resolveAdmin>;
let pending: Promise<Context> | undefined;

export function adminContext(): Promise<Context> {
  return pending ??= fetch("/worlds.json", { cache: "no-store" }).then(async response => {
    if (!response.ok) throw Error("World directory unavailable.");
    return resolveAdmin(location.href, await response.json() as AdminWorld[], readUrl);
  });
}

const shapes: Record<string, string> = {
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  chat: "M3 4h18v12H9l-6 5z",
  scenes: "M3 8h18v12H3z M3 8l-1-4 17-3 1 4z M7 3l3 3m3-4 3 3",
  screens: "M12 3a8 8 0 100 16 8 8 0 000-16z M10 8v6l5-3z M7 21h10",
  wardrobe: "M8 3l-5 3 2 5 3-1v11h8V10l3 1 2-5-5-3q-2 3-4 0z",
  permissions: "M8 12a4 4 0 100 8 4 4 0 000-8z M11 13l9-9 M17 7l3 3 M14 10l2 2",
  map: "M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16m6-14v16",
  survivors: "M5 20v-2a5 5 0 0110 0v2 M14 13a5 5 0 015 5v2 M13 7a3 3 0 11-6 0 3 3 0 016 0z M16 4a3 3 0 010 6",
  items: "M3 7l9-5 9 5v10l-9 5-9-5z M3 7l9 5 9-5m-9 5v10",
  acts: "M5 3h14v18H5z M8 8h8m-8 4h8m-8 4h5",
  settings: "M3 6h7m5 0h6M3 12h12m4 0h2M3 18h3m5 0h10 M10 3v6m5 0v6m-9 0v6",
  loadouts: "M4 8h16v12H4z M8 8V5h8v3 M4 13h16m-10 0v2h4v-2",
  drops: "M2 10a10 8 0 0120 0z M2 10l8 7m12-7-8 7m-6-7 3 7m5-7-3 7 M9 17h6v4H9z",
  events: "M2 11q10-6 20 0q-10 6-20 0z M8 8q4-5 8 0 M9 15l-2 6m8-6 2 6",
  cast: "M3 4h18v7c0 6-6 9-9 10-3-1-9-4-9-10z M6 9h4m4 0h4m-10 5q4 4 8 0",
  health: "M2 12h5l3-8 4 16 3-8h5",
  saves: "M4 3h13l3 3v15H4z M7 3v6h9V3 M8 21v-8h8v8",
  restart: "M4 10a8 8 0 111 8m-1-8V4m0 6h6",
  "first-frame": "M3 4h18v13H3z M8 21h8m-4-4v4",
  sounds: "M3 10v4m4-7v10m5-14v18m5-15v12m4-8v4",
};
const icon = (name: string) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="${shapes[name]}"/></svg>`;

function install(ctx: Context): void {
  const rail = document.querySelector<HTMLElement>("#admin-rail")!;
  const link = ([slug, label]: readonly [string, string], href: string) =>
    `<a class="admin-link" href="${esc(href)}"${ctx.view === slug ? ' aria-current="page"' : ""}>${icon(slug)}<span>${esc(label)}</span></a>`;
  const group = (label: string, links: string) => `<div class="admin-nav-group"><h2>${label}</h2>${links}</div>`;
  const worldHref = (world: AdminWorld) => {
    try {
      const url = address(world, location.origin, readUrl);
      return url.origin === location.origin ? worldPath(world.id, ctx.world ? ctx.view : "map") : new URL("admin/", url.href).href;
    } catch { return ""; }
  };
  const worldLinks = ctx.worlds.map(world => {
    const target = worldHref(world);
    return target ? `<a class="admin-link" href="${esc(target)}">${icon("map")}${esc(world.name)}</a>` : "";
  }).join("");
  rail.querySelector("nav")!.innerHTML = group("Cluster", cluster.map(p => link(p, clusterPath(p[0]))).join("")) +
    (ctx.world ? sections.map(([label, pages]) => group(label, pages.map(p => link(p, ctx.worldUrl(p[0]))).join(""))).join("") : group("Worlds", worldLinks));
  const bar = document.querySelector<HTMLElement>("#admin-bar")!;
  bar.querySelector(".admin-breadcrumb")!.textContent = ctx.world?.name ?? "Cluster";
  bar.querySelector(".admin-current")!.textContent = ctx.title;
  const select = bar.querySelector("select")!;
  select.innerHTML = '<option value="/admin/">All worlds</option>' + ctx.worlds.map(w =>
    `<option value="${esc(worldHref(w))}"${ctx.world?.id === w.id ? " selected" : ""}>${esc(w.name)}</option>`).join("");
  select.onchange = () => { if (select.value) location.assign(select.value); };
  document.title = `${ctx.title} · ${ctx.world?.name ?? "Cluster"} · SNARK Admin`;
}

function mount(): void {
  if (document.querySelector("#admin-rail")) return;
  const main = document.querySelector("main");
  if (main) {
    if (!main.id) main.id = "admin-content";
    main.tabIndex = -1;
  }
  document.body.insertAdjacentHTML("afterbegin", `<a class="admin-skip" href="#${esc(main?.id ?? "admin-content")}">Skip to content</a>
    <aside id="admin-rail"><a class="admin-brand" href="/admin/"><img src="/title/snark-emblem.webp" alt="" width="44" height="44"><span><strong>SNARK</strong><small>ADMIN CONSOLE</small></span></a>
    <nav aria-label="Admin navigation"></nav><a class="admin-exit" href="/">Game home <span aria-hidden="true">↗</span></a></aside>
    <header id="admin-bar"><button class="admin-menu" aria-expanded="false" aria-controls="admin-rail" aria-label="Open navigation">☰</button>
    <div class="admin-crumbs"><a href="/admin/">Admin</a><i>/</i><span class="admin-breadcrumb">Cluster</span><i>/</i><strong class="admin-current"></strong></div>
    <label class="admin-switch">World<select aria-label="Switch world"><option>All worlds</option></select></label></header>
    <button class="admin-backdrop" aria-label="Close navigation" hidden></button>`);
  const toggle = document.querySelector<HTMLButtonElement>(".admin-menu")!;
  const backdrop = document.querySelector<HTMLButtonElement>(".admin-backdrop")!;
  const open = (show: boolean) => {
    document.body.classList.toggle("admin-menu-open", show);
    toggle.setAttribute("aria-expanded", String(show));
    toggle.setAttribute("aria-label", show ? "Close navigation" : "Open navigation");
    backdrop.hidden = !show;
    if (main) main.inert = show;
    if (show) document.querySelector<HTMLElement>(".admin-brand")?.focus();
    else toggle.focus();
  };
  toggle.onclick = () => open(toggle.getAttribute("aria-expanded") !== "true");
  backdrop.onclick = () => open(false);
  matchMedia("(max-width: 720px)").addEventListener("change", () => {
    if (!backdrop.hidden) open(false);
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !backdrop.hidden) open(false); });
  void adminContext().then(install).catch((error: Error) => {
    const alert = document.createElement("p");
    alert.className = "admin-error"; alert.setAttribute("role", "alert");
    alert.textContent = error.message;
    main?.prepend(alert);
  });
}
if (typeof document !== "undefined") mount();
