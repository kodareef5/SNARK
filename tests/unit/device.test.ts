// The device probe's pieces that need no game: its statistics, what it reads off a browser and a graphics context, the
// ladder's order, the soak's amounts, the layouts it stands in view, texture memory, and its words.

import { expect, test } from "bun:test";
import { TIERS } from "../../client/core/assets/tiers.ts";
import { AXES, LadderPlan, RUNGS, featuresOf, formatsOf, gpuOf, judgeRung, newReport, soakLoad, spread, type PhaseReport, type RungReport, type Within } from "../../client/core/device.ts";
import { BASE_MOST, TextureMemory, basePieces, bodySpots, crowdScene, type GlMemory } from "../../client/core/devicescene.ts";
import { deviceTable, escape, identify, limitsLine } from "../../client/core/devicetext.ts";
import { PROVING_DIMS, PROVING_SPAWN } from "../../shared/world/proving.ts";

const within: Within = (f, _ms, or) => Promise.resolve().then(f).catch(() => or);

test("a spread is the median and the 95th, 99th and last of the sorted values, to a tenth", () => {
  const values = Array.from({ length: 200 }, (_, i) => 200 - i + 0.04);
  expect(spread(values)).toEqual({ median: 100, p95: 190, p99: 198, worst: 200 });
  expect(spread([16.66, 16.71, 33.3])).toEqual({ median: 16.7, p95: 16.7, p99: 16.7, worst: 33.3 });
  expect(spread([])).toEqual({ median: 0, p95: 0, p99: 0, worst: 0 });
});

test("compressed formats are named by family from the extensions, and the pack's bc variant needs two of them", () => {
  expect(formatsOf(["WEBGL_compressed_texture_astc", "WEBGL_compressed_texture_etc", "EXT_color_buffer_float"])).toEqual(["astc", "etc2"]);
  expect(formatsOf(["EXT_texture_compression_bptc", "WEBGL_compressed_texture_s3tc", "EXT_texture_compression_rgtc"])).toEqual(["bc1-3", "bc4-5", "bc6-7"]);
  expect(formatsOf([])).toEqual([]);
});

test("features are read off a global object, and what a browser lacks or will not answer reads as missing", async () => {
  const bare = await featuresOf({}, within);
  expect(bare).toEqual({ workers: false, opfs: false, decompress: "", audioWorklet: false, opusEncode: false, opusDecode: false, webTransport: false, webgpu: false, wakeLock: false, quotaMB: "?" });
  // A browser whose encoder takes Opus and whose decoder throws, with storage that says its quota.
  class AudioEncoder {
    static isConfigSupported(c: { codec: string }): Promise<{ supported: boolean }> {
      return Promise.resolve({ supported: c.codec === "opus" });
    }
  }
  class AudioDecoder {
    static isConfigSupported(): Promise<{ supported: boolean }> {
      throw new Error("no");
    }
  }
  const navigator = { storage: { getDirectory: () => null, estimate: () => Promise.resolve({ quota: 3 * 1048576 }) }, wakeLock: {} };
  const some = await featuresOf({ AudioEncoder, AudioDecoder, navigator, Worker: class {}, DecompressionStream }, within);
  expect(some).toMatchObject({ workers: true, opfs: true, opusEncode: true, opusDecode: false, wakeLock: true, webgpu: false, quotaMB: 3 });
  // Bun has DecompressionStream, and takes these three at least.
  expect(String(some.decompress).split(" ")).toEqual(expect.arrayContaining(["gzip", "deflate", "deflate-raw"]));
});

const params: Record<number, unknown> = { 0x1f00: "WebKit", 0x9245: "Apple Inc.", 0x1f02: "WebGL 2.0", 0x0d33: 16384, 0x88ff: 2048, 0x8d57: 4, 0x8b4c: 16, 0x8872: 16, 0x8824: 8, 0x84ff: 16 };
const context = (exts: string[], debug = true) => ({
  getParameter: (n: number) => params[n],
  getExtension: (name: string) => ((debug && name === "WEBGL_debug_renderer_info") || (name === "EXT_texture_filter_anisotropic" && exts.includes(name)) ? {} : null),
  getSupportedExtensions: () => exts,
  getShaderPrecisionFormat: () => ({ precision: 23 }),
  getContextAttributes: () => ({ antialias: true }),
});

