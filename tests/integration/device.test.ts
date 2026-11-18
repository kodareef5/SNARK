// The device probe: whole runs of a client on the harness, as a phone's page makes them, and the server's routes for it,
// which the internet can reach while a tunnel is up. The ladder and the soaks are in device-ladder.test.ts, the terrain
// flight in device-terrain.test.ts and the tree order in device-trees.test.ts, so the four run side by side; the page they
// share is tests/fixtures/device.ts.

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceProbe, RUNGS, newReport, spread, type DeviceReport, type RungReport } from "../../client/core/device.ts";
import { deviceTable } from "../../client/core/devicetext.ts";
import { DRAW_PULLED, DRAW_SIZED, FRAME } from "../../client/core/render/packet.ts";
import { decodeTexture, sample } from "../../client/core/render/cpu-texture.ts";
import { selfcheckReport } from "../../client/core/selfcheck-report.ts";
import { MAX_RUNS, MAX_WRONG, REPORT_BYTES, deviceRoutes, filesChanged, lacking, servedFiles } from "../../tools/device.ts";
import { writeTextureFile } from "../../tools/pack/texture.ts";
import { FakeNet } from "../fixtures/assetnet.ts";
import { TIMING, TOKEN, browser, client, renderer, run, settle } from "../fixtures/device.ts";
import { referenceManifest } from "../fixtures/world-surfaces.ts";
import { corePack } from "../fixtures/pack.ts";

