// The lit programs in Chrome, held to the software rasterizer (D264): the proving ground from its spawn point on the
// default tier at noon, in the morning, in the afterglow and at night, its frames replayed through the shell's
// renderer, against the rasterizer at points away from every edge (the dome among them). Then LIT and SURFACE drawn
// full screen against FLAT, in milliseconds a megapixel: the device probe's line for these programs, on this machine.
// Textured frames are held to the rasterizer by `--textured`, which draws its house on the lit tiers.
// Run: bun tools/probe-lit/lit.ts

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_BLEND, type FramePacket } from "../../client/core/render/packet.ts";
import { PICK_SKY, type Rasterizer } from "../snap/raster.ts";
import { provingView } from "../snap.ts";
import { buildCorePack } from "../pack/build.ts";
import { Bytes, packFrame, spread, type Frame, type Spread } from "../probe-textured.ts";

const ROOT = resolve(import.meta.dir, "../..");
const [W, H] = [640, 360];
/** The hours drawn: noon, the morning, the afterglow just after sunset, and the middle of the night. */
const HOURS = [12, 7.5, 18.3, 0];
/** A point is judged where the 9 by 9 pixels about it are one surface, or all dome, and the rasterizer's colour there changes by no more than this from a pixel to the next. */
const NEAR = 4;
const SMOOTH = 3;
/** Levels of 255 the GPU may be from the rasterizer: every point's 5 by 5 mean, and 99 points' pixels in 100. */
const TOLERANCE = { mean: 3, pixelP99: 3 };

interface Shot {
  hour: number;
  frames: Frame[];
  /** The rasterizer's picture and what is under each pixel, after the last frame. */
  color: Uint8ClampedArray;
  depth: Float32Array;
  pickKind: Uint8Array;
  pickId: Uint32Array;
  /** See-through draws, whose pixels are left out. */
  blended: boolean;
}

/** The frames of each hour, as the shell is sent them, and the rasterizer's picture of the last. */
function shots(out: Bytes): { shots: Shot[]; frame: Float32Array } {
  const view = provingView(W, H);
  view.cam.pitch = 0;
  view.scene.assets.tier = tierOf("medium");
  const list: Shot[] = [];
  let noon: Float32Array | null = null;
  for (const hour of HOURS) {
    view.scene.hour = hour;
    const frames: Frame[] = [];
    let p: FramePacket | null = null;
    for (let f = 0; f < 3; f++) {
      p = view.render();
      frames.push(packFrame(p, out));
    }
    if (hour === 12) noon = p!.frame.slice();
    const r: Rasterizer = view.raster;
    let blended = false;
    for (let d = 0; d < p!.drawCount; d++) blended ||= (p!.drawFlags[d]! & DRAW_BLEND) !== 0;
    list.push({ hour, frames, color: r.color.slice(), depth: r.depth.slice(), pickKind: r.pickKind.slice(), pickId: r.pickId.slice(), blended });
  }
  return { shots: list, frame: noon! };
}

