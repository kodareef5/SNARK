// Checks the ASTC decoder in astc.ts against a GPU, which is the only referee that did not write it. Not part of the
// check: run it by hand with `bun tools/pack/astc-gpu.ts`. It starts a local server and headless Chrome on a page that
// uploads blocks as a compressed texture, in the linear format and in the sRGB one, draws each texel to one pixel,
// reads the pixels back and posts them. They are compared with what our decoder says the same blocks hold.
//
// Three sets of blocks go up. What the encoder makes of test pictures, so that every kind of block it emits is seen.
// Blocks put together bit by bit to be valid, over every grid, range, endpoint mode and partition count a 4 by 4
// block can have, so that the decoder is checked well beyond what the encoder uses. And blocks that are not valid,
// which the format says decode to magenta; what a GPU does with those is printed but does not fail the run.
//
// CHROME sets the browser path. Exits 0 when every valid block matches exactly.
//
// The unit test of the decoder pins a sum over a small set of built blocks. This tool shows the GPU that same set and
// prints the sum, so the test's sum is one a GPU has agreed with. After changing the decoder, run this again.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AstcKind, astcBlockInfo, astcFloat8, decodeAstcBlock, decodeAstcBlock16, encodeAstc } from "./astc.ts";
import { readPng } from "./png-read.ts";

/** Blocks in a row of the texture that goes up. */
const ACROSS = 256;
const MODE_NAMES: Record<number, string> = { 0: "l", 1: "l offset", 4: "la", 5: "la offset", 6: "rgb scale", 8: "rgb", 9: "rgb offset", 10: "rgb scale a", 12: "rgba", 13: "rgba offset" };
const GRIDS = [[4, 4], [4, 3], [3, 4], [4, 2], [2, 4], [3, 3], [3, 2], [2, 3], [2, 2]] as const;

/** A seeded source of whole numbers below `n`. */
function dice(seed: number): (n: number) => number {
  let state = seed;
  return (n) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return Math.floor(((state >>> 0) / 4294967296) * n);
  };
}

interface Sample {
  block: Uint8Array;
  /** The set it belongs to, and its row in that set's table. */
  set: "encoder" | "built" | "invalid";
  row: string;
}

function describe(block: Uint8Array, grid: boolean): string {
  const b = astcBlockInfo(block, 0);
  if (b.solid) return "solid";
  const names = b.modes.map((m) => MODE_NAMES[m] ?? "hdr");
  const mode = names.every((n) => n === names[0]) ? names[0]! : names.join(" + ");
  return `${b.partitions} part${b.partitions > 1 ? "s" : " "} ${mode}${b.secondPlane >= 0 ? ", two planes" : ""}${grid ? `, grid ${b.gridWidth}x${b.gridHeight}` : ""}`;
}

function setBits(block: Uint8Array, at: number, count: number, value: number): void {
  for (let i = 0; i < count; i++, at++) block[at >> 3] = (block[at >> 3]! & ~(1 << (at & 7))) | (((value >> i) & 1) << (at & 7));
}

/** Blocks of random bits under a block mode, a partition count and endpoint modes that were chosen: `each` or so for
 *  every grid, weight range, number of planes and number of partitions. Then some of random bits alone, and some
 *  void-extent blocks, good and bad. Each comes with what our decoder takes it for. */
export function builtBlocks(seed: number, each: number): Sample[] {
  const below = dice(seed);
  const out: Sample[] = [];
  const add = (block: Uint8Array): void => {
    const b = astcBlockInfo(block, 0);
    if (b.valid) out.push({ block, set: "built", row: describe(block, false) });
    else out.push({ block, set: "invalid", row: b.partitions > 0 ? "a partition with an hdr mode" : (block[0] === 0xfc && block[1]! & 1) ? "void-extent that is not allowed" : "block mode or bit counts not allowed" });
  };
  const ldr = [0, 1, 4, 5, 6, 8, 9, 10, 12, 13];
  for (let parts = 1; parts <= 4; parts++) {
    for (const [w, h] of GRIDS) {
      for (let range = 0; range < 12; range++) {
        for (let dual = 0; dual < 2; dual++) {
          for (let n = 0; n < (parts === 1 ? each * 2 : each * 3); n++) {
            const block = new Uint8Array(16).map(() => below(256));
            const r = (range % 6) + 2;
            const shape = w === 4 ? ((h - 2) << 5) | (r >> 1) : 0x100 | ((w - 2) << 7) | ((h - 2) << 5) | 0xc | (r >> 1);
            setBits(block, 0, 11, (dual << 10) | (range >= 6 ? 0x200 : 0) | shape | ((r & 1) << 4));
            setBits(block, 11, 2, parts - 1);
            // One mode for every partition two times in three, else a mode for each.
            if (parts === 1) setBits(block, 13, 4, ldr[below(10)]!);
            else if (n % 3 !== 0) setBits(block, 23, 6, ldr[below(10)]! << 2);
            else setBits(block, 23, 2, 1 + below(3));
            add(block);
          }
        }
      }
    }
  }
  for (let n = 0; n < each * 340; n++) {
    const block = new Uint8Array(16).map(() => below(256));
    if (n % 4 === 0) {
      // A void-extent block: sometimes with its reserved bits wrong, sometimes with an extent, which random bits rarely
      // make a legal one.
      block[0] = 0xfc;
      block[1] = (block[1]! & 0xf0) | (n % 16 === 0 ? below(16) : 0xd);
      if (n % 8 !== 0) block.fill(0xff, 2, 8), (block[1] = block[1]! | 0xf0);
    }
    add(block);
  }
  return out;
}

