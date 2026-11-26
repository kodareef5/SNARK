import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { CORE_CONTENT, CORE_PACK } from "../../content/core.ts";
import { createHost, type Host } from "../../server/host.ts";
import { mapRoutes } from "../../server/main.ts";
import { createMapWorld, provingFile } from "../../server/world.ts";
import { compilePacks } from "../../shared/content/packs.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { chunkCount, framed } from "../../shared/coords.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { parseMap, partsFolder, readHead, writeMap } from "../../shared/world/mapfile.ts";
import { fetchMapFile } from "../../client/core/fetched.ts";
import { writeMapFile } from "../../tools/map/pack.ts";
import type { NodeSpot } from "../../shared/world/nodes.ts";
import { PROVING_DIMS, PROVING_ID, PROVING_SPAWNS, buildProvingHeightfield, populateProving, provingNodes } from "../../shared/world/proving.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { simHash } from "../../tools/simhash.ts";
import { busyMap, flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-maps-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("joining asks for the map and its landmarks before the game script runs", () => {
  const file = writeMap(flatMap(4, { content: {
    landmarks: [{ name: "dock", x: 32, y: 0, z: 32, yaw: 0 }],
    defs: CORE_CONTENT.filter(def => def.type === "structure" && def.id === "core:crate"),
  } }));
  const head = readHead(file);
  const route = mapRoutes(file, head.id);
  const landmark = head.parts.find(part => part.kind === "land")!;
  expect(route.link).toContain(`<map/${head.name}>`);
  expect(route.link).toContain(`<map/${landmark.name}>`);
  expect(route.link).not.toContain("ground.");
  route.close();
});

test("a new map is a file: a flat one made here runs a server, is served as a browser fetches it, and is walked on", async () => {
  const file = writeMap(flatMap(4, { statics: [{ kind: "core:crate", x: 140, y: 0.5, z: 128, yaw: 0 }] }));
  const h = new Harness({}, 1, 60, { map: file });
  expect([h.world.mapId, h.world.dims, h.world.structs.count, h.world.nodeField]).toEqual(["test:flat", framed({ chunksX: 4, chunksZ: 4 }), 1, null]);

  // map.json names the head, and the head and each of its parts are served by their names, gzipped for whoever takes it so.
  const route = mapRoutes(h.host.mapFile!, h.world.mapId);
  const ask = (path: string, accepts = ""): Promise<Response> => Promise.resolve(route(path, new Request(`http://x${path}`, { headers: { "accept-encoding": accepts } }))!);
  const named = (await (await ask("/map.json")).json()) as { id: string; hash: number; head: string };
  expect([named.id, named.hash, /^map\/head\.[0-9a-f]{16}\.part$/.test(named.head)]).toEqual(["test:flat", h.world.mapHash, true]);
  const head = readHead(new Uint8Array(await (await ask(`/${named.head}`)).arrayBuffer()));
  expect(head.hash).toBe(h.world.mapHash);
  for (const p of head.parts) {
    const packed = await ask(`/map/${p.name}`, "gzip, br");
    expect([packed.headers.get("content-encoding"), packed.headers.get("cache-control")]).toEqual(["gzip", "public, max-age=31536000, immutable"]);
    expect(new Uint8Array(Bun.gunzipSync(await packed.arrayBuffer()))).toEqual(file.subarray(p.at, p.at + p.length));
    expect(new Uint8Array(await (await ask(`/map/${p.name}`)).arrayBuffer())).toEqual(file.subarray(p.at, p.at + p.length));
  }
  // A name the head does not give is not found, and any other path is the server's other routes'.
  expect((await ask(`/map/${head.parts[0]!.name.replace(/\.[0-9a-f]{16}\./, ".0123456789abcdef.")}`)).status).toBe(404);
  expect(route("/index.html", new Request("http://x/index.html"))).toBeNull();
  // The page is sent with a header that has it ask for the head while it is read, named as the page names it, beside itself.
  expect(route.link).toBe(`<${named.head}>; rel=preload; as=fetch; crossorigin`);

  const ada = h.join("ada");
  h.run(500);
  expect(ada.state).toBe("active");
  expect(ada.world!.structs.count).toBe(1);
  const e = h.ent(ada);
  const ents = h.world.ents;
  expect([ents.x[e], ents.y[e], ents.z[e]]).toEqual([128, 0, 128]);
  h.pilots[0]!.moveZ = 1;
  h.run(3000);
  expect(ents.z[e]!).toBeGreaterThan(136);
  expect([ents.y[e], ada.stats.corrections]).toEqual([0, 0]);
});

test("a map's definition says where a new world's creatures start, and its sea must agree with its file", () => {
  const file = writeMap(flatMap(4));
  const withDef = (more: Record<string, unknown>) =>
    compilePacks([CORE_PACK, { name: "test", defs: [{ id: "test:flat", type: "map", zones: [{ kind: "crate", at: [10, 10], radius: 5 }, { kind: "spawn", at: [60, 190], radius: 12 }, { kind: "spawn", at: [200, 60], half: [8, 20] }], ...more }] }]);
  const made = withDef({});
  expect(made.errors).toEqual([]);
  const reg = made.registry!;
  const host = createHost(reg, { map: file, startingCreatures: 9, startingHunters: 4 });
  let herd = 0;
  let hunters = 0;
  for (const rec of host.records.byPid.values()) {
    if (rec.kind === reg.index.get("core:raptor")) {
      hunters++;
      expect(Math.abs(rec.x - 200) <= 8 && Math.abs(rec.z - 60) <= 20).toBe(true);
    } else {
      herd++;
      expect((rec.x - 60) * (rec.x - 60) + (rec.z - 190) * (rec.z - 190)).toBeLessThanOrEqual(144);
    }
  }
  expect([herd, hunters]).toEqual([9, 4]);
  // A map the content does not define starts with nothing on it.
  expect(createHost(coreRegistry(), { map: file, startingCreatures: 9, startingHunters: 4 }).world.ents.count).toBe(0);
  // Its size is its file's, which the definition does not say.
  expect(withDef({ chunks: [8, 4] }).errors).toEqual(['test:flat: class map may not declare "chunks"']);
  expect(() => createHost(withDef({ seaLevel: 3 }).registry!, { map: file })).toThrow('map "test:flat": its file has the sea at -Infinity, and its definition says 3');
});

test("a map's parked vehicles are set down once, in a new world, owned by nobody, and its save keeps them as it keeps any record", () => {
  const db = join(dir, "parked.db");
  const reg = coreRegistry();
  const file = writeMap(flatMap(4, { vehicles: [
    { kind: "core:compact", x: 100, z: 120, yaw: 0 },
    { kind: "core:compact", x: 160, z: 90, yaw: 16384 },
    { kind: "test:hauler", x: 60, z: 60, yaw: 0 },
  ] }));
  const cars = (host: Host): number[][] => [...host.records.byPid.values()].filter((r) => reg.vehicle[r.kind]).map((r) => {
    const e = host.records.entOf.get(r.pid)!;
    return [r.team, Math.round(host.world.ents.x[e]!), Math.round(host.world.ents.z[e]!), host.world.ents.yaw[e]!];
  }).sort((a, b) => a[1]! - b[1]!);
  const said: string[] = [];
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath: db, map: file, log: (line) => said.push(line) });
  try {
    expect(cars(h.host)).toEqual([[0, 100, 120, 0], [0, 160, 90, 16384]]);
    expect(said).toContain("not parked, for want of the content or of room: 1 of the map's test:hauler");
    // Anyone may take one and drive it off.
    const ada = h.join("ada");
    h.run(400);
    h.say(ada, "enablecheats");
    h.say(ada, "tp 101.6 120.12");
    h.run(200);
    const car = h.host.records.entOf.get([...h.host.records.byPid.values()].find((r) => reg.vehicle[r.kind] && r.x === 100)!.pid)!;
    expect(h.host.urban.mount(h.client(ada)!, car)).toBe(RESULT_OK);
    h.run(1200);
    expect(ada.driving).toBe(car);
    h.pilots[0]!.moveZ = 1;
    h.run(1500);
    h.pilots[0]!.moveZ = 0;
    h.run(3000);
  } finally {
    h.host.shutdown();
  }
  // The next start loads the cars where they were left, and parks none again.
  const again = createHost(reg, { dbPath: db, map: file, clips: NO_CLIPS, rigs: [] });
  try {
    const left = cars(again);
    expect([again.loaded!.fresh, left.length]).toEqual([false, 2]);
    expect(left[0]!.slice(0, 2)).toEqual([0, 100]);
    expect(left[0]![2]!).toBeGreaterThan(130);
    expect(left[1]).toEqual([0, 160, 90, 16384]);
  } finally {
    again.shutdown();
  }
});

