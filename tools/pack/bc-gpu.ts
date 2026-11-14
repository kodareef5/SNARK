// Holds the BC5 and BC7 code in bc.ts against a GPU, which is the one decoder not written by the hand that wrote the
// encoders. Not part of the check. It serves a page to headless Chrome; the page uploads blocks as compressed
// textures, draws each one texel to one pixel, reads the pixels back and posts them here, where they are compared
// with what our decoders make of the same blocks. A wrong table entry or bit position cannot pass.
//
//   bun tools/pack/bc-gpu.ts [--alpha] [--software] [picture.png ...]
//
// It always checks blocks of random bits in each of the eight BC7 modes, which covers every partition, rotation and
// index layout, and the test card put through our encoders, in the linear and the sRGB format. Pictures named on the
// command line are encoded and checked too, with their decibels as the GPU shows them and the encoder's speed: a
// name with "normal" in it as BC5, others as BC7, ignoring alpha if the file has none unless --alpha is given.
// CHROME sets the browser path. --software asks Chrome for its software renderer in place of the GPU.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashBytes } from "../../shared/hash.ts";
import { card, randomBc5, randomBc7 } from "../../tests/fixtures/bc.ts";
import { bc7Mode, blockCount, decodeBc5, decodeBc7, encodeBc5, encodeBc7 } from "./bc.ts";
import { readPng } from "./png-read.ts";

// The formats of EXT_texture_compression_bptc and EXT_texture_compression_rgtc.
const RGBA_BPTC = 0x8e8c;
const SRGB_ALPHA_BPTC = 0x8e8d;
const RED_GREEN_RGTC2 = 0x8dbd;