/** A sum over what our decoder makes of some blocks, in both formats. */
export function decodedSum(samples: Sample[]): string {
  const out = new Uint8Array(64);
  let sum = 0x811c9dc5;
  for (const s of samples) {
    for (const srgb of [false, true]) {
      decodeAstcBlock(s.block, 0, srgb, out);
      for (let i = 0; i < 64; i++) sum = Math.imul(sum ^ out[i]!, 0x01000193);
    }
  }
  return (sum >>> 0).toString(16).padStart(8, "0");
}

/** The seed and count of the set the unit test pins. */
export const PINNED = { seed: 0x5eed0a57, each: 1 };

// ---- What the encoder emits ----

/** A square picture from a function of position that gives red, green, blue and alpha. */
function picture(size: number, at: (x: number, y: number) => number[]): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out.set(at(x, y).map((v) => Math.max(0, Math.min(255, Math.round(v)))), (y * size + x) * 4);
  return out;
}

function encoderBlocks(): Sample[] {
  const below = dice(0x2f6b7a31);
  const noise = (amount: number): number => (below(1 << 20) / (1 << 20) - 0.5) * amount;
  const PURE = [[0, 0, 0], [255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255]];
  /** A patchwork: each 16 by 16 tile draws its own colours, so one picture holds many kinds of block. */
  const patchwork = (size: number, alpha: boolean, grey: boolean, amount: number): Uint8Array => {
    const tiles = new Map<number, number[][]>();
    return picture(size, (x, y) => {
      const key = (y >> 4) * 1000 + (x >> 4);
      let tile = tiles.get(key);
      if (!tile) tiles.set(key, (tile = [0, 1, 2].map(() => [below(256), below(256), below(256), alpha ? below(256) : 255])));
      // A tile is a slope between two colours, or two or three colours with hard edges between them.
      const style = key % 4;
      const t = ((x & 15) + (y & 15) * (key % 3)) / (15 + 15 * (key % 3));
      let c: number[];
      if (style === 0) c = tile[0]!.map((v, i) => v + (tile![1]![i]! - v) * t);
      else if (style === 1) c = (x & 15) * 2 + (y & 15) > 20 ? tile[0]! : tile[1]!;
      else if (style === 2) c = tile[((x & 15) > 7 ? 1 : 0) + ((y & 15) > 9 ? 1 : 0)]!;
      else c = tile[0]!.map((v, i) => v + (tile![1]![i]! - v) * t + (i === 3 ? (tile![2]![3]! - 128) * ((x & 15) / 15) : 0));
      const out = c.map((v) => v + noise(amount));
      if (grey) out[1] = out[2] = out[0]!;
      if (!alpha) out[3] = 255;
      return out;
    });
  };
  const pictures: [Uint8Array, number, AstcKind][] = [
    [patchwork(128, false, false, 0), 128, "srgb"],
    [patchwork(128, false, false, 40), 128, "linear"],
    [patchwork(128, true, false, 0), 128, "srgb"],
    [patchwork(128, true, false, 30), 128, "linear"],
    [patchwork(128, false, true, 20), 128, "linear"],
    [patchwork(128, true, true, 20), 128, "linear"],
    [picture(128, (x, y) => [128 + 100 * Math.sin(x / 9) + noise(8), 128 + 100 * Math.cos(y / 5 + x / 17) + noise(8), 255, 255]), 128, "normal"],
    [picture(128, (x, y) => [...PURE[(((x + (y >> 2)) >> 3) + (y >> 4)) % 7]!, 255]), 128, "linear"],
    [picture(16, () => [12, 200, 77, 140]), 16, "srgb"],
  ];
  const art = join(import.meta.dir, "../../planning/artist-test");
  for (const [file, kind] of [["feather/feather_base.png", "srgb"], ["wood/wood_base.png", "srgb"], ["feather/feather_normal.png", "normal"], ["wood/wood_normal.png", "normal"], ["wood/wood_orm.png", "linear"], ["feather/feather_mask.png", "linear"]] as const) {
    if (!existsSync(join(art, file))) continue;
    const png = readPng(join(art, file));
    // A 192-pixel square from the middle of the picture.
    const from = (png.width - 192) >> 1;
    pictures.push([picture(192, (x, y) => [0, 1, 2, 3].map((c) => (c < png.channels ? png.data[((y + from) * png.width + x + from) * png.channels + c]! : 255))), 192, kind]);
  }
  const out: Sample[] = [];
  for (const [rgba, size, kind] of pictures) {
    const blocks = encodeAstc(rgba, size, size, kind);
    for (let at = 0; at < blocks.length; at += 16) {
      const block = blocks.slice(at, at + 16);
      out.push({ block, set: "encoder", row: describe(block, true) });
    }
  }
  return out;
}