test("a save records the map it was made on, and loads onto no other", () => {
  const db = join(dir, "map.db");
  const reg = coreRegistry();
  const flat = writeMap(flatMap(2));
  const edited = writeMap(flatMap(2, { statics: [{ kind: "core:crate", x: 40, y: 0.5, z: 40, yaw: 0 }] }));
  const other = writeMap(flatMap(2, { id: "test:other" }));
  const restart = (map: Uint8Array<ArrayBuffer>): boolean => {
    const host = createHost(reg, { dbPath: db, map });
    host.shutdown();
    return host.loaded!.fresh;
  };
  expect([restart(flat), restart(flat)]).toEqual([true, false]);
  expect(() => restart(edited)).toThrow(`save is for other bytes of map "test:flat" (hash ${parseMap(flat).hash.toString(16).padStart(8, "0")}, and this file's is ${parseMap(edited).hash.toString(16).padStart(8, "0")}): start with the map file it was made on`);
  expect(() => restart(other)).toThrow('save is for map "test:flat", not "test:other": start with the map file it was made on');
});

test("a map given by its path is read and let go: the host keeps none of its bytes, and its parts go out from the folder its build wrote, or are cut from the file", async () => {
  const file = writeMap(busyMap());
  const path = join(dir, "busy.snmap");
  writeFileSync(path, file);
  const host = createHost(coreRegistry(), { map: path, clips: NO_CLIPS, rigs: [], log: () => {} });
  expect([host.mapFile, host.world.structs.count, host.world.hf.tint.length]).toEqual([null, 3, 0]);
  const said: string[] = [];
  const log = console.log;
  console.log = (line: string) => said.push(line);
  const [cut, held] = [mapRoutes(path, host.world.mapId), mapRoutes(file, host.world.mapId)];
  console.log = log;
  const all = readHead(file).parts.length + 1;
  expect(said).toEqual([`map: ${all} of the ${all} parts of ${path} have no Brotli or gzip copy beside it, so those are cut and gzipped as they are asked for: bun tools/map.ts pack ${path} writes them`]);
  expect(cut.link).toBe(held.link);
  const head = readHead(file);
  const ask = (route: typeof cut, name: string, accepts: string): Promise<Response> => Promise.resolve(route(`/map/${name}`, new Request(`http://x/map/${name}`, { headers: { "accept-encoding": accepts } }))!);
  const part = head.parts.find((p) => p.kind === "statics")!;
  const bytes = file.subarray(part.at, part.at + part.length);
  expect(new Uint8Array(await (await ask(cut, part.name, "")).arrayBuffer())).toEqual(bytes);
  expect(new Uint8Array(Bun.gunzipSync(await (await ask(cut, part.name, "gzip")).arrayBuffer()))).toEqual(bytes);
  // With the folder its build writes, each goes out from disk: Brotli to whoever takes it, gzip to the rest, and itself to whoever takes neither.
  await writeMapFile(path, file);
  const disk = mapRoutes(path, host.world.mapId);
  const br = await ask(disk, part.name, "gzip, deflate, br");
  expect([br.headers.get("content-encoding"), br.headers.get("cache-control"), new Uint8Array(brotliDecompressSync(await br.arrayBuffer()))]).toEqual(["br", "public, max-age=31536000, immutable", bytes]);
  expect(new Uint8Array(Bun.gunzipSync(await (await ask(disk, part.name, "gzip, deflate")).arrayBuffer()))).toEqual(bytes);
  expect(new Uint8Array(await (await ask(disk, head.name, "")).arrayBuffer())).toEqual(file.subarray(0, head.bytes));
  expect((await ask(disk, "statics.1-1.0123456789abcdef.part", "br")).status).toBe(404);
  host.shutdown();
});