interface Job {
  name: string;
  format: number;
  /** "srgb" draws into an sRGB target, so that what was decoded as sRGB is read back as the bytes that were stored. "float" draws into a float target, to see values between levels. */
  target: "bytes" | "srgb" | "float";
  /** WebGL takes a picture that is not whole blocks only as a smaller level of a texture. */
  level: number;
  width: number;
  height: number;
  blocks: Uint8Array;
  /** What the picture was before it was encoded, how many of its channels count, and how long encoding took. */
  source?: Uint8Array;
  channels?: number;
  seconds?: number;
  /** Print the hash of what the GPU drew, for tests/unit/bc.test.ts to pin. */
  pin?: boolean;
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>bc-gpu</title><script type="module">
const report = { ok: false, renderer: "", bptc: false, rgtc: false, float: false, errors: [] };
try {
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) throw new Error("no WebGL2");
  const names = gl.getExtension("WEBGL_debug_renderer_info");
  report.renderer = names ? gl.getParameter(names.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  report.bptc = !!gl.getExtension("EXT_texture_compression_bptc");
  report.rgtc = !!gl.getExtension("EXT_texture_compression_rgtc");
  report.float = !!gl.getExtension("EXT_color_buffer_float");
  const shader = (type, text) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  // One triangle over the whole target, and each pixel the texel under it.
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, "#version 300 es\\nvoid main() { gl_Position = vec4(float((gl_VertexID << 1) & 2) * 2.0 - 1.0, float(gl_VertexID & 2) * 2.0 - 1.0, 0.0, 1.0); }"));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, "#version 300 es\\nprecision highp float; uniform highp sampler2D t; out vec4 o; void main() { o = texelFetch(t, ivec2(gl_FragCoord.xy), 0); }"));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.disable(gl.BLEND);
  gl.disable(gl.DITHER);
  const jobs = await (await fetch("/jobs")).json();
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (!(job.format === ${RED_GREEN_RGTC2} ? report.rgtc : report.bptc) || (job.target === "float" && !report.float)) continue;
    const blocks = new Uint8Array(await (await fetch("/blocks/" + i)).arrayBuffer());
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, job.level);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, job.level);
    gl.compressedTexImage2D(gl.TEXTURE_2D, job.level, job.format, job.width, job.height, 0, blocks);
    const target = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texStorage2D(gl.TEXTURE_2D, 1, job.target === "float" ? gl.RGBA32F : job.target === "srgb" ? gl.SRGB8_ALPHA8 : gl.RGBA8, job.width, job.height);
    const frame = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error(job.name + ": the framebuffer is not complete");
    gl.viewport(0, 0, job.width, job.height);
    gl.uniform1i(gl.getUniformLocation(program, "t"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixels = job.target === "float" ? new Float32Array(job.width * job.height * 4) : new Uint8Array(job.width * job.height * 4);
    gl.readPixels(0, 0, job.width, job.height, gl.RGBA, job.target === "float" ? gl.FLOAT : gl.UNSIGNED_BYTE, pixels);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) report.errors.push(job.name + ": GL error 0x" + error.toString(16));
    else await fetch("/pixels/" + i, { method: "POST", body: pixels });
    gl.deleteFramebuffer(frame);
    gl.deleteTexture(target);
    gl.deleteTexture(texture);
  }
  report.ok = true;
} catch (e) {
  report.errors.push(String((e && e.message) || e));
}
await fetch("/report", { method: "POST", body: JSON.stringify(report) });
</script>`;

function timed<T>(make: () => T): { value: T; seconds: number } {
  const t0 = performance.now();
  const value = make();
  return { value, seconds: (performance.now() - t0) / 1000 };
}

/** Decibels of `got` against `want` over the first `channels` channels of RGBA. */
function decibels(want: Uint8Array, got: Uint8Array, channels: number): number {
  let sum = 0;
  for (let i = 0; i < want.length; i += 4) for (let c = 0; c < channels; c++) sum += (want[i + c]! - got[i + c]!) ** 2;
  return sum === 0 ? Infinity : 10 * Math.log10((255 * 255 * (want.length / 4) * channels) / sum);
}

const jobs: Job[] = [];
const job = (name: string, format: number, width: number, height: number, blocks: Uint8Array, more: Partial<Job> = {}) => jobs.push({ name, format, target: "bytes", level: 0, width, height, blocks, ...more });

for (let mode = 0; mode < 8; mode++) {
  // The 256 blocks the unit test decodes, and 4,096 more.
  job(`BC7 mode ${mode}, random bits`, RGBA_BPTC, 64, 64, randomBc7(mode, 256, 100 + mode), { pin: true });
  const blocks = randomBc7(mode, 4096, 200 + mode);
  job(`BC7 mode ${mode}, random bits`, RGBA_BPTC, 256, 256, blocks);
  job(`BC7 mode ${mode}, random bits, sRGB`, SRGB_ALPHA_BPTC, 256, 256, blocks, { target: "srgb" });
}
{
  const blocks = randomBc5(4096, 300);
  job("BC5, random bits", RED_GREEN_RGTC2, 256, 256, blocks);
  job("BC5, random bits, float", RED_GREEN_RGTC2, 256, 256, blocks, { target: "float" });
}
for (const [what, alpha, channels] of [["opaque card", false, 4], ["opaque card, alpha ignored", false, 3], ["card with alpha", true, 4]] as const) {
  const source = card(256, alpha);
  const made = timed(() => encodeBc7(source, 256, 256, channels));
  job(`BC7 encoder, ${what}`, RGBA_BPTC, 256, 256, made.value, { source, channels, seconds: made.seconds });
  job(`BC7 encoder, ${what}, sRGB`, SRGB_ALPHA_BPTC, 256, 256, made.value, { target: "srgb", source, channels });
}
{
  const source = card(256, false);
  const made = timed(() => encodeBc5(source, 256, 256));
  job("BC5 encoder, opaque card", RED_GREEN_RGTC2, 256, 256, made.value, { source, channels: 2, seconds: made.seconds });
  // The smallest pictures of a texture: one and two pixels across, each a block padded with its edge.
  for (const size of [1, 2]) {
    const small = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) small.set(source.subarray((y * 256 + 100) * 4, (y * 256 + 100 + size) * 4), y * size * 4);
    job(`BC7 encoder, ${size} by ${size}`, RGBA_BPTC, size, size, encodeBc7(small, size, size), { level: 3 - size, source: small, channels: 4 });
    job(`BC5 encoder, ${size} by ${size}`, RED_GREEN_RGTC2, size, size, encodeBc5(small, size, size), { level: 3 - size, source: small, channels: 2 });
  }
}
for (const path of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
  const image = readPng(path);
  const source = new Uint8Array(image.width * image.height * 4).fill(255);
  for (let i = 0; i < image.width * image.height; i++) for (let c = 0; c < image.channels; c++) source[i * 4 + c] = image.data[i * image.channels + c]!;
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name.includes("normal")) {
    const made = timed(() => encodeBc5(source, image.width, image.height));
    job(name, RED_GREEN_RGTC2, image.width, image.height, made.value, { source, channels: 2, seconds: made.seconds });
  } else {
    const channels = image.channels === 4 || process.argv.includes("--alpha") ? 4 : 3;
    const made = timed(() => encodeBc7(source, image.width, image.height, channels));
    job(`${name}${channels === 4 ? ", alpha kept" : ""}`, RGBA_BPTC, image.width, image.height, made.value, { source, channels, seconds: made.seconds });
  }
}

const CANDIDATES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];
const chrome = CANDIDATES.find((p) => p && existsSync(p));
if (!chrome) {
  console.error("bc-gpu: no Chrome found. Set CHROME to its path.");
  process.exit(2);
}

interface Report {
  ok: boolean;
  renderer: string;
  bptc: boolean;
  rgtc: boolean;
  float: boolean;
  errors: string[];
}
const pixels: (Uint8Array | undefined)[] = [];
let finish: (r: Report) => void = () => {};
const finished = new Promise<Report>((r) => (finish = r));
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const i = Number(url.pathname.slice(url.pathname.lastIndexOf("/") + 1));
    if (url.pathname === "/") return new Response(PAGE, { headers: { "content-type": "text/html" } });
    if (url.pathname === "/jobs") return Response.json(jobs.map((j) => ({ name: j.name, format: j.format, target: j.target, level: j.level, width: j.width, height: j.height })));
    if (url.pathname.startsWith("/blocks/") && jobs[i]) return new Response(jobs[i].blocks);
    if (url.pathname.startsWith("/pixels/") && req.method === "POST") {
      pixels[i] = new Uint8Array(await req.arrayBuffer());
      return new Response("ok");
    }
    if (url.pathname === "/report" && req.method === "POST") {
      finish((await req.json()) as Report);
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  },
});
// A profile of its own in the system's temporary folder and a port the system picks, so that others can run Chrome at the same time.
const profile = mkdtempSync(join(tmpdir(), "snark-bc-gpu-"));
const renderer = process.argv.includes("--software") ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--enable-gpu", "--ignore-gpu-blocklist"];
const browser = Bun.spawn([chrome, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", ...renderer, `--user-data-dir=${profile}`, `http://localhost:${server.port}/`], { stdout: "ignore", stderr: "ignore" });
const report = await Promise.race([finished, new Promise<null>((r) => setTimeout(() => r(null), 120000))]);
browser.kill();
await browser.exited;
server.stop();
rmSync(profile, { recursive: true, force: true });