/** The GPU's picture against the rasterizer's at points away from edges: the worst channel of the pixel, and of the 5 by 5 mean about it. */
function judge(shot: Shot, gpu: Uint8Array): { pixel: Spread; mean: Spread; dome: number; ok: boolean } {
  const { color, depth, pickKind, pickId } = shot;
  const at = (x: number, y: number, c: number): number => gpu[((H - 1 - y) * W + x) * 4 + c]!;
  const flat = (i: number): boolean => {
    const sky = pickKind[i] === PICK_SKY;
    const gx = sky ? 0 : (depth[i + 1]! - depth[i - 1]!) / 2;
    const gy = sky ? 0 : (depth[i + W]! - depth[i - W]!) / 2;
    const slack = (Math.abs(gx) + Math.abs(gy)) * 0.05 + 1e-7;
    for (let dy = -NEAR; dy <= NEAR; dy++) {
      for (let dx = -NEAR; dx <= NEAR; dx++) {
        const j = i + dy * W + dx;
        if (pickKind[j] !== pickKind[i] || pickId[j] !== pickId[i]) return false;
        if (!sky && Math.abs(depth[j]! - depth[i]! - dx * gx - dy * gy) > slack) return false;
        for (let c = 0; c < 3; c++) if (Math.abs(color[j * 4 + c]! - color[(j + 1) * 4 + c]!) > SMOOTH || Math.abs(color[j * 4 + c]! - color[(j + W) * 4 + c]!) > SMOOTH) return false;
      }
    }
    return true;
  };
  const pixel: number[] = [];
  const mean: number[] = [];
  let dome = 0;
  for (let y = NEAR + 2; y < H - NEAR - 2; y += 3) {
    for (let x = NEAR + 2; x < W - NEAR - 2; x += 3) {
      const i = y * W + x;
      if (!flat(i)) continue;
      if (pickKind[i] === PICK_SKY) dome++;
      let most = 0;
      let mostMean = 0;
      for (let c = 0; c < 3; c++) {
        most = Math.max(most, Math.abs(at(x, y, c) - color[i * 4 + c]!));
        let sum = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sum += at(x + dx, y + dy, c) - color[(i + dy * W + dx) * 4 + c]!;
        mostMean = Math.max(mostMean, Math.abs(sum / 25));
      }
      pixel.push(most);
      mean.push(mostMean);
    }
  }
  const [p, m] = [spread(pixel), spread(mean)];
  return { pixel: p, mean: m, dome, ok: p.points >= 500 && m.worst <= TOLERANCE.mean && p.p99 <= TOLERANCE.pixelP99 };
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>lit probe</title><body><script type="module">
const load = (name) => import("/m/" + name + ".js");
const { GlRenderer } = await load("gl");
const { FramePacket } = await load("packet");
const { parsePack } = await load("pack");
const { buildProvingHeightfield } = await load("proving");
const { PROGRAMS, UNIT } = await load("programs");
const { tierOf } = await load("tiers");
const { theSky, SKY_SIZE } = await load("sky");
const get = async (path) => (await fetch(path)).json();
const bytes = async (path) => new Uint8Array(await (await fetch(path)).arrayBuffer());
const post = (path, body) => fetch(path, { method: "POST", body });
const errors = [];

function unpack(p, f, blob) {
  p.beginFrame();
  Object.assign(p, f.scalars);
  for (const [name, at, n] of f.arrays) p[name].set(new p[name].constructor(blob.buffer, at, n));
  const data = ([at, n]) => blob.subarray(at, at + n);
  for (const [buffer, at, n] of f.uploads) p.uploads.push({ buffer, data: data([at, n]), slots: new Uint16Array(0) });
  for (const u of f.assetUploads) p.assetUploads.push({ ...u, data: data(u.data) });
  p.drops.push(...f.drops);
  p.assetDrops.push(...f.assetDrops);
}

async function scenes() {
  const job = await get("/shots");
  const blob = await bytes("/shots.bin");
  const pack = parsePack(await bytes("/pack.bin"));
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = [${W}, ${H}];
  const r = new GlRenderer(canvas, pack, buildProvingHeightfield(), { materials: [], meshes: pack.header.meshes }, null);
  const p = new FramePacket();
  p.tier = tierOf("medium");
  for (const shot of job) {
    for (const f of shot.frames) {
      unpack(p, f, blob);
      r.draw(p);
    }
    const out = new Uint8Array(${W * H * 4});
    r.gl.readPixels(0, 0, ${W}, ${H}, r.gl.RGBA, r.gl.UNSIGNED_BYTE, out);
    const error = r.gl.getError();
    if (r.errors > 0 || error !== 0) errors.push("hour " + shot.hour + ": " + r.errors + " frames the GL refused uploads of, and error " + error);
    await post("/shot/" + shot.hour, out);
  }
  r.gl.getExtension("WEBGL_lose_context").loseContext();
}

/** A full-screen triangle a wall 5 m ahead, with what each fragment text takes from its vertex text. */
const FLAT_VS = "#version 300 es\\nout vec3 vRel;\\nflat out vec3 vColor;\\nvoid main() {\\n  vec2 at = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;\\n  vRel = vec3(at.x * 3.0, at.y * 2.0 - 0.5, 5.0);\\n  vColor = vec3(0.6, 0.4, 0.3);\\n  gl_Position = vec4(at, 0.5, 1.0);\\n}";
const SURFACE_VS = "#version 300 es\\nout vec3 vRel, vNormal;\\nout vec4 vTangent;\\nout vec2 vUv;\\nflat out mat3 vDye, vDye2;\\nvoid main() {\\n  vec2 at = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;\\n  vRel = vec3(at.x * 3.0, at.y * 2.0 - 0.5, 5.0);\\n  vNormal = vec3(0.0, 0.0, -1.0);\\n  vTangent = vec4(1.0, 0.0, 0.0, 1.0);\\n  vUv = at * 4.0;\\n  vDye = mat3(1.0);\\n  vDye2 = mat3(1.0);\\n  gl_Position = vec4(at, 0.5, 1.0);\\n}";

async function timing() {
  const frame = new Float32Array(await (await fetch("/frame.bin")).arrayBuffer());
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = [1024, 1024];
  const gl = canvas.getContext("webgl2", { antialias: false });
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const link = (vs, text) => {
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, text.fragment.replace("\\n", "\\n" + text.defines)]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(program, s);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    for (const name in text.samplers) gl.uniform1i(gl.getUniformLocation(program, name), text.samplers[name]);
    const block = gl.getUniformBlockIndex(program, "Frame");
    if (block !== gl.INVALID_INDEX) gl.uniformBlockBinding(program, block, 0);
    const u = (name) => gl.getUniformLocation(program, name);
    gl.uniform3f(u("uSun"), 0, 0.92, 0.39);
    gl.uniform3f(u("uSky"), 0.6, 0.75, 0.9);
    gl.uniform3f(u("uCamMod"), 0.3, 0.2, 0.1);
    gl.uniform2f(u("uFog"), 1e6, 2e6);
    gl.uniform1f(u("uSolid"), 1);
    gl.uniform1f(u("uAlpha"), 1);
    gl.uniform1f(u("uLight"), 1);
    gl.uniform3f(u("uTint"), 1, 1, 1);
    gl.uniform1f(u("uCutoff"), 0);
    return program;
  };
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, gl.createBuffer());
  gl.bufferData(gl.UNIFORM_BUFFER, frame, gl.DYNAMIC_DRAW);
  // Five maps of noise, 256 square with their mips, a base colour as sRGB, and the sky table.
  for (let k = 0; k < 5; k++) {
    gl.activeTexture(gl.TEXTURE0 + UNIT.maps + k);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    const noise = Uint8Array.from({ length: 256 * 256 * 4 }, (_, i) => (i * 2654435761 + k * 97) >>> 24);
    gl.texImage2D(gl.TEXTURE_2D, 0, k === 0 ? gl.SRGB8_ALPHA8 : gl.RGBA8, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, noise);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }
  gl.activeTexture(gl.TEXTURE0 + UNIT.sky);
  gl.bindTexture(gl.TEXTURE_3D, gl.createTexture());
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, SKY_SIZE, SKY_SIZE, SKY_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, theSky().table);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.disable(gl.DEPTH_TEST);
  gl.viewport(0, 0, 1024, 1024);
  const one = new Uint8Array(4);
  const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
  const ms = async (program, n) => {
    gl.useProgram(program);
    for (let i = 0; i < 4; i++) gl.drawArrays(gl.TRIANGLES, 0, 3);
    finish();
    if (timer) {
      const q = gl.createQuery();
      gl.beginQuery(timer.TIME_ELAPSED_EXT, q);
      for (let i = 0; i < n; i++) gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      finish();
      for (let wait = 0; wait < 200 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); wait++) await new Promise((r) => setTimeout(r, 5));
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT) && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / n;
    }
    const t0 = performance.now();
    for (let i = 0; i < n; i++) gl.drawArrays(gl.TRIANGLES, 0, 3);
    finish();
    return (performance.now() - t0) / n;
  };
  const programs = {
    FLAT: link(FLAT_VS, PROGRAMS.flat(tierOf("lowpoly"), "rgba")),
    LIT: link(FLAT_VS, PROGRAMS.flat(tierOf("medium"), "rgba")),
    SURFACE: link(SURFACE_VS, PROGRAMS.surface(tierOf("medium"), "rgba")),
  };
  const megapixels = (1024 * 1024) / 1e6;
  const out = { timer: !!timer, renderer: String(gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)) };
  // Seven rounds, each program in a turned order, and the median of each.
  const names = Object.keys(programs);
  const times = Object.fromEntries(names.map((name) => [name, []]));
  for (let round = 0; round < 7; round++) {
    for (let k = 0; k < names.length; k++) {
      const name = names[(k + round) % names.length];
      times[name].push((await ms(programs[name], 100)) / megapixels);
    }
  }
  for (const name of names) out[name] = times[name].sort((a, b) => a - b)[3];
  await post("/timing", JSON.stringify(out));
}

