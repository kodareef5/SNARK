import type { LiveWorld } from "../wiki/world.ts";

export interface AdminWorld extends LiveWorld { id: number | "local" }

export const cluster = [["overview", "Overview"], ["chat", "Chat"], ["scenes", "Scene studio"], ["screens", "Screens"]] as const;
export const sections = [
  ["Investigate", [["map", "Map & replay"], ["survivors", "Survivors"], ["items", "Item history"], ["acts", "Admin log"]]],
  ["Manage", [["settings", "Settings"], ["permissions", "Permissions"], ["loadouts", "Loadouts"], ["drops", "Supply drops"], ["cast", "Cast"]]],
  ["Diagnostics", [["health", "Server health"], ["saves", "Saves"], ["restart", "Restart"], ["first-frame", "First frame"], ["sounds", "Sound board"]]],
] as const;
const worldPages = sections.flatMap(([, pages]) => [...pages]);
export const worldPath = (id: AdminWorld["id"], view: string) => `/admin/worlds/${id}/${view}/`;
export const clusterPath = (view: string) => view === "overview" ? "/admin/" : `/admin/${view}/`;

interface SiteUrl {
  href: string; pathname: string; origin: string; protocol: string;
  username: string; password: string; search: string; hash: string;
}
type ReadUrl = (href: string, base?: string) => SiteUrl;

export function address(world: Pick<LiveWorld, "address">, origin: string, read: ReadUrl): SiteUrl {
  const url = read(world.address, origin);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw Error("Invalid world address.");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

export function resolveAdmin(href: string, worlds: AdminWorld[], read: ReadUrl) {
  const { origin, pathname } = read(href);
  const route = /\/admin\/worlds\/(local|\d+)\/([a-z-]+)\/?$/.exec(pathname);
  const world = route ? worlds.find(row => String(row.id) === route[1]) : null;
  if (route && !world) throw Error("This world is unavailable. Return to the overview to choose a running world.");
  const view = route?.[2] ?? (pathname.split("/")[2] || "overview");
  const title = [...cluster, ...worldPages].find(([slug]) => slug === view)?.[1];
  if (!title) throw Error("Unknown admin page.");
  const base = world ? address(world, origin, read) : null;
  if (base && base.origin !== origin) throw Error("Open this world on its own server.");
  return {
    view, title, worlds, world: world ?? null,
    worldUrl(next: string) {
      if (!world || !worldPages.some(([slug]) => slug === next)) throw Error("Choose a world and a tool.");
      return worldPath(world.id, next);
    },
    api(path: string) {
      if (!base) throw Error("Choose a world first.");
      const target = read(path, read("admin/", base.href).href);
      if (target.origin !== origin || !target.pathname.startsWith(base.pathname)) throw Error("Invalid world resource.");
      return target.href;
    },
  };
}