if (!report) {
  console.error("bc-gpu: no report within 120 s. The page did not run, or WebGL2 is unavailable in headless mode.");
  process.exit(1);
}
console.log(`renderer: ${report.renderer}`);
console.log(`EXT_texture_compression_bptc: ${report.bptc ? "yes" : "NO"}   EXT_texture_compression_rgtc: ${report.rgtc ? "yes" : "NO"}   float targets: ${report.float ? "yes" : "no"}`);
for (const e of report.errors) console.log(`page error: ${e}`);

/** The values of a BC4 block as levels that need not be whole: blended in sevenths and fifths as the specification has it, or in 64ths. */
function exactBc4(blocks: Uint8Array, at: number, out: Float64Array, in64ths: boolean): void {
  const r0 = blocks[at]!;
  const r1 = blocks[at + 1]!;
  for (let t = 0; t < 16; t++) {
    let code = 0;
    for (let b = 0; b < 3; b++) code |= ((blocks[at + 2 + ((3 * t + b) >> 3)]! >> ((3 * t + b) & 7)) & 1) << b;
    const steps = r0 > r1 ? 7 : 5;
    if (code === 0) out[t] = r0;
    else if (code === 1) out[t] = r1;
    else if (code > steps) out[t] = code === 6 ? 0 : 255;
    else if (in64ths) out[t] = r0 + ((r1 - r0) * Math.round(((code - 1) * 64) / steps)) / 64;
    else out[t] = ((steps + 1 - code) * r0 + (code - 1) * r1) / steps;
  }
}

/** What follows a block's mode bits: the partition, or the rotation and the selection bit. */
const FIELD = [4, 6, 6, 6, 3, 2, 0, 6];