test("a graphics context is read for its limits by WebGL's own numbers, anisotropy only once its extension is on", () => {
  const phone = ["EXT_color_buffer_float", "EXT_color_buffer_half_float", "EXT_clip_control", "EXT_texture_filter_anisotropic", "WEBGL_compressed_texture_astc", "WEBGL_compressed_texture_etc", "WEBGL_multi_draw"];
  const g = gpuOf(context(phone), "Apple GPU", "astc");
  expect(g).toEqual({ vendor: "Apple Inc.", renderer: "Apple GPU", version: "WebGL 2.0", maxTexture: 16384, maxArrayLayers: 2048, maxSamples: 4, vertexTextures: 16, textureUnits: 16, drawBuffers: 8, anisotropy: 16, highp: true, antialias: true, extensions: phone, variant: "astc" });
  expect(gpuOf(context([], false), "Apple GPU")).toMatchObject({ vendor: "WebKit", anisotropy: 0, variant: "rgba" });
  // What lighting may count on: this phone draws to 32-bit float but cannot filter or blend it.
  expect(limitsLine(g)).toBe("16-bit float targets yes, filtered yes; 32-bit float targets yes, filtered no, blended no; antialiasing up to 4x; 8 targets at once; 16 textures a draw, 16 in vertex shaders; textures to 16384 px; anisotropy 16; reversed depth yes; GPU timers no; multi-draw yes; compressed astc etc2");
});

test("a user agent is told as the device, the browser and the system, and every iOS browser as WebKit", () => {
  const cases: [string, number, string][] = [
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 27_2_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/157.0.8103.37 Mobile/15E148 Safari/604.1", 5, "an iPhone, Chrome for iOS 157 (WebKit, as every iOS browser), iOS 27.2"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1", 5, "an iPhone, Safari 27.2 (WebKit, as every iOS browser), iOS 27.2"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS]", 5, "an iPhone, an app's own browser (WebKit, as every iOS browser), iOS 27.2"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36", 0, "a Mac, Chrome 157, macOS"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Safari/605.1.15", 5, "an iPad asking for desktop pages, Safari 27.2, macOS"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/157.0.0.0 Safari/537.36", 0, "a Mac, headless Chrome 157, macOS"],
    ["Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36", 5, "an Android device, Chrome 157, Android 16"],
  ];
  for (const [ua, touch, said] of cases) expect(identify(ua, touch)).toBe(said);
  expect(escape(`<b onclick="x">'&`)).toBe("&#60;b onclick=&#34;x&#34;&#62;&#39;&#38;");
});

test("the ladder climbs each axis of each tier the device takes until a rung breaks, and a lost context ends it", () => {
  const climb = (maxTexture: number, breaks: (axis: string, n: number) => boolean, lostAt = ""): string[] => {
    const plan = new LadderPlan(maxTexture);
    const seen: string[] = [];
    let [held, lost] = [true, false];
    for (let rung = plan.next(true, false); rung; rung = plan.next(held, lost)) {
      const name = `${rung.tier.name} ${rung.axis} ${rung.n}`;
      seen.push(name);
      [held, lost] = [!breaks(rung.axis, rung.n), name === lostAt];
    }
    return seen;
  };
  const all = climb(16384, () => false);
  expect(all.length).toBe(TIERS.length * AXES.reduce((sum, a) => sum + RUNGS[a].length, 0));
  expect(all.slice(0, 3)).toEqual(["lowpoly bodies 25", "lowpoly bodies 50", "lowpoly bodies 100"]);
  // A device that takes textures only 2,048 wide is not given ultra.
  expect(climb(2048, () => false).some((s) => s.startsWith("ultra"))).toBe(false);
  // Bodies break at 400 on every tier: each tier goes on with triangles after it.
  const broken = climb(1024, (axis, n) => axis === "bodies" && n >= 400);
  expect(broken.filter((s) => s.includes("bodies"))).toEqual(["lowpoly bodies 25", "lowpoly bodies 50", "lowpoly bodies 100", "lowpoly bodies 200", "lowpoly bodies 400", "medium bodies 25", "medium bodies 50", "medium bodies 100", "medium bodies 200", "medium bodies 400"]);
  expect(broken[5]).toBe("lowpoly triangles 8");
  expect(climb(16384, () => false, "medium draws 512").at(-1)).toBe("medium draws 512");
});

