import { serveFile } from "../files.ts";
import { pathOf, worldAddress, type SiteWorld } from "../site.ts";
import type { Destination } from "../cluster/cluster.ts";
import { SCREEN_PATHS } from "../video/routes.ts";
import { OLD_PERMISSIONS_PATHS } from "../../shared/permissions/page.ts";
import { adminPath, refused, type AdminGate } from "./gate.ts";

const WORLD_PAGES = {
  map: "index.html",
  survivors: "index.html",
  items: "index.html",
  acts: "acts.html",
  settings: "settings.html",
  loadouts: "loadouts.html",
  drops: "drops.html",
  cast: "cast.html",
  health: "index.html",
  saves: "index.html",
  restart: "index.html",
  "first-frame": "first-frame.html",
  sounds: "sounds.html",
  permissions: "permissions.html",
};

type WorldPage = keyof typeof WORLD_PAGES;
type WorldId = SiteWorld["id"];

const UI_FILES = new Set([
  "admin.css", "investigate.css", "overview.css", "scene-studio.css",
  "admin.js", "cluster.js", "overview.js", "chat.js", "shell.js", "investigate.js", "map.js",
  "settings.js", "loadouts.js", "drops.js", "cast.js", "first-frame.js", "sounds.js", "board.js", "scene-studio.js", "screens.js", "screens-stage.js", "permissions.js", "acts.js",
]);
const OLD_UI_FILES = /^(?:(?:scene-studio|board)\.js(?:\.map)?|scene-studio\.css)$/;

export function worldAdminPage(path: string): { id: WorldId; page: WorldPage } | null {
  const match = /^\/admin\/worlds\/(local|[1-9]\d*)(?:\/([^/]+))?\/?$/.exec(path);
  if (!match) return null;
  const id = match[1] === "local" ? "local" : Number(match[1]);
  const page = match[2] ?? "map";
  return (id === "local" || Number.isSafeInteger(id)) && Object.hasOwn(WORLD_PAGES, page) ? { id, page: page as WorldPage } : null;
}

const worldLink = (id: WorldId, page: WorldPage): string => `/admin/worlds/${id}/${page}/`;

const mayRead = (req: Request): boolean => req.method === "GET" || req.method === "HEAD";
const refuseMethod = (): Response => new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
const notFound = (): Response => new Response("not found", { status: 404 });

function redirect(location: string, temporary = false): Response {
  return new Response(null, { status: temporary ? 307 : 308, headers: { location, "cache-control": "no-store" } });
}

async function privatePage(dir: string, req: Request, page: string): Promise<Response> {
  const res = await serveFile(dir, req, `/admin/${page}`);
  res.headers.set("cache-control", "no-store");
  return res;
}

async function uiFile(dir: string, req: Request, name: string): Promise<Response> {
  if (!UI_FILES.has(name) && !(name.endsWith(".js.map") && UI_FILES.has(name.slice(0, -4)))) return notFound();
  if (!mayRead(req)) return refuseMethod();
  const res = await serveFile(dir, req, `/admin/${name}`);
  return res.status === 404 && OLD_UI_FILES.test(name) ? serveFile(dir, req, `/${name}`) : res;
}

interface AdminSite {
  dir: string;
  base: string;
  port: number;
  id: WorldId;
  who: string;
  gate: AdminGate;
  destinations: () => readonly Destination[];
  scenes: (req: Request) => Promise<Response> | Response;
  /** The cluster's screens API (server/video/routes.ts), behind the gate; null where this server keeps no library. */
  screens?: (req: Request, path: string) => Promise<Response> | Response | null;
}

/** A named proxy can reach another world by its mount even when it sends site routes to this one. */
function elsewhere(req: Request, url: URL, world: Destination, page: WorldPage, port: number): Response {
  if (world.port === 0) return notFound();
  try {
    const host = req.headers.get("host") ?? url.host;
    const straight = Number(/:(\d+)$/.exec(host)?.[1] ?? 0) === port;
    const current = new URL(`${url.protocol}//${host}/`);
    const target = new URL(worldAddress(world, host, straight), current);
    if ((target.protocol !== "https:" && target.protocol !== "http:") || target.username || target.password) return notFound();
    const path = pathOf(world.url) + worldLink(world.world, page);
    if (target.host === current.host) {
      if (path === url.pathname || target.pathname === "/") return notFound();
      return redirect(path + url.search, true);
    }
    return redirect(target.origin + path + url.search, true);
  } catch {
    return notFound();
  }
}