// ---- The page ----

function page(width: number, height: number): string {
  return `<!doctype html><meta charset="utf-8"><canvas id="c" width="4" height="4"></canvas><script>
(async () => {
  const say = (o) => fetch("/report?" + new URLSearchParams(o.info), { method: "POST", body: o.pixels || new Uint8Array(0) });
  try {
    const W = ${width}, H = ${height};
    const gl = document.getElementById("c").getContext("webgl2");
    if (!gl) return say({ info: { error: "no WebGL2" } });
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const astc = gl.getExtension("WEBGL_compressed_texture_astc");
    if (!astc) return say({ info: { error: "no WEBGL_compressed_texture_astc", renderer } });
    const blocks = new Uint8Array(await (await fetch("/blocks")).arrayBuffer());
    const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, "#version 300 es\\nvoid main() { gl_Position = vec4(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0, 0.0, 1.0); }"));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, "#version 300 es\\nprecision highp float; uniform sampler2D t; out vec4 o; void main() { o = texelFetch(t, ivec2(gl_FragCoord.xy), 0); }"));
    gl.linkProgram(program);
    gl.useProgram(program);
    gl.disable(gl.BLEND);
    gl.disable(gl.DITHER);
    // One texel to one pixel: into a target of the same size, and for sRGB a target that stores sRGB too, so the
    // bytes read back are the bytes the format decoded to.
    const show = (w, h, target, upload) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      upload();
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const to = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, to);
      gl.texStorage2D(gl.TEXTURE_2D, 1, target, w, h);
      gl.activeTexture(gl.TEXTURE0);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, to, 0);
      gl.viewport(0, 0, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    // A control with no compression in it: every byte value through the same two paths.
    const ramp = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) ramp.set([i, 255 - i, (i * 7) & 255, (i * 13 + 5) & 255], i * 4);
    const parts = [
      show(256, 1, gl.RGBA8, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, ramp)),
      show(256, 1, gl.SRGB8_ALPHA8, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, ramp)),
      show(W, H, gl.RGBA8, () => gl.compressedTexImage2D(gl.TEXTURE_2D, 0, astc.COMPRESSED_RGBA_ASTC_4x4_KHR, W, H, 0, blocks)),
      show(W, H, gl.SRGB8_ALPHA8, () => gl.compressedTexImage2D(gl.TEXTURE_2D, 0, astc.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR, W, H, 0, blocks)),
    ];
    const glError = gl.getError();
    const pixels = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { pixels.set(p, at); at += p.length; }
    say({ info: { renderer, glError }, pixels });
  } catch (e) {
    say({ info: { error: String(e) } });
  }
})();
</script>`;
}

interface Report {
  info: Record<string, string>;
  pixels: Uint8Array;
}

/** Runs the page in Chrome with some flags and waits for what it posts. The server takes a free port and Chrome a
 *  profile of its own in the system's temporary folder, so other runs of Chrome are not disturbed. */