test("a rung holds by its frames only when it drew all it was given, settled, fetched what it asked for and kept its tier", () => {
  const phase = (o: Partial<PhaseReport> = {}): PhaseReport => ({ tier: "medium", scene: "plain", ratio: 1, canvas: [1, 1], settleMs: 500, settled: true, frames: 90, frameMs: { median: 16.7, p95: 17, p99: 18, worst: 20 }, buildMs: spread([1]), drawMs: spread([0.5]), drawCalls: 50, triangles: 1000, textured: 0, bones: 0, dropped: 0, skipped: 0, fetched: 0, failed: 0, missed: 0, lost: 0, fellTo: null, ...o });
  expect(judgeRung(phase(), 16.7)).toEqual({ held: true, limit: "", invalid: "" });
  expect(judgeRung(phase({ frameMs: { median: 33.3, p95: 34, p99: 35, worst: 40 } }), 16.7)).toEqual({ held: false, limit: "the GPU", invalid: "" });
  expect(judgeRung(phase({ frameMs: { median: 33.3, p95: 34, p99: 35, worst: 40 }, buildMs: spread([30]) }), 16.7)).toEqual({ held: false, limit: "our code", invalid: "" });
  // A lost context is a result, whatever else went wrong.
  expect(judgeRung(phase({ lost: 1, dropped: 3 }), 16.7)).toEqual({ held: false, limit: "lost", invalid: "" });
  const invalid = (o: Partial<PhaseReport>): string => judgeRung(phase(o), 16.7).invalid;
  expect(invalid({ dropped: 600 })).toBe("600 things dropped");
  expect(invalid({ skipped: 2 })).toBe("2 draws skipped");
  expect(invalid({ failed: 1 })).toBe("1 fetches failed");
  expect(invalid({ fellTo: "lowpoly" })).toBe("the game fell to lowpoly");
  expect(invalid({ settled: false })).toBe("never settled");
  expect(judgeRung(phase({ settled: false }), 16.7)).toMatchObject({ held: false, limit: "" });
});

test("the soak takes half of what the ladder held on its tier, a rung down, or its own amounts without a ladder", () => {
  const rung = (axis: RungReport["axis"], n: number, held: boolean): RungReport => ({ tier: "high", axis, n, held, limit: "", invalid: "", canvas: [], settled: true, frameMs: spread([]), buildMs: 0, drawMs: 0, calls: 0, tris: 0, bones: 0, mat: 0, fetched: 0, missed: 0 });
  const ladder = [rung("bodies", 400, true), rung("bodies", 800, false), rung("pieces", 4096, true), rung("triangles", 64, true), rung("draws", 256, false)];
  expect(soakLoad(ladder, "high")).toEqual({ load: { stress: true, bodies: 200, pieces: 2048, near: 32, far: 0 }, from: "half what the ladder held on high" });
  expect(soakLoad(null, "high").from).toBe("defaults");
  expect(soakLoad(ladder, "medium").from).toBe("defaults");
});