/** Site-wide pages are served at the root. Each protected world page uses the gate of the world it names. */
export function adminSite(req: Request, url: URL, o: AdminSite): Promise<Response> | Response | null {
  const path = url.pathname;
  if (path.startsWith("/admin/ui/")) return uiFile(o.dir, req, path.slice("/admin/ui/".length));
  if (path === "/cluster/admin/cluster.js" || path === "/cluster/admin/cluster.js.map" || path === "/admin/cluster.js" || path === "/admin/cluster.js.map") {
    return uiFile(o.dir, req, path.slice(path.lastIndexOf("/") + 1));
  }
  if (path === "/cluster/admin" || path === "/cluster/admin/" || path === "/admin" || path === "/admin/chat") {
    return mayRead(req) ? redirect((path === "/admin/chat" ? "/admin/chat/" : "/admin/") + url.search) : refuseMethod();
  }
  if (path === "/admin/" || path === "/admin/chat/") return mayRead(req) ? serveFile(o.dir, req, "/admin/cluster.html") : refuseMethod();
  if (path === "/admin/scenes/api" || path === "/cluster/admin/scenes/api") return refused(req, o.who, o.gate) ?? o.scenes(req);
  if (["/admin/scenes", "/admin/scenes/", "/cluster/admin/scenes", "/cluster/admin/scenes/"].includes(path)) {
    return refused(req, o.who, o.gate) ?? (!mayRead(req) ? refuseMethod() : path === "/admin/scenes/" ? privatePage(o.dir, req, "scene-studio.html") : redirect(`/admin/scenes/${url.search}`));
  }
  if ((SCREEN_PATHS as readonly string[]).includes(path)) return refused(req, o.who, o.gate) ?? o.screens?.(req, path) ?? notFound();
  if (path === "/admin/screens" || path === "/admin/screens/") {
    return refused(req, o.who, o.gate) ?? (!mayRead(req) ? refuseMethod() : path === "/admin/screens/" ? privatePage(o.dir, req, "screens.html") : redirect(`/admin/screens/${url.search}`));
  }
  // Permissions was the cluster's page. It is a world's now: its old address goes to this world's, and its old API is gone.
  if (OLD_PERMISSIONS_PATHS.includes(path)) return notFound();
  if (path === "/admin/permissions" || path === "/admin/permissions/") return mayRead(req) ? redirect(worldLink(o.id, "permissions") + url.search) : refuseMethod();

  const mounted = o.base !== "" && path.startsWith(`${o.base}/`);
  const route = worldAdminPage(mounted ? path.slice(o.base.length) : path);
  if (!route) return null;
  if (!mayRead(req)) return refuseMethod();
  if (route.id !== o.id) {
    const target = !mounted && o.destinations().find((w) => w.world === route.id);
    return target ? elsewhere(req, url, target, route.page, o.port) : notFound();
  }
  const no = refused(req, o.who, o.gate);
  if (no) return no;
  const canonical = (mounted ? o.base : "") + worldLink(route.id, route.page);
  return canonical === path ? privatePage(o.dir, req, WORLD_PAGES[route.page]) : redirect(canonical + url.search);
}

/** Old HTML bookmarks go through their world's gate and keep their query string. */
export function oldAdminPage(req: Request, path: string, id: WorldId, who: string, gate: AdminGate): Response | null {
  const at = adminPath(path);
  const file = /^\/admin\/([a-z-]+)\.html$/.exec(at ?? "")?.[1];
  const page = at === "/sounds.html" ? "sounds" : at === "/admin" || at === "/admin/" || file === "index" ? "map" : file;
  if (!page || !Object.hasOwn(WORLD_PAGES, page)) return null;
  return refused(req, who, gate) ?? (mayRead(req) ? redirect(worldLink(id, page as WorldPage) + new URL(req.url).search) : refuseMethod());
}