test("a part missing its gzip copy is cut alone; the other parts keep their Brotli", async () => {
  const file = writeMap(busyMap());
  const path = join(dir, "one-bare.snmap");
  await writeMapFile(path, file);
  const head = readHead(file);
  const bare = head.parts.find((p) => p.kind === "statics")!;
  rmSync(join(partsFolder(path), `${bare.name}.gz`));
  const said: string[] = [];
  const log = console.log;
  console.log = (line: string) => said.push(line);
  const route = mapRoutes(path, head.id);
  console.log = log;
  expect(said).toEqual([`map: 1 of the ${head.parts.length + 1} parts of ${path} have no Brotli or gzip copy beside it, so those are cut and gzipped as they are asked for: bun tools/map.ts pack ${path} writes them`]);
  const ask = (name: string, headers: Record<string, string>): Promise<Response> => Promise.resolve(route(`/map/${name}`, new Request(`http://x/map/${name}`, { headers }))!);
  for (const p of head.parts.filter((p) => p !== bare)) {
    const res = await ask(p.name, { "accept-encoding": "gzip, br" });
    expect([res.headers.get("content-encoding"), new Uint8Array(brotliDecompressSync(await res.arrayBuffer()))]).toEqual(["br", file.subarray(p.at, p.at + p.length)]);
  }
  const bytes = file.subarray(bare.at, bare.at + bare.length);
  const br = await ask(bare.name, { "accept-encoding": "gzip, br" });
  expect([br.headers.get("content-encoding"), new Uint8Array(brotliDecompressSync(await br.arrayBuffer()))]).toEqual(["br", bytes]);
  const gz = await ask(bare.name, { "accept-encoding": "gzip" });
  expect([gz.headers.get("content-encoding"), new Uint8Array(Bun.gunzipSync(await gz.arrayBuffer()))]).toEqual(["gzip", bytes]);
  // No raw part is kept beside the map: a range and a client taking neither are read from the map file.
  const range = await ask(bare.name, { range: "bytes=4-11", "accept-encoding": "br" });
  expect([range.status, range.headers.get("content-range"), new Uint8Array(await range.arrayBuffer())]).toEqual([206, `bytes 4-11/${bare.length}`, bytes.subarray(4, 12)]);
  expect(new Uint8Array(await (await ask(bare.name, {})).arrayBuffer())).toEqual(bytes);
  route.close();
});

