// What the page fetches whole as it starts: a failure names the request and what the server answered.

import { expect, test } from "bun:test";
import { fetchBytes, fetchContent, fetchJson, fetchMapFile, fetchSounds, fetchText, nextTask, type Get } from "../../client/core/fetched.ts";
import { WORLD_GENERATED_CONTENT } from "../../content/client-generated.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { ORBS } from "../../content/orb.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { clientContent, withoutNotes } from "../../tools/build-client.ts";
import { MANIFEST_VERSION, type Manifest } from "../../shared/pack/manifest.ts";
import { partsOf, readHead, writeMap } from "../../shared/world/mapfile.ts";
import { wideMap } from "../fixtures/map.ts";

/** A server that answers each path as given, and 404 "not found" for any other, as server/files.ts does. */
const server = (files: Record<string, string>): Get => (url) => Promise.resolve(url in files ? new Response(files[url]) : new Response("not found", { status: 404 }));

test("a file the server does not have is named with its status, not left to a JSON parser", async () => {
  const get = server({ "map.json": '{"head":"map/head.1.part"}', "map/head.1.part": "abc", "assets/manifest.json": "{}", "broken.json": "not found" });
  expect(await fetchJson(get, "map.json")).toEqual({ head: "map/head.1.part" });
  expect(new Uint8Array(await fetchBytes(get, "map/head.1.part"))).toEqual(new TextEncoder().encode("abc"));
  expect(await fetchText(get, "assets/manifest.json")).toBe("{}");
  // As the phone's soak met it: a build had taken the manifest away, and the page said only "JSON Parse error".
  const gone = server({});
  await expect(gone("assets/manifest.json").then(async (res) => JSON.parse(await res.text()) as unknown)).rejects.toThrow(SyntaxError);
  await expect(fetchJson(gone, "assets/manifest.json")).rejects.toThrow('assets/manifest.json: the server answered 404: "not found"');
  await expect(fetchText(gone, "assets/manifest.json")).rejects.toThrow('assets/manifest.json: the server answered 404: "not found"');
  await expect(fetchBytes(gone, "assets/core.boot.0123456789abcdef.snpk")).rejects.toThrow("assets/core.boot.0123456789abcdef.snpk: the server answered 404");
  await expect(fetchJson(get, "broken.json")).rejects.toThrow('broken.json: the server answered 200 with what is not JSON: "not found"');
  await expect(fetchJson(() => Promise.reject(new TypeError("Load failed")), "map.json")).rejects.toThrow("map.json: no answer (Load failed)");
});

test("the page rebuilds city scenery, broken pieces, and orb collision", async () => {
  const file = new TextDecoder().decode(clientContent());
  const ids = new Set((JSON.parse(file) as { id: string }[]).map((d) => d.id));
  expect(WORLD_GENERATED_CONTENT.some((d) => ids.has(d.id))).toBe(false);
  expect(ORBS.length).toBeGreaterThan(80);
  const page = await fetchContent(server({ "assets/content.json": file }), "assets/content.json");
  const own = compileContent(CORE_CONTENT).registry!;
  expect(page.hash).toBe(own.hash);
  expect(page.ids).toEqual(own.ids);
  expect(page.parts.start).toEqual(own.parts.start);
  expect(page.parts.box).toEqual(own.parts.box);
  expect(page.parts.hulls).toEqual(own.parts.hulls);
  expect(page.screenFace).toEqual(own.screenFace);
});

test("a script is sent without the lines of its shaders' notes, each line still there", () => {
  const js = "const a=`void main() {\n  // The light, as the sun sees it.\n  x = 1.0; // kept\n  // kept: ${b}\n}`;\n// between statements\nlet c=1;";
  expect(withoutNotes(js)).toBe("const a=`void main() {\n\n  x = 1.0; // kept\n  // kept: ${b}\n}`;\n\nlet c=1;");
  expect(withoutNotes(js).split("\n").length).toBe(js.split("\n").length);
});