test("a page shows which device it is on and the tests, starts nothing until one is tapped, then runs the quick look and posts after every step", async () => {
  const { h, pack, app, expected } = client();
  const card = renderer();
  const { b, posts, page } = browser({ clock: () => h.now + card.spent(), expected });
  const probe = new DeviceProbe(TOKEN, b, TIMING);
  const going = probe.before();
  await settle();
  expect(page.whole).toBe(true);
  expect(page.text).toContain("This looks like <b>an iPhone, Chrome for iOS 157 (WebKit, as every iOS browser), iOS 27.2, 390 by 844 at 3x</b>");
  expect(page.text).toContain('data-mode="ladder"');
  expect(posts.length).toBe(0);
  probe.start("quick");
  expect(await going).toBe(true);
  const gpu = card.r;
  probe.attach({ app, pack, reg: h.reg, hf: h.world.hf }, gpu);
  // The picture probes read a frame drawn with a plain sky, as the self-check's: no haze and nothing over the table.
  const air: number[][] = [];
  gpu.readPixel = () => (air.push([app.scene!.packet.frame[FRAME.haze]!, app.scene!.packet.frame[FRAME.skyDetail]!]), [0, 0, 0]);
  const yaw = new Map<string, number>();
  const split = new Map<string, number>();
  const cascades = new Map<string, number>();
  const each = (): void => {
    yaw.set(probe.report.stage, app.controls.yaw);
    split.set(probe.report.stage, app.scene!.packet.split);
    cascades.set(probe.report.stage, app.scene!.assets.tier.shadows.cascades);
  };
  await run(probe, h, app, gpu, 60000, { each });
  const r = probe.report;
  expect([r.mode, r.done, r.errors, r.reloadedDuring]).toEqual(["quick", true, [], null]);
  expect(r.phases.map((p) => `${p.tier} ${p.scene}`)).toEqual(["lowpoly plain", "lowpoly stress", "lowpoly crowd", "medium plain", "medium stress", "medium crowd", "medium crowd1", "medium crowd0", "high plain", "high stress", "high crowd", "high crowd1", "high crowd0"]);
  expect(r.skipped).toEqual(["ultra: its textures are up to 4096 wide, and this device takes 2048"]);
  expect(r.phases.map((p) => p.ratio)).toEqual([1, 1, 1, 1.5, 1.5, 1.5, 1.5, 1.5, 2, 2, 2, 2, 2]);
  // The crowd with its shadows and then with none, the next tier with its own again.
  expect([cascades.get("medium crowd"), cascades.get("medium crowd0"), cascades.get("high plain")]).toEqual([2, 0, 3]);
  expect(r.phases[3]!.canvas).toEqual([585, 1266]);
  expect([yaw.get("medium crowd"), yaw.get("medium plain"), yaw.get("medium crowd1")]).toEqual([Math.PI, 0, Math.PI]);
  // The crowd on medium in its two depth ranges and then in one; the next tier has its split again.
  expect([split.get("medium crowd"), split.get("medium crowd1"), split.get("high plain")]).toEqual([384, 0, 384]);
  expect(deviceTable(r).some((line) => line.startsWith("ranges    medium, two against one in the crowd: frames "))).toBe(true);
  expect(deviceTable(r).some((line) => line.startsWith("shadows   medium, on against off in the crowd: the GPU's time not known here (no timer queries); frames "))).toBe(true);
  // The tiers that cast count their shadow maps' draws and triangles beside the view's.
  expect(r.phases.filter((p) => p.casterDraws > 0).map((p) => p.scene)).toEqual(["plain", "stress", "crowd", "crowd1", "plain", "stress", "crowd", "crowd1"]);
  expect(r.phases.every((p) => (p.casterDraws > 0) === (p.casterTris > 0))).toBe(true);
  expect(deviceTable(r).some((line) => /^medium +plain +585x1266 .* 50 +\d+k +\d+ +\d+k +0 /.test(line))).toBe(true);
  // The GPU questions were asked first, and each answered on the harness's context; the frame they copied had no draws
  // with materials or bones, since the harness fetches no textures and stands no body in view.
  const q = r.gpuTests!;
  expect([q.lostDuring, q.passes.filter((p) => p.note !== "").map((p) => `${p.name}: ${p.note}`), typeof q.seam]).toEqual([null, ["draw textured: none in the frame", "draw skinned: none in the frame"], "object"]);
  expect(["lit", "lit world near", "lit world far"].map((n) => q.passes.find((p) => p.name === n)?.slope)).toEqual([0.135, 0.135, 0.135]);
  // The executor took 0.1 ms a draw, a caster each: 100 µs, through packets of the frame's own draws of each kind.
  expect(q.passes.filter((p) => p.per === "draw" && p.note === "").map((p) => [p.name, p.slope, p.k])).toEqual([["draw far", 100, 128], ["draw flat", 100, 128], ["draw caster", 100, 128]]);
  expect([...card.kinds].sort((a, b) => a - b)).toEqual([DRAW_SIZED, DRAW_PULLED]);
  expect([r.again?.tier, r.again?.scene]).toEqual(["lowpoly", "plain"]);
  expect(r.hashes!.every((x) => x.got === x.want)).toBe(true);
  expect([r.load!.pageBytes, r.link.httpMs!.median, r.idleFrameMs, r.wakeLock, r.gpu!.maxTexture, r.gpu!.variant, r.device!.touch]).toEqual([500000, 0, 16.6, "held", 2048, "astc", 5]);
  // Counted from the first snapshot, nothing is missed on the harness; the server's counts are this run's own.
  expect([r.link.missed, r.link.missedLoading, r.link.missedHidden, r.link.snapshots > 0]).toEqual([0, 0, 0, true]);
  expect(r.link.server).toEqual({ skipped: posts.length - 1, overflows: 0 });
  expect(posts.every((p, i) => i === 0 || p.seq > posts[i - 1]!.seq)).toBe(true);
  expect(posts.at(-1)!.done).toBe(true);
  expect(page.text.startsWith("<div")).toBe(true);
  expect(page.text).toContain("Done.</b> Sent.");
  expect(page.text).toContain("tiers run lowpoly, medium, high");
  // The fake draws nothing, so the pictures and the far blocks' edge read wrong; and the harness fetches no textures,
  // the world surfaces' reference among them, so the lit ground and statics are not judged.
  expect(lacking(r).filter((line) => !/^(probe |gpu far edge|gpu draw (textured|skinned))/.test(line))).toEqual(["ground and statics not judged: no world-surface reference (the page made none)", "nothing was drawn with its materials on medium, which has them", "nothing was drawn with its materials on high, which has them", "tier ultra did not run every scene"]);
  expect([r.probes!.map((p) => p.name), r.surfaceReference]).toEqual([["sky", "creature"], { ready: false, format: "rgba", error: "the page made none", fetched: 0, cached: 0 }]);
  expect(card.gl.invalid).toEqual([]);
  expect([air.length > 0, air.every(([haze, detail]) => haze === 0 && detail === 0), app.scene!.plainSky]).toEqual([true, true, false]);

  // Another test on the same page begins at once, with the game as it is, under a run of its own.
  probe.start("soak");
  expect([probe.report.mode, probe.report.run, probe.report.done, probe.report.device?.touch]).toEqual(["soak", "fedcba9876543201", false, 5]);
  await run(probe, h, app, gpu, 30000);
  const s = probe.report.soak!;
  expect([probe.report.done, probe.report.errors, s.tier, s.from, s.minutes.length, probe.report.link.gameMs !== null]).toEqual([true, [], "high", "defaults", 1, true]);
  expect(s.minutes[0]!.frames).toBeGreaterThan(100);
  expect(deviceTable(probe.report).some((line) => line.startsWith("soak      high: 200 bodies, 1024 pieces") && line.includes("shadows on in 3 cascades"))).toBe(true);
});