async function ask(chrome: string, flags: string[], html: string, packed: Uint8Array): Promise<Report | null> {
  let got: (r: Report) => void = () => {};
  const posted = new Promise<Report>((resolve) => (got = resolve));
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/blocks") return new Response(packed);
      if (url.pathname === "/report") {
        got({ info: Object.fromEntries(url.searchParams), pixels: new Uint8Array(await req.arrayBuffer()) });
        return new Response("ok");
      }
      return new Response(html, { headers: { "content-type": "text/html" } });
    },
  });
  const profile = mkdtempSync(join(tmpdir(), "snark-astc-gpu-"));
  const browser = Bun.spawn([chrome, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", ...flags, `--user-data-dir=${profile}`, `http://localhost:${server.port}/`], { stdout: "ignore", stderr: "ignore" });
  const report = await Promise.race([posted, new Promise<null>((r) => setTimeout(() => r(null), 30000))]);
  browser.kill();
  await browser.exited;
  server.stop(true);
  rmSync(profile, { recursive: true, force: true });
  return report;
}

interface Row {
  blocks: number;
  /** Worst difference from our decoder as shipped: the linear format, then the sRGB one. */
  worst: [number, number];
  /** Blocks the GPU showed as plain magenta in the linear format, and as nothing at all. */
  magenta: number;
  zero: number;
}

async function main(): Promise<void> {
  const chrome = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && existsSync(p));
  if (!chrome) {
    console.error("astc-gpu: no Chrome found. Set CHROME to its path.");
    process.exit(2);
  }
  const pinned = builtBlocks(PINNED.seed, PINNED.each);
  const samples = [...encoderBlocks(), ...builtBlocks(0x1d2c3b4a, 12), ...pinned];
  const width = ACROSS * 4;
  const height = Math.ceil(samples.length / ACROSS) * 4;
  const packed = new Uint8Array(ACROSS * (height / 4) * 16);
  // The tail of the last row is filled with solid black blocks.
  for (let at = 0; at < packed.length; at += 16) packed.set([0xfc, 0xfd, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0xff, 0xff], at);
  samples.forEach((s, i) => packed.set(s.block, i * 16));

  // Headless Chrome may or may not start on the real GPU. Each set of flags is tried until one gives the extension.
  const FLAG_SETS = [[], ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"], ["--use-gl=angle", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"], ["--use-angle=gl", "--enable-gpu", "--ignore-gpu-blocklist"]];
  let report: Report | null = null;
  for (const flags of FLAG_SETS) {
    report = await ask(chrome, flags, page(width, height), packed);
    const why = !report ? "no report within 30 s" : report.info.error;
    console.log(`chrome ${flags.join(" ") || "(no extra flags)"}: ${why ?? "ok"}${report?.info.renderer ? `, renderer ${report.info.renderer}` : ""}`);
    if (report && !report.info.error) break;
    report = null;
  }
  if (!report) {
    console.error("\nastc-gpu: COULD NOT RUN. No way of starting Chrome gave a WebGL2 context with WEBGL_compressed_texture_astc.");
    process.exit(2);
  }

  const control = report.pixels.subarray(0, 2048);
  let controlWorst = 0;
  for (let i = 0; i < 256; i++) {
    const want = [i, 255 - i, (i * 7) & 255, (i * 13 + 5) & 255];
    for (let c = 0; c < 4; c++) controlWorst = Math.max(controlWorst, Math.abs(control[i * 4 + c]! - want[c]!), Math.abs(control[1024 + i * 4 + c]! - want[c]!));
  }
  console.log(`\ngl error ${report.info.glError}. Control, uncompressed bytes through the same two paths: worst difference ${controlWorst}`);

  const linear = report.pixels.subarray(2048, 2048 + width * height * 4);
  const srgb = report.pixels.subarray(2048 + width * height * 4);
  const d16 = new Uint16Array(64);
  const s16 = new Uint16Array(64);
  const d8 = new Uint8Array(64);
  const tables = new Map<string, Map<string, Row>>();
  const rowOf = (table: string, name: string): Row => {
    let t = tables.get(table);
    if (!t) tables.set(table, (t = new Map()));
    let row = t.get(name);
    if (!row) t.set(name, (row = { blocks: 0, worst: [0, 0], magenta: 0, zero: 0 }));
    return row;
  };
  // How 16 bits become 8 is the GPU's choice. Each way is scored over the valid blocks, as the worst difference it
  // leaves: the top 8 bits, or through a 16-bit float, of the result blended from end colours whose 8 bits were
  // repeated; and, for the sRGB format's alpha, the top 8 bits of a result blended the way that format's colours are.
  const rules = { "linear colour": [0, 0, -1], "linear alpha": [0, 0, -1], "sRGB alpha": [0, 0, 0] } as Record<string, [number, number, number]>;

  samples.forEach((s, n) => {
    const x0 = (n % ACROSS) * 4;
    const y0 = Math.floor(n / ACROSS) * 4;
    const b = astcBlockInfo(s.block, 0);
    const names = [`${s.set}: ${s.row}`];
    if (s.set === "built") names.push(`built, by grid: ${b.solid ? "solid" : `${b.gridWidth}x${b.gridHeight}`}`, `built, by weight levels: ${b.solid ? "solid" : b.weightLevels}`, `built, by colour levels: ${b.solid ? "solid" : b.colourLevels}`);
    const rows = names.map((name) => rowOf(name.split(":")[0]!, name.slice(name.indexOf(":") + 2)));
    for (const row of rows) row.blocks++;
    let magenta = true;
    let zero = true;
    decodeAstcBlock16(s.block, 0, false, d16);
    decodeAstcBlock16(s.block, 0, true, s16);
    for (const [f, shown] of [linear, srgb].entries()) {
      decodeAstcBlock(s.block, 0, f === 1, d8);
      for (let i = 0; i < 16; i++) {
        const at = ((y0 + (i >> 2)) * width + x0 + (i & 3)) * 4;
        for (let c = 0; c < 4; c++) {
          const got = shown[at + c]!;
          const d = Math.abs(got - d8[i * 4 + c]!);
          for (const row of rows) row.worst[f] = Math.max(row.worst[f]!, d);
          if (f === 0 && got !== (c === 1 ? 0 : 255)) magenta = false;
          if (f === 0 && got !== 0) zero = false;
          if (s.set === "invalid" || (f === 1 && c < 3)) continue;
          const rule = rules[f === 1 ? "sRGB alpha" : c === 3 ? "linear alpha" : "linear colour"]!;
          rule[0] = Math.max(rule[0], Math.abs(got - (d16[i * 4 + c]! >> 8)));
          rule[1] = Math.max(rule[1], Math.abs(got - astcFloat8(d16[i * 4 + c]!)));
          if (f === 1) rule[2] = Math.max(rule[2], Math.abs(got - (s16[i * 4 + c]! >> 8)));
        }
      }
    }
    if (magenta) for (const row of rows) row.magenta++;
    if (zero) for (const row of rows) row.zero++;
  });

  console.log("\nHow this GPU makes 8 bits of the 16-bit result. The worst difference each way would leave (0 is the way it does it):");
  for (const [name, [top, float, asColour]] of Object.entries(rules)) console.log(`  ${name.padEnd(14)} top 8 bits ${String(top).padStart(3)}   through a float ${String(float).padStart(3)}${asColour >= 0 ? `   blended as the colours are ${String(asColour).padStart(3)}` : ""}`);

  let failed = controlWorst > 0;
  for (const [table, rows] of tables) {
    if (table === "invalid") {
      // Our decoder gives magenta, or magenta in the pixels of a partition with a high dynamic range mode. The format
      // lets the linear format give not-a-number instead, and a GPU with the high dynamic range profile decodes those
      // partitions. So the sRGB column is the one that says whether we and the GPU agree on what is valid.
      console.log("\ninvalid (printed, never failed): worst difference from our magenta in the sRGB format, and what the linear format showed");
      console.log(`  ${"blocks".padStart(6)}  ${"sRGB".padStart(6)}  ${"magenta".padStart(7)}  ${"nothing".padStart(7)}  kind`);
      for (const [name, row] of rows) console.log(`  ${String(row.blocks).padStart(6)}  ${String(row.worst[1]).padStart(6)}  ${String(row.magenta).padStart(7)}  ${String(row.zero).padStart(7)}  ${name}`);
      continue;
    }
    console.log(`\n${table}: worst difference from our decoder`);
    console.log(`  ${"blocks".padStart(6)}  ${"linear".padStart(6)}  ${"sRGB".padStart(6)}  kind`);
    const sorted = [...rows].sort((a, b) => (table.includes("levels") ? Number(a[0]) - Number(b[0]) : a[0].localeCompare(b[0])));
    for (const [name, row] of sorted) {
      console.log(`  ${String(row.blocks).padStart(6)}  ${String(row.worst[0]).padStart(6)}  ${String(row.worst[1]).padStart(6)}  ${name}`);
      if (row.worst[0] > 0 || row.worst[1] > 0) failed = true;
    }
  }
  const valid = samples.filter((s) => s.set !== "invalid").length;
  console.log(`\nThe decoder's sum over the ${pinned.length} blocks the unit test pins, which were among these: ${decodedSum(pinned)}`);
  console.log(`\nastc-gpu: ${failed ? "FAIL" : "PASS"}. ${valid} valid blocks, each in both formats, on ${report.info.renderer}.`);
  process.exit(failed ? 1 : 0);
}

if (import.meta.main) await main();
