// Local file-only preview; no game imports, database connection, build trigger or directory listing.
import { readFileSync, realpathSync } from "node:fs";
import { extname, join, sep } from "node:path";
import { immutablePath, type GuideRelease } from "./release.ts";

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2", ".opus": "audio/ogg", ".wav": "audio/wav", ".txt": "text/plain; charset=utf-8" };
export const GUIDE_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function guideHandler(output: string): (request: Request) => Response {
  let previous = "";
  let manifest: GuideRelease | null = null;
  return (request) => {
    const headers = new Headers(GUIDE_HEADERS);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers });
    try {
      const root = realpathSync(output);
      if (root !== previous) { manifest = JSON.parse(readFileSync(join(root, "release.json"), "utf8")) as GuideRelease; previous = root; }
      const url = new URL(request.url);
      let key = decodeURIComponent(url.pathname).replace(/^\//, "");
      if (key.includes("\\") || key.includes("\0") || key.split("/").some((s) => s.startsWith("."))) return new Response("Not found", { status: 404, headers });
      if (key === "" || key.endsWith("/")) key += "index.html";
      if (!manifest!.files[key] && manifest!.files[`${key}/index.html`]) {
        headers.set("Location", `${url.pathname}/${url.search}`);
        return new Response(null, { status: 308, headers });
      }
      const entry = manifest!.files[key];
      if (!entry) return new Response("Not found", { status: 404, headers });
      const file = realpathSync(join(root, key));
      if (!file.startsWith(root + sep)) return new Response("Not found", { status: 404, headers });
      headers.set("Content-Type", extname(key) === ".ini" ? "text/plain; charset=utf-8" : MIME[extname(key)] ?? "application/octet-stream");
      headers.set("ETag", `"${entry.sha256}"`);
      headers.set("Cache-Control", immutablePath(key) ? "public, max-age=31536000, immutable" : key.endsWith(".json") || key.includes("/players/") ? "no-store" : "no-cache");
      headers.set("Accept-Ranges", "bytes");
      if (request.headers.get("If-None-Match") === `"${entry.sha256}"`) return new Response(null, { status: 304, headers });
      const range = request.headers.get("Range");
      let start = 0, end = entry.bytes - 1, status = 200;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers });
        if (!match[1]) start = Math.max(0, entry.bytes - Number(match[2]));
        else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= entry.bytes) { headers.set("Content-Range", `bytes */${entry.bytes}`); return new Response(null, { status: 416, headers }); }
        headers.set("Content-Range", `bytes ${start}-${end}/${entry.bytes}`);
        status = 206;
      }
      headers.set("Content-Length", String(end - start + 1));
      return new Response(request.method === "HEAD" ? null : Bun.file(file).slice(start, end + 1), { status, headers });
    } catch {
      return new Response("Preview unavailable", { status: 503, headers });
    }
  };
}

export function serveGuide(output: string, port = 8794): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: guideHandler(output) });
  console.log(`Wiki: http://localhost:${server.port}/`);
  return server;
}
