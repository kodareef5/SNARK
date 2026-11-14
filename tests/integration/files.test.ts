// The client's files over HTTP: a range of one, the whole of one, and one that has not changed.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { serveFile } from "../../server/files.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-files-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
writeFileSync(join(dir, "core.mesh.0123456789abcdef.snpk"), bytes);
writeFileSync(join(dir, "manifest.json"), '{"version":1}');
writeFileSync(join(dir, "manifest.json.br"), brotliCompressSync('{"version":1}'));
writeFileSync(join(dir, "index.html"), "<p>hello</p>");

const get = (path: string, headers: Record<string, string> = {}): Promise<Response> => serveFile(dir, new Request(`http://localhost${path}`, { headers }));
const body = async (r: Response): Promise<Uint8Array> => new Uint8Array(await r.arrayBuffer());

test("a range of a file is answered with those bytes, and a range the file does not have is refused", async () => {
  const part = await get("/core.mesh.0123456789abcdef.snpk", { range: "bytes=100-299" });
  expect([part.status, part.headers.get("content-range"), part.headers.get("content-length"), part.headers.get("content-encoding")]).toEqual([206, "bytes 100-299/1000", "200", null]);
  expect(await body(part)).toEqual(bytes.subarray(100, 300));
  // A range that runs off the end is cut to what there is. One to the end has no second number.
  const tail = await get("/core.mesh.0123456789abcdef.snpk", { range: "bytes=900-1500" });
  expect([tail.status, tail.headers.get("content-range"), (await body(tail)).length]).toEqual([206, "bytes 900-999/1000", 100]);
  expect((await get("/core.mesh.0123456789abcdef.snpk", { range: "bytes=990-" })).headers.get("content-range")).toBe("bytes 990-999/1000");
  const past = await get("/core.mesh.0123456789abcdef.snpk", { range: "bytes=1000-1099" });
  expect([past.status, past.headers.get("content-range")]).toEqual([416, "bytes */1000"]);
  // Several ranges at once are not done: the whole file comes.
  const several = await get("/core.mesh.0123456789abcdef.snpk", { range: "bytes=0-1,5-6" });
  expect([several.status, (await body(several)).length]).toEqual([200, 1000]);
});

test("a file named after its hash is kept for good, and any other is checked again and not sent twice", async () => {
  const hashed = await get("/core.mesh.0123456789abcdef.snpk");
  expect([hashed.status, hashed.headers.get("cache-control"), hashed.headers.get("etag"), hashed.headers.get("accept-ranges")]).toEqual([200, "public, max-age=31536000, immutable", null, "bytes"]);
  const first = await get("/manifest.json");
  const tag = first.headers.get("etag")!;
  expect([first.status, first.headers.get("cache-control"), tag.length > 4]).toEqual([200, "no-cache", true]);
  const again = await get("/manifest.json", { "if-none-match": tag });
  expect([again.status, (await body(again)).length]).toEqual([304, 0]);
  expect((await get("/manifest.json", { "if-none-match": '"other"' })).status).toBe(200);
  // The page itself is the answer to "/".
  expect(await (await get("/")).text()).toBe("<p>hello</p>");
});

test("a whole file goes out compressed where a copy was built for it and the browser takes it, and a range never does", async () => {
  const packed = await get("/manifest.json", { "accept-encoding": "gzip, br" });
  expect([packed.status, packed.headers.get("content-encoding"), packed.headers.get("vary")]).toEqual([200, "br", "accept-encoding"]);
  expect(new TextDecoder().decode(brotliDecompressSync(await body(packed)))).toBe('{"version":1}');
  expect((await get("/manifest.json", { "accept-encoding": "gzip" })).headers.get("content-encoding")).toBeNull();
  const part = await get("/manifest.json", { "accept-encoding": "br", range: "bytes=0-3" });
  expect([part.status, part.headers.get("content-encoding"), await part.text()]).toEqual([206, null, '{"ve']);
  expect((await get("/index.html", { "accept-encoding": "br" })).headers.get("content-encoding")).toBeNull();
});

test("nothing outside the folder is served, and nothing that is not there", async () => {
  expect((await get("/nothing.js")).status).toBe(404);
  expect((await get("/..%2f..%2fetc/passwd")).status).toBe(404);
  expect((await serveFile(dir, new Request("http://localhost/../../etc/passwd"))).status).toBe(404);
});