test("a map rebuilt in place beside a running server: a fresh client of that server gets the map it holds, whole, and a server started after gets the new one", async () => {
  const path = join(dir, "rebuilt.snmap");
  const crate = (x: number) => writeMap(flatMap(4, { statics: [{ kind: "core:crate", x, y: 0.5, z: 128, yaw: 0 }] }));
  const [was, now] = [crate(140), crate(150)];
  await writeMapFile(path, was);
  const host = createHost(coreRegistry(), { map: path, clips: NO_CLIPS, rigs: [], log: () => {} });
  const route = mapRoutes(path, host.world.mapId);
  // Built again with a crate moved, as an everyday build and then a release, while the server runs.
  await writeMapFile(path, now);
  await writeMapFile(path, now, true);
  const fetched = async (r: typeof route): Promise<Uint8Array> => {
    const get = async (url: string) => (await r(`/${url}`, new Request(`http://x/${url}`, { headers: { "accept-encoding": "gzip" } })))! as Response;
    const named = (await (await get("map.json")).json()) as { head: string };
    return fetchMapFile(async (url) => {
      const res = await get(url);
      return res.headers.get("content-encoding") === "gzip" ? new Response(Bun.gunzipSync(await res.arrayBuffer()), { status: res.status }) : res;
    }, named.head);
  };
  const served = await fetched(route);
  expect([parseMap(served).hash, host.world.mapHash]).toEqual([parseMap(was).hash, parseMap(was).hash]);
  expect(served).toEqual(was);
  const after = mapRoutes(path, host.world.mapId);
  expect(await fetched(after)).toEqual(now);
  // A file written over in place, not replaced, gives the held file another's bytes: a part its folder lacks is gone.
  writeFileSync(path, crate(160));
  rmSync(partsFolder(path), { recursive: true });
  const statics = readHead(now).parts.find((p) => p.kind === "statics")!.name;
  expect((await after(`/map/${statics}`, new Request(`http://x/map/${statics}`)))!.status).toBe(410);
  for (const r of [route, after]) r.close();
  host.shutdown();
});

test("the proving ground loaded from its file is the one its functions build: every height, piece and node slot, and the same simulation", () => {
  const reg = coreRegistry();
  const world = createMapWorld(reg, parseMap(provingFile(reg)));
  const hf = buildProvingHeightfield();
  expect([world.mapId, world.dims, world.spawn, world.spawns]).toEqual([PROVING_ID, framed(PROVING_DIMS), PROVING_SPAWNS[0]!, PROVING_SPAWNS]);
  expect([world.hf.cell, world.hf.minY, world.hf.stepY, world.hf.seaLevel]).toEqual([hf.cell, hf.minY, hf.stepY, hf.seaLevel]);
  // The server draws nothing, so it keeps none of the ground's colours.
  expect([world.hf.heights, world.hf.tint.length]).toEqual([hf.heights, 0]);

  // The tables must match slot for slot, since a piece is known by its chunk and slot.
  const structs = new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  populateProving(structs, hf, reg);
  expect(world.structs.count).toBe(structs.count);
  structs.chunks.forEach((t, chunk) => {
    const u = world.structs.chunks[chunk];
    if (!t) return expect(u ?? null).toBeNull();
    expect([u!.version, u!.high, u!.live]).toEqual([t.version, t.high, t.live]);
    for (const col of ["kind", "x", "y", "z", "yaw", "owner", "hp", "mod"] as const) expect(u![col].subarray(0, t.high)).toEqual(t[col].subarray(0, t.high));
  });

  const ours = world.nodeField!.source;
  const theirs = provingNodes(hf, reg);
  expect(ours.perChunk).toBe(theirs.perChunk);
  const a: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const b: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  let standing = 0;
  let differ = 0;
  for (let chunk = 0; chunk < chunkCount(PROVING_DIMS); chunk++) {
    for (let i = 0; i < theirs.perChunk; i++) {
      ours.at(chunk, i, a);
      theirs.at(chunk, i, b);
      if (a.kind !== b.kind || (a.kind !== 0 && (a.x !== b.x || a.y !== b.y || a.z !== b.z || a.yaw !== b.yaw))) differ++;
      if (a.kind !== 0) standing++;
    }
  }
  expect([differ, standing > 2000]).toEqual([0, true]);

  expect(simHash(600, reg, world)).toBe(simHash(600, reg));
});