test("the page holds the lit ground and statics to what the plain self-check expects of the same frame, by the world surfaces' reference through the game's port", async () => {
  const pack = corePack();
  const { manifest, materials } = referenceManifest(pack);
  const roles = ["base", "normal", "mro"] as const;
  const pictures = roles.map((role) => Array.from({ length: 7 }, (_, k) => new Uint8Array(4 ** k * (role === "normal" ? 2 : 4)).fill(128)));
  const encoded = writeTextureFile("rgba", roles.map((role, k) => ({ role, block: 1, pictures: pictures[k]! })));
  manifest.files.push({ name: "reference", bytes: encoded.bytes.length, role: "tex", format: "rgba" });
  for (const material of materials) roles.forEach((role, k) => void (manifest.textures![material[role]] = { id: `${material.id}/${role}`, role, top: 64, in: { rgba: { file: 1, ...encoded.placed[k]! } } }));
  const port = new FakeNet([new Uint8Array(0), encoded.bytes]);
  const { h, app, expected } = client({ manifest, port });
  const { b } = browser({ clock: () => h.now, expected, mode: "quick" });
  const probe = new DeviceProbe(TOKEN, b, TIMING);
  await probe.before();
  const card = renderer();
  probe.attach({ app, pack, reg: h.reg, hf: h.world.hf }, card.r);
  // The plain probe's own report of the frame the page reads, from the same pictures decoded apart from the page's.
  const maps = roles.map((role, k) => decodeTexture(role, pictures[k]!));
  const surfaces = { sample: (role: number, _layer: number, u: number, v: number, spread: number, out: Float64Array) => sample(maps[role]!, u, v, spread, out), state: { ready: true, format: "rgba" as const, error: null, fetched: 0, cached: 0 } };
  let plain: ReturnType<typeof selfcheckReport> | null = null;
  card.r.readPixel = () => {
    const [width, height] = [card.gl.drawingBufferWidth, card.gl.drawingBufferHeight];
    plain ??= selfcheckReport(app, pack, manifest, h.world.hf, app.scene!.packet, { has: (name) => name === "creature", voiced: false, voiceListen: false, voice: { played: 0, odd: 0, errors: 0, heard: [] }, driveCheck: false, drive: undefined, restored: 0, misplaced: 0, sound: null, cache: port.cache, userAgent: "", surfaces, width, height, times: [], renderer: { readPixel: () => [0, 0, 0], errors: 0, rendererName: "", format: "rgba", formats: [], drawCalls: 0 } });
    return [0, 0, 0];
  };
  await run(probe, h, app, card.r, 20000, { each: (now) => port.advance(now), until: () => probe.report.probes !== null });
  const r = probe.report;
  expect([r.probes?.map((p) => p.name), r.surfaceReference?.ready, r.surfaceReference?.error, r.surfaceReference!.fetched > 0]).toEqual([["sky", "plaza", "block", "creature"], true, null, true]);
  const twins = new Map(plain!.probes.map((p) => [p.name, p.expected]));
  for (const p of r.probes!) expect([p.name, p.expected]).toEqual([p.name, twins.get(p.name)!]);
  expect(deviceTable(r).some((line) => /^ {10}ground and statics held to the world surfaces' rgba reference, 0\.9 MB fetched, 0\.0 MB from disk$/.test(line))).toBe(true);
});

test("a page the browser reloads in the middle of a run shows and sends what it had, and runs again only when a test is tapped", async () => {
  const ladder = { display: 16.7, rungs: [], memory: { variant: "astc", gameMB: 40, heldMB: 1024, failedMB: null, slowMB: null, how: "", rungs: [{ mb: 1024, frameMs: 17, p95: 18, worst: 20, oursMs: 0.3, held: true }] } };
  const saved = JSON.stringify({ token: TOKEN, report: { ...newReport("0011223344556677", "ladder"), seq: 7, stage: "memory 1536 MB", ladder } });
  const { b, posts, page } = browser({ saved });
  const probe = new DeviceProbe(TOKEN, b, TIMING);
  const going = probe.before();
  await settle();
  expect([probe.report.run, probe.report.reloadedDuring, posts.length, posts[0]!.seq, posts[0]!.done]).toEqual(["0011223344556677", "memory 1536 MB", 1, 8, true]);
  expect(page.text).toContain("Stopped early.</b> Sent.");
  expect(page.text).toContain("memory    1024 MB of astc textures held and sampled besides the game&#39;s 40 MB; every amount kept the display&#39;s rate; frames 1024 MB 17 ms; the page was reloaded while it took 1536 MB of textures: the browser dropped the tab");
  probe.start("quick");
  expect(await going).toBe(true);
  expect([probe.report.run, probe.report.mode, probe.report.reloadedDuring, probe.report.done]).toEqual(["fedcba9876543201", "quick", null, false]);
  // A run of another server's page, or one that finished, is not taken up.
  const other = new DeviceProbe("another".padEnd(32, "0"), browser({ saved, mode: "quick" }).b, TIMING);
  expect([await other.before(), other.report.reloadedDuring]).toEqual([true, null]);
});

test("a soak tapped on a page the browser reloaded during a ladder takes half of what that ladder held, and runs", async () => {
  const rung = (axis: RungReport["axis"], n: number): RungReport => ({ tier: "high", axis, n, held: true, limit: "", invalid: "", canvas: [], settled: true, frameMs: spread([16.7]), buildMs: 1, drawMs: 1, calls: 0, tris: 0, bones: 0, mat: 0, casterDraws: 0, casterTris: 0, fetched: 0, failed: 0, refused: 0, missed: 0 });
  const ladder = { display: 16.7, rungs: [rung("bodies", 400), rung("pieces", 64), rung("triangles", 8), rung("draws", 256)], memory: null };
  const saved = JSON.stringify({ token: TOKEN, report: { ...newReport("0011223344556677", "ladder"), seq: 70, stage: "memory 2048 MB", ladder } });
  const { h, pack, app, expected } = client();
  const { b, posts } = browser({ saved, clock: () => h.now, expected });
  const probe = new DeviceProbe(TOKEN, b, { ...TIMING, soakMs: 1000 });
  const going = probe.before();
  await settle();
  probe.start("soak");
  expect(await going).toBe(true);
  probe.attach({ app, pack, reg: h.reg, hf: h.world.hf }, renderer().r);
  await run(probe, h, app, renderer().r, 60000);
  const r = probe.report;
  expect([r.mode, r.done, r.errors, r.reloadedDuring, r.soak?.from, r.soak?.load.bodies, r.soak?.minutes.length]).toEqual(["soak", true, [], null, "half what the ladder held on high", 200, 1]);
  expect(posts.filter((p) => p.run === "0011223344556677").map((p) => p.done)).toEqual([true]);
});

test("a run whose frames stop ends, saying why, and one whose game never starts ends too", async () => {
  const { h, pack, app } = client();
  let clock = 0;
  const { b, posts } = browser({ clock: () => clock, mode: "quick" });
  const probe = new DeviceProbe(TOKEN, b, TIMING);
  await probe.before();
  const { r: gpu, fire } = renderer();
  probe.attach({ app, pack, reg: h.reg, hf: h.world.hf }, gpu);
  h.run(1000, (now) => {
    clock = now;
    const p = app.frame(now, 390, 844);
    if (p) probe.frame(now, p, now - 1, now - 0.5);
  });
  // A texture the renderer makes counts, except while a lost context is made again.
  gpu.gl.createTexture();
  fire("webglcontextlost");
  gpu.gl.createTexture();
  fire("webglcontextrestored");
  gpu.gl.createTexture();
  expect(probe.report.texturesMade).toBe(2);
  probe.watch();
  expect(probe.report.done).toBe(false);
  // Hidden, the frames' stopping does not count from before the page was shown again.
  probe.visible(false);
  clock += 60000;
  probe.visible(true);
  probe.watch();
  expect(probe.report.done).toBe(false);
  clock += 16000;
  probe.watch();
  await settle();
  expect(probe.report.done).toBe(true);
  expect(probe.report.errors[0]).toMatch(/^[a-z ]+: the frames stopped for 16 s: /);
  expect(posts.at(-1)!.done).toBe(true);

  const idle = new DeviceProbe(TOKEN, browser({ clock: () => clock, mode: "quick" }).b, TIMING);
  await idle.before();
  clock += TIMING.loadMs + 1;
  idle.watch();
  expect(idle.report.errors).toEqual(["loading: the game did not start"]);
});

const dir = mkdtempSync(join(tmpdir(), "snark-device-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The probe's routes. With `terrain`, a terrain server's too: two spots to stand at, and views it counts. */
function server(terrain = false) {
  const said: string[] = [];
  const done: string[] = [];
  const bases: string[] = [];
  const [stood, counted] = [[] as number[], [] as number[][]];
  const trees = { stand: (k: number) => (stood.push(k), k < 2 ? [100 + k, 200] : null), layers: (w: number, h: number, fov: number) => (counted.push([w, h, fov]), { state: "counting" as const }) };
  const { routes } = deviceRoutes({ dir, token: TOKEN, code: "bqzk", password: "secret", expected: { sim: "abc" }, say: (line) => said.push(line), done: (_, file) => done.push(file), base: (n, box) => (bases.push(`${box ? "box" : "base"} ${n}`), Math.min(n, 1000)), held: () => ({ skipped: 7, overflows: 2 }), ...(terrain ? trees : {}) });
  const ask = async (path: string, init: RequestInit = {}): Promise<Response | null> => {
    const req = new Request(`http://127.0.0.1${path}`, init);
    return (await routes(req, new URL(req.url))) ?? null;
  };
  return { ask, said, done, bases, stood, counted };
}

test("a terrain server stands the body at the tree order's spots and counts views of sizes a page can have, each only with the token", async () => {
  const plain = server();
  for (const path of ["/__device/stand/0", "/__device/layers/390/844/70"]) expect((await plain.ask(`${path}?token=${TOKEN}`, { method: "POST" }))!.status).toBe(404);
  const { ask, stood, counted } = server(true);
  for (const path of ["/__device/stand/0", "/__device/layers/390/844/70", `/__device/stand/0?token=${TOKEN.slice(1)}`]) expect((await ask(path, { method: "POST" }))!.status).toBe(404);
  expect(await (await ask(`/__device/stand/1?token=${TOKEN}`, { method: "POST" }))!.json()).toEqual([101, 200]);
  expect([(await ask(`/__device/stand/2?token=${TOKEN}`, { method: "POST" }))!.status, (await ask(`/__device/stand/1?token=${TOKEN}`))!.status]).toEqual([400, 404]);
  expect(await (await ask(`/__device/layers/390/844/70?token=${TOKEN}`, { method: "POST" }))!.json()).toEqual({ state: "counting" });
  for (const path of ["/__device/layers/9999/844/70", "/__device/layers/390/844/10", "/__device/layers/40/844/70"]) expect((await ask(`${path}?token=${TOKEN}`, { method: "POST" }))!.status).toBe(400);
  expect([stood, counted]).toEqual([[1, 2], [[390, 844, 70]]]);
});

const post = (report: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(report) });

test("the probe's routes need the token, the short path leads to the page until it is guessed at too often, and a page may only size the base", async () => {
  const { ask, said, bases } = server();
  expect(await ask("/main.js")).toBeNull();
  expect(await ask("/ws")).toBeNull();
  expect((await ask("/main.js.map"))!.status).toBe(404);
  expect(said).toEqual(["a browser fetched the page's script", "a page opened the game's socket"]);
  for (const path of ["/__device/ping", `/__device/ping?token=${TOKEN.slice(1)}`, `/__device/ping?token=${"é".repeat(32)}`, `/__device/hashes?token=${TOKEN.toUpperCase()}`, "/__device/base/64"]) expect((await ask(path, { method: "POST" }))!.status).toBe(404);
  expect(await (await ask(`/__device/ping?token=${TOKEN}`))!.json()).toBe(true);
  expect(await (await ask(`/__device/hashes?token=${TOKEN}`))!.json()).toEqual({ sim: "abc" });
  expect(await (await ask(`/__device/base/64?token=${TOKEN}`, { method: "POST" }))!.json()).toEqual({ pieces: 64 });
  expect(await (await ask(`/__device/base/4096?token=${TOKEN}`, { method: "POST" }))!.json()).toEqual({ pieces: 1000 });
  expect(await (await ask(`/__device/box/${RUNGS.base.at(-1)}?token=${TOKEN}`, { method: "POST" }))!.json()).toEqual({ pieces: RUNGS.base.at(-1) });
  for (const path of ["/__device/base/4097", `/__device/box/${RUNGS.base.at(-1)! + 1}`, "/__device/base/-1", "/__device/base/12345678", "/__device/base/1e3", "/__device/house/4"]) expect((await ask(`${path}?token=${TOKEN}`, { method: "POST" }))!.status).toBe(/4097|box/.test(path) ? 400 : 404);
  expect((await ask(`/__device/base/64?token=${TOKEN}`))!.status).toBe(404);
  expect(bases).toEqual(["base 64", "base 4096", "box 937"]);
  const to = await ask("/d/bqzk");
  expect([to!.status, to!.headers.get("location")]).toEqual([302, `/?device=${TOKEN}&password=secret`]);
  for (let i = 0; i < MAX_WRONG; i++) expect((await ask(`/d/x${i}`))!.status).toBe(404);
  expect((await ask("/d/bqzk"))!.status).toBe(404);
});

test("a report is kept in its folder under a name of the server's making, newer over older, and what is too large, malformed or too many is refused", async () => {
  const { ask, done } = server();
  const report = { ...newReport("aaaaaaaaaaaaaaaa"), seq: 2, stage: "medium plain" };
  const path = `/__device/report?token=${TOKEN}`;
  const first = await ask(path, post(report));
  expect([first!.status, await first!.json()]).toEqual([200, { skipped: 7, overflows: 2 }]);
  expect((await ask(path, post({ ...report, seq: 1, stage: "loading" })))!.status).toBe(200);
  expect((await ask(path, post({ ...report, seq: 3, done: true })))!.status).toBe(200);
  expect((await ask(path, post({ ...report, seq: 4, done: true })))!.status).toBe(200);
  const files = readdirSync(dir);
  expect(files.length).toBe(1);
  expect(files[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d-]+Z-aaaaaaaaaaaaaaaa\.json$/);
  expect(JSON.parse(readFileSync(join(dir, files[0]!), "utf8")).seq).toBe(4);
  expect(done.length).toBe(1);
  expect((await ask(`/__device/report?token=${TOKEN}`, { method: "GET" }))!.status).toBe(404);
  for (const bad of ["not json", JSON.stringify({ ...report, run: "../../escape" }), JSON.stringify({ ...report, run: "AAAAAAAAAAAAAAAA" }), JSON.stringify([1]), JSON.stringify({ run: "bbbbbbbbbbbbbbbb" })]) expect((await ask(path, { method: "POST", body: bad }))!.status).toBe(400);
  // Too large, whether it says so or not.
  const big = JSON.stringify({ ...report, run: "cccccccccccccccc", errors: ["x".repeat(REPORT_BYTES)] });
  expect((await ask(path, { method: "POST", body: big }))!.status).toBe(413);
  const stream = new ReadableStream<Uint8Array>({ start: (c) => (c.enqueue(new TextEncoder().encode(big)), c.close()) });
  expect((await ask(path, { method: "POST", body: stream, duplex: "half" } as RequestInit))!.status).toBe(413);
  for (let i = 1; i < MAX_RUNS; i++) expect((await ask(path, post({ ...report, run: i.toString(16).padStart(16, "d") })))!.status).toBe(200);
  expect((await ask(path, post({ ...report, run: "eeeeeeeeeeeeeeee" })))!.status).toBe(429);
  expect(readdirSync(dir).length).toBe(MAX_RUNS);
  expect(existsSync(join(dir, "..", "escape"))).toBe(false);
});

test("a report posted after the files the server serves changed under it says what changed, and the run lacks for it", async () => {
  const files = join(dir, "dist");
  mkdirSync(join(files, "assets"), { recursive: true });
  for (const name of ["index.html", "main.js", "assets/manifest.json", "assets/core.tex.astc.0123456789abcdef.sntx"]) writeFileSync(join(files, name), name);
  const before = servedFiles(files);
  expect([...before.keys()].sort()).toEqual(["assets/core.tex.astc.0123456789abcdef.sntx", "assets/manifest.json", "index.html", "main.js"]);
  const said: string[] = [];
  const { routes } = deviceRoutes({ dir: join(dir, "served"), token: TOKEN, code: "bqzk", password: "secret", expected: {}, say: (line) => said.push(line), base: () => 0, held: () => ({ skipped: 0, overflows: 0 }), changed: () => filesChanged(before, servedFiles(files)) });
  const send = async (report: DeviceReport): Promise<DeviceReport> => {
    const req = new Request(`http://127.0.0.1/__device/report?token=${TOKEN}`, post(report));
    expect((await routes(req, new URL(req.url)))!.status).toBe(200);
    return JSON.parse(readFileSync(join(dir, "served", readdirSync(join(dir, "served"))[0]!), "utf8")) as DeviceReport;
  };
  const report = { ...newReport("abababababababab", "ladder"), seq: 1, stage: "medium bodies 25" };
  expect((await send(report)).served).toBeUndefined();
  // As a build does: its assets folder taken away, then written again.
  rmSync(join(files, "assets"), { recursive: true });
  const kept = await send({ ...report, seq: 2, stage: "medium triangles 8" });
  expect(kept.served).toBe("changed while the server ran: 2 gone (assets/core.tex.astc.0123456789abcdef.sntx, assets/manifest.json)");
  expect(said).toContain("the files this server serves changed while it ran: 2 gone (assets/core.tex.astc.0123456789abcdef.sntx, assets/manifest.json)");
  expect(lacking(kept, "ladder")).toContain("the server's files changed while the server ran: 2 gone (assets/core.tex.astc.0123456789abcdef.sntx, assets/manifest.json)");
  expect(deviceTable(kept)).toContain("files     the server's files changed while the server ran: 2 gone (assets/core.tex.astc.0123456789abcdef.sntx, assets/manifest.json): the run fetched from something else than it started with");
  writeFileSync(join(files, "main.js"), "another build");
  expect(filesChanged(before, servedFiles(files))).toBe("2 gone (assets/core.tex.astc.0123456789abcdef.sntx, assets/manifest.json), 1 rewritten (main.js)");
});

test("a report's table holds no control characters once cleaned, so a hostile one cannot drive the terminal", () => {
  const r = { ...newReport("0123456789abcdef"), stage: "\u001b[2J\u001b]0;owned\u0007" };
  const lines = deviceTable(r);
  expect(lines[0]).toContain("\u001b");
  expect(lines.map((l) => l.replace(/[\u0000-\u001f\u007f-\u009f]/g, "?")).join("")).not.toMatch(/[\u0000-\u001f]/);
});