test("a sounds' rows file that fails says why, and leaves the manifest without sounds", async () => {
  const manifest = (): Manifest => ({ version: MANIFEST_VERSION, files: [{ name: "boot", bytes: 0, role: "boot" }], boot: 0, clipHash: 0, meshes: [], soundRows: "sounds.1.json" });
  const rows = manifest();
  expect(await fetchSounds(server({ "assets/sounds.1.json": "[]" }), rows)).toBe("");
  expect(rows.sounds).toEqual([]);
  const gone = manifest();
  expect(await fetchSounds(server({}), gone)).toBe('assets/sounds.1.json: the server answered 404: "not found"');
  expect(gone.sounds).toBeUndefined();
  const wrong = manifest();
  expect(await fetchSounds(server({ "assets/sounds.1.json": '[{"id":"nobody"}]' }), wrong)).toContain('sound "nobody"');
  expect(wrong.sounds).toBeUndefined();
});

/** A server of a map's head and parts, as server/main.ts names them under map/, counting what is asked for and how many at once. */
function mapServer(file: Uint8Array, change: (name: string, bytes: Uint8Array) => Uint8Array = (_, b) => b): Get & { asked: string[]; most: number } {
  let open = 0;
  const files = new Map(partsOf(file).map((p) => [`map/${p.name}`, p.bytes]));
  const get = Object.assign(
    async (url: string): Promise<Response> => {
      get.asked.push(url);
      get.most = Math.max(get.most, ++open);
      await Promise.resolve();
      open--;
      const bytes = files.get(url);
      return bytes ? new Response(change(url, bytes)) : new Response("not found", { status: 404 });
    },
    { asked: [] as string[], most: 0 },
  );
  return get;
}

test("a program that reads a map whole fetches its head and every part, six at once, and puts its file back together", async () => {
  const file = writeMap(wideMap());
  const head = readHead(file);
  const get = mapServer(file);
  expect(await fetchMapFile(get, `map/${head.name}`)).toEqual(file);
  expect([get.asked.length, get.most]).toEqual([1 + head.parts.length, 6]);
});

test("a part that comes as another's, or a head that is damaged or not there, is refused with its name", async () => {
  const file = writeMap(wideMap());
  const head = readHead(file);
  const [a, b] = [head.parts[2]!, head.parts[3]!];
  const other = partsOf(file).find((p) => p.name === b.name)!.bytes;
  const swapped = mapServer(file, (url, bytes) => (url === `map/${a.name}` ? other : bytes));
  await expect(fetchMapFile(swapped, `map/${head.name}`)).rejects.toThrow(`map/${a.name}: the part is ${b.length} bytes, and its head says ${a.length}`);
  await expect(fetchMapFile(mapServer(file), `map/head.0123456789abcdef.part`)).rejects.toThrow('map/head.0123456789abcdef.part: the server answered 404: "not found"');
  const head2 = file.slice(0, head.bytes);
  head2[70]! ^= 1;
  await expect(fetchMapFile(() => Promise.resolve(new Response(head2)), `map/${head.name}`)).rejects.toThrow(`map/${head.name}: map: its head is damaged`);
});


test("a page's pause is a task of its own scheduler where it has one, each pause one task and its step after it; else a message to itself", async () => {
  const ran: string[] = [];
  const queue: (() => void)[] = [];
  const scheduler = { postTask: (task: () => void) => new Promise<void>((done) => queue.push(() => (task(), ran.push("task"), done()))) };
  const pause = nextTask({ port1: { onmessage: null }, port2: { postMessage: () => ran.push("message") } }, scheduler);
  const steps = (async () => {
    for (let k = 0; k < 3; k++) {
      await pause();
      ran.push(`step ${k}`);
    }
  })();
  for (let k = 0; k < 3; k++) {
    await Promise.resolve();
    queue.shift()!();
    await new Promise((go) => setTimeout(go, 0));
  }
  await steps;
  expect(ran).toEqual(["task", "step 0", "task", "step 1", "task", "step 2"]);
  // With none, a message on the channel, answered by the next one that comes.
  const channel = new MessageChannel();
  let posted = 0;
  const message = nextTask({ port1: channel.port1, port2: { postMessage: (m) => (posted++, channel.port2.postMessage(m)) } }, undefined);
  await message();
  await message();
  channel.port1.close();
  expect(posted).toBe(2);
});
