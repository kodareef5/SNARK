// The client's files over HTTP: whole, or one range of one. A file named after its own hash never changes, so it is
// kept for good by whoever fetched it. Any other is checked again each time, and costs nothing if it is unchanged.

import { join, normalize } from "node:path";

const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript", snpk: "application/octet-stream", json: "application/json", png: "image/png", ttf: "font/ttf", txt: "text/plain; charset=utf-8", opus: "audio/ogg" };
/** Sixteen hex digits in a name are the start of the SHA-256 of the file. */
const HASHED = /\.[0-9a-f]{16}\./;

export async function serveFile(dir: string, req: Request): Promise<Response> {
  const url = new URL(req.url);
  // A folder's address is its index.html, as the wiki's pages are written (tools/wiki.ts).
  const path = normalize(join(dir, url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname));
  if (!path.startsWith(dir)) return new Response("not found", { status: 404 });
  const file = Bun.file(path);
  if (!(await file.exists())) return new Response("not found", { status: 404 });
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
  // A whole file goes out compressed where a compressed copy was built beside it. A range never does: its offsets are the file's own.
  const packed = Bun.file(path + ".br");
  if (await packed.exists()) {
    headers.vary = "accept-encoding";
    if ((req.headers.get("accept-encoding") ?? "").includes("br")) return new Response(packed, { headers: { ...headers, "content-encoding": "br" } });
  }
  return new Response(file, { headers: { ...headers, "accept-ranges": "bytes" } });
}
