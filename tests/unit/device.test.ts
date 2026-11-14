// The device probe's pieces that need no game: its statistics, what it reads off a browser and a graphics context,
// the crowd scene's layout, and its table.

import { expect, test } from "bun:test";
import { crowdScene, deviceTable, featuresOf, formatsOf, gpuOf, newReport, spread, type Within } from "../../client/core/device.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";

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

test("a graphics context is read for its limits by WebGL's own numbers, with the unmasked vendor where the browser gives it", () => {
  const params: Record<number, unknown> = { 0x1f00: "WebKit", 0x9245: "Apple Inc.", 0x1f02: "WebGL 2.0", 0x0d33: 16384, 0x88ff: 2048, 0x8d57: 4, 0x8b4c: 16 };
  const gl = (debug: boolean) => ({
    getParameter: (n: number) => params[n],
    getExtension: (name: string) => (debug && name === "WEBGL_debug_renderer_info" ? {} : null),
    getSupportedExtensions: () => ["WEBGL_compressed_texture_astc"],
    getShaderPrecisionFormat: () => ({ precision: 23 }),
    getContextAttributes: () => ({ antialias: true }),
  });
  expect(gpuOf(gl(true), "Apple GPU", "astc")).toEqual({ vendor: "Apple Inc.", renderer: "Apple GPU", version: "WebGL 2.0", maxTexture: 16384, maxArrayLayers: 2048, maxSamples: 4, vertexTextures: 16, highp: true, antialias: true, extensions: ["WEBGL_compressed_texture_astc"], variant: "astc" });
  expect(gpuOf(gl(false), "Apple GPU").vendor).toBe("WebKit");
});

test("the crowd scene stands behind the spawn point: the thatch near, and every body inside a portrait phone's view", () => {
  const { bodies, floor, pieces } = crowdScene();
  expect(bodies.length).toBe(48);
  // Facing south, a 70 degree tall view on a screen 390 by 844 is 36 degrees wide.
  const half = Math.atan(Math.tan((70 * Math.PI) / 360) * (390 / 844));
  for (const b of bodies) {
    expect(PROVING_SPAWN.z - b.z).toBeGreaterThan(15);
    expect(Math.abs(Math.atan2(b.x - PROVING_SPAWN.x, PROVING_SPAWN.z - b.z))).toBeLessThan(half);
  }
  // A piece's finest level, the one with materials, is drawn only near.
  for (const p of pieces) expect(Math.hypot(p.x - PROVING_SPAWN.x, p.z - PROVING_SPAWN.z)).toBeLessThan(15);
  expect(PROVING_SPAWN.z - floor.z).toBeLessThan(15);
});

test("a report with nothing in it yet still reads as a table", () => {
  const lines = deviceTable(newReport("0123456789abcdef"));
  expect(lines[0]).toBe("SNARK device report 0123456789abcdef: stopped at starting");
  expect(lines).toContain("materials none asked for");
  expect(lines).toContain("tiers run none");
});
