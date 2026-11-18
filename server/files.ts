// The client's files over HTTP: whole, or one range of one. A file named after its own hash never changes, so it is
// kept for good by whoever fetched it. Any other is checked again each time, and costs nothing if it is unchanged.
// A map's parts are served from their folder in the same way (server/main.ts mapRoutes).

import { existsSync } from "node:fs";
import { join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = { webp: "image/webp", webm: "video/webm", html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript", snpk: "application/octet-stream", json: "application/json", png: "image/png", ttf: "font/ttf", txt: "text/plain; charset=utf-8", opus: "audio/ogg" };
/** Sixteen hex digits in a name are the start of the SHA-256 of the file, or a map part's hash (shared/world/mapfile.ts). */
const HASHED = /\.[0-9a-f]{16}\./;

/**
 * The file at `pathname` under `dir`: the request's own path, or for a server reached at a path of its host the part of it
 * under that path (server/site.ts placeOf).
 */
export async function serveFile(dir: string, req: Request, pathname = new URL(req.url).pathname): Promise<Response> {
  // A folder's address is its index.html, as the wiki's pages are written (tools/wiki.ts).
  const path = normalize(join(dir, pathname.endsWith("/") ? `${pathname}index.html` : pathname));
  if (!path.startsWith(dir + sep)) return new Response("not found", { status: 404 });
  const file = Bun.file(path);
  if (!(await file.exists())) {
    // A folder asked for without its slash goes on to its address with one, as /wiki to /wiki/, so that its page's
    // relative addresses fall inside it. The way on is relative too, so it holds under any path the server is reached at.
    if (!pathname.endsWith("/") && existsSync(join(path, "index.html"))) {
      return new Response(null, { status: 308, headers: { location: `${pathname.slice(pathname.lastIndexOf("/") + 1)}/${new URL(req.url).search}` } });
    }
    return new Response("not found", { status: 404 });
  }
  const size = file.size;
  const headers: Record<string, string> = { "content-type": TYPES[path.split(".").pop() ?? ""] ?? "application/octet-stream" };
  if (HASHED.test(path.slice(path.lastIndexOf("/") + 1))) headers["cache-control"] = "public, max-age=31536000, immutable";
  else {
    headers["cache-control"] = "no-cache";
    headers.etag = `"${size.toString(16)}-${Math.floor(file.lastModified).toString(16)}"`;
    if (req.headers.get("if-none-match") === headers.etag) return new Response(null, { status: 304, headers });
  }
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range) {
    const from = Number(range[1]);
    const to = range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
    if (from >= size || to < from) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    return new Response(file.slice(from, to + 1), { status: 206, headers: { ...headers, "accept-ranges": "bytes", "content-range": `bytes ${from}-${to}/${size}`, "content-length": String(to - from + 1) } });
  }
  // A whole file goes out compressed where a compressed copy was built beside it: Brotli to whoever takes it, else gzip,
  // which a browser takes over plain http. A range never does: its offsets are the file's own.
  const accepts = req.headers.get("accept-encoding") ?? "";
  for (const [encoding, end] of [["br", "br"], ["gzip", "gz"]] as const) {
    const packed = Bun.file(`${path}.${end}`);
    if (!(await packed.exists())) continue;
    headers.vary = "accept-encoding";
    if (accepts.includes(encoding)) return new Response(packed, { headers: { ...headers, "content-encoding": encoding } });
  }
  return new Response(file, { headers: { ...headers, "accept-ranges": "bytes" } });
}