try {
  await scenes();
  await timing();
} catch (e) {
  errors.push(String((e && e.stack) || e));
}
await post("/report", JSON.stringify({ errors }));
</script>`;

/** Runs the page in Chrome and judges what it sends. True if everything passed. */
export async function litProbe(chrome: string): Promise<boolean> {
  const blob = new Bytes();
  const { shots: list, frame } = shots(blob);
  const bytes = blob.join();
  const pack = buildCorePack();
  const modules = await Bun.build({ entrypoints: ["client/shell/gl.ts", "client/core/render/packet.ts", "shared/pack/pack.ts", "shared/world/proving.ts", "client/core/render/programs.ts", "client/core/assets/tiers.ts", "client/core/render/sky.ts"].map((f) => join(ROOT, f)), target: "browser", splitting: true, format: "esm", naming: "[name].[ext]" });
  if (!modules.success) throw new Error(modules.logs.map(String).join("\n"));
  const served = new Map<string, Blob>(modules.outputs.map((o) => [`/m/${o.path.slice(2)}`, o]));
  const got = new Map<number, Uint8Array>();
  let timing: Record<string, number | string | boolean> | null = null;
  let finish: (r: { errors: string[] }) => void = () => {};
  const finished = new Promise<{ errors: string[] }>((r) => (finish = r));
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const body = req.method === "POST" ? new Uint8Array(await req.arrayBuffer()) : null;
      if (path === "/") return new Response(PAGE, { headers: { "content-type": "text/html" } });
      if (served.has(path)) return new Response(served.get(path)!, { headers: { "content-type": "text/javascript" } });
      if (path === "/shots") return Response.json(list.map((s) => ({ hour: s.hour, frames: s.frames })));
      if (path === "/shots.bin") return new Response(bytes);
      if (path === "/pack.bin") return new Response(pack);
      if (path === "/frame.bin") return new Response(frame);
      if (path.startsWith("/shot/")) got.set(Number(path.slice(6)), body!);
      else if (path === "/timing") timing = JSON.parse(new TextDecoder().decode(body!));
      else if (path === "/report") finish(JSON.parse(new TextDecoder().decode(body!)));
      else return new Response("not found", { status: 404 });
      return new Response("ok");
    },
  });
  const profile = mkdtempSync(join(tmpdir(), "snark-probe-"));
  const browser = Bun.spawn([chrome, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1280,720", `--user-data-dir=${profile}`, `http://localhost:${server.port}/`], { stdout: "ignore", stderr: "ignore" });
  const report = await Promise.race([finished, new Promise<null>((r) => setTimeout(() => r(null), 300000))]);
  browser.kill();
  await browser.exited;
  server.stop(true);
  rmSync(profile, { recursive: true, force: true });
  if (!report) {
    console.error("probe: the lit page sent no report within five minutes");
    return false;
  }
  let ok = report.errors.length === 0;
  for (const e of report.errors) console.log(`page error: ${e}`);
  console.log(`The proving ground on medium against the rasterizer at points with one surface, or the dome, and no edge within ${NEAR} pixels: the worst channel, as a pixel and as the mean of the 5 by 5 about it.`);
  console.log(`Passes with every mean within ${TOLERANCE.mean} and pixels within ${TOLERANCE.pixelP99} at 99 in 100.`);
  for (const shot of list) {
    const gpu = got.get(shot.hour);
    if (!gpu) {
      console.log(`  ${String(shot.hour).padStart(5)} h: NO PICTURE`);
      ok = false;
      continue;
    }
    const j = judge(shot, gpu);
    ok &&= j.ok;
    console.log(`  ${String(shot.hour).padStart(5)} h: ${j.pixel.points} points (${j.dome} on the dome): pixels mean ${j.pixel.mean.toFixed(2)}, 99 in 100 within ${j.pixel.p99}, worst ${j.pixel.worst}; means worst ${j.mean.worst.toFixed(2)}  ${j.ok ? "ok" : "FAIL"}`);
  }
  if (timing) {
    const t = timing as Record<string, number | string | boolean>;
    const ms = (name: string): string => `${(t[name] as number).toFixed(3)} ms`;
    console.log(`\nFull screen on ${t.renderer}, ${t.timer ? "by timer query" : "by the clock"}, in ms a megapixel: FLAT ${ms("FLAT")}, LIT ${ms("LIT")}, SURFACE ${ms("SURFACE")}`);
  } else ok = false;
  return ok;
}

if (import.meta.main) {
  const chrome = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));
  if (!chrome) throw new Error("no Chrome found. Set CHROME to its path.");
  const passed = await litProbe(chrome);
  console.log(passed ? "\nprobe: PASS" : "\nprobe: FAIL");
  process.exit(passed ? 0 : 1);
}