test("the base stands in its wedge, nearest first, stone and wood by turns, and on the map", () => {
  const all = basePieces(BASE_MOST);
  expect(all.length).toBe(BASE_MOST);
  expect(basePieces(100)).toEqual(all.slice(0, 100));
  const houses = [...new Set(all.map((p) => p.house))];
  expect(houses.length).toBe(BASE_MOST / 16);
  for (let i = 1; i < houses.length; i++) expect(Math.hypot(PROVING_SPAWN.x - houses[i]!.x, PROVING_SPAWN.z - houses[i]!.z)).toBeGreaterThanOrEqual(Math.hypot(PROVING_SPAWN.x - houses[i - 1]!.x, PROVING_SPAWN.z - houses[i - 1]!.z));
  expect(all.slice(0, 16).every((p) => p.id.endsWith("_stone")) && all.slice(16, 32).every((p) => p.id.endsWith("_wood"))).toBe(true);
  const side = PROVING_DIMS.chunksX * 64;
  for (const p of all) {
    expect(p.x).toBeLessThan(PROVING_SPAWN.x - 5);
    expect(p.x > 4 && p.z > 4 && p.z < side - 4).toBe(true);
  }
  // Added bodies stand toward +X, in view of a portrait phone.
  const spots = bodySpots(2048);
  for (const s of spots) expect(Math.abs(Math.atan2(s.z - PROVING_SPAWN.z, s.x - PROVING_SPAWN.x))).toBeLessThan(0.3);
});

test("the crowd scene stands behind the spawn point: the thatch near, and every body inside a portrait phone's view", () => {
  const { bodies, floor, pieces } = crowdScene();
  expect(bodies.length).toBe(48);
  const half = Math.atan(Math.tan((70 * Math.PI) / 360) * (390 / 844));
  for (const b of bodies) {
    expect(PROVING_SPAWN.z - b.z).toBeGreaterThan(15);
    expect(Math.abs(Math.atan2(b.x - PROVING_SPAWN.x, PROVING_SPAWN.z - b.z))).toBeLessThan(half);
  }
  for (const p of pieces) expect(Math.hypot(p.x - PROVING_SPAWN.x, p.z - PROVING_SPAWN.z)).toBeLessThan(15);
  expect(PROVING_SPAWN.z - floor.z).toBeLessThan(15);
});

/** A context that holds `room` megabytes of textures and then runs out, or loses itself. */
function card(room: number, lose = false) {
  const made: object[] = [];
  let error = 0;
  let unit = 0x84c0;
  const gl: GlMemory = {
    createTexture: () => ({}),
    deleteTexture: (t) => void made.splice(made.indexOf(t as object), 1),
    bindTexture: (_target, t) => void (t && !made.includes(t as object) && made.push(t as object)),
    activeTexture: (u) => void (unit = u),
    texStorage2D: () => void (made.length > room && (error = 0x0505)),
    compressedTexSubImage2D: () => {},
    texSubImage2D: () => {},
    getError: () => [error, (error = 0)][0]!,
    isContextLost: () => lose && made.length > room,
    getParameter: () => unit,
  };
  return { gl, made, unit: () => unit };
}

test("texture memory grows a megabyte at a time on a spare unit, and says when the context runs out or is lost", () => {
  const c = card(300);
  const mem = new TextureMemory(c.gl, () => c.gl.createTexture(), "astc");
  let state = "";
  for (let i = 0; i < 20 && state !== "held"; i++) state = mem.grow(128, 16);
  expect([state, mem.mb, c.made.length, c.unit()]).toEqual(["held", 128, 128, 0x84c0]);
  for (let i = 0; i < 40 && (state === "held" || state === "growing"); i++) state = mem.grow(512, 16);
  expect(state).toBe("out of memory");
  mem.free();
  expect(c.made.length).toBe(0);
  const lost = card(64, true);
  const gone = new TextureMemory(lost.gl, () => lost.gl.createTexture(), "rgba");
  for (let i = 0; i < 10 && state !== "context lost"; i++) state = gone.grow(128, 16);
  expect(state).toBe("context lost");
});

test("a report with nothing in it yet still reads as a table", () => {
  const lines = deviceTable(newReport("0123456789abcdef", "ladder"));
  expect(lines[0]).toBe("SNARK device report 0123456789abcdef, ladder: stopped at starting");
  expect(lines).toContain("materials none asked for");
});