let failed = !report.ok || report.errors.length > 0 || !report.bptc || !report.rgtc;
const row = (name: string, text: string) => console.log(`  ${name.padEnd(38)} ${text}`);
console.log("\nThe GPU against our decoders. Differences are in levels of 255.");
const pins: number[] = [];
for (let i = 0; i < jobs.length; i++) {
  const j = jobs[i]!;
  const got = pixels[i];
  const bc5 = j.format === RED_GREEN_RGTC2;
  const across = (j.width + 3) >> 2;
  if (!got) {
    row(j.name, "NOT RUN");
    if (j.target !== "float") failed = true;
    continue;
  }
  if (j.target === "float") {
    // How the GPU blends, before anything rounds its values to bytes.
    const values = new Float32Array(got.buffer, got.byteOffset, got.byteLength / 4);
    const exact = new Float64Array(16);
    const worst = [0, 0];
    for (let b = 0; b < blockCount(j.width, j.height); b++) {
      for (let c = 0; c < 2; c++) {
        for (let model = 0; model < 2; model++) {
          exactBc4(j.blocks, b * 16 + c * 8, exact, model === 1);
          for (let t = 0; t < 16; t++) {
            const at = (((b / across) | 0) * 4 + (t >> 2)) * j.width + (b % across) * 4 + (t & 3);
            worst[model] = Math.max(worst[model]!, Math.abs(values[at * 4 + c]! * 255 - exact[t]!));
          }
        }
      }
    }
    row(j.name, `the GPU's values are within ${worst[0]!.toFixed(4)} of the specification's sevenths and fifths, and within ${worst[1]!.toFixed(4)} of the same blended in 64ths`);
    continue;
  }
  const ours = bc5 ? decodeBc5(j.blocks, j.width, j.height) : decodeBc7(j.blocks, j.width, j.height);
  if (j.pin) pins.push(hashBytes(got));
  // The worst difference for each mode that occurs, and how many values its partition or rotation field took.
  const worst = new Int32Array(9).fill(-1);
  const count = new Int32Array(9);
  const fields = Array.from({ length: 9 }, () => new Set<number>());
  for (let y = 0; y < j.height; y++) {
    for (let x = 0; x < j.width; x++) {
      const b = (y >> 2) * across + (x >> 2);
      const mode = bc5 ? 0 : bc7Mode(j.blocks, b * 16);
      const at = (y * j.width + x) * 4;
      let d = 0;
      for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(got[at + c]! - ours[at + c]!));
      if (d > worst[mode]!) worst[mode] = d;
      if ((x & 3) !== 0 || (y & 3) !== 0) continue;
      count[mode]!++;
      if (!bc5 && mode < 8) fields[mode]!.add(((j.blocks[b * 16]! | (j.blocks[b * 16 + 1]! << 8)) >> (mode + 1)) & ((1 << FIELD[mode]!) - 1));
    }
  }
  // BC7 is exact by its specification. BC5 is rounded to a byte by the GPU and by us from values that may differ a
  // little, as the float line shows; a wrong layout would be out by far more.
  const allowed = bc5 ? 2 : 0;
  const cells: string[] = [];
  for (let mode = 0; mode < 9; mode++) {
    if (count[mode] === 0) continue;
    if (worst[mode]! > allowed) failed = true;
    const field = !bc5 && !j.source && !j.pin && FIELD[mode]! > 0 ? `, ${fields[mode]!.size} of ${1 << FIELD[mode]!} ${mode === 4 || mode === 5 ? "rotations and selections" : "partitions"}` : "";
    cells.push(`${bc5 ? "" : `mode ${mode}: `}${count[mode]} blocks${field}, worst ${worst[mode]}`);
  }
  let text = cells.join("; ");
  if (j.source) {
    text += `  |  ${decibels(j.source, got, Math.min(3, j.channels!)).toFixed(2)} dB in ${j.channels === 2 ? "red and green" : "rgb"}`;
    if (j.channels === 4) text += `, ${decibels(j.source, got, 4).toFixed(2)} dB in rgba`;
    if (j.seconds !== undefined && j.width >= 512) text += `, ${(j.seconds / ((j.width * j.height) / 1e6)).toFixed(2)} s per megapixel`;
  }
  row(j.name, text);
}
console.log(`\nhashes of what the GPU drew for the first job of each mode, as tests/unit/bc.test.ts pins them:\n  [${pins.join(", ")}]`);
console.log(failed ? "\nbc-gpu: FAIL" : "\nbc-gpu: PASS");
process.exit(failed ? 1 : 0);
