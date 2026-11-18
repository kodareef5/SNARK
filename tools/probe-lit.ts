// `bun run probe -- --lit`: the frames core builds at the lit tiers, drawn by the shell's renderer (client/shell/gl.ts)
// in headless Chrome and held to the software rasterizer and to what each check knows of them. A check is a file under
// tools/probe-lit/ and a line in CHECKS. It makes its shots in Bun (tools/probe-lit/shot.ts): frames as core built
// them, over a ground and from a pack of its own, some marked to be read back. The page draws every frame of every shot
// in turn on a canvas of the shot's size, reads back the marked ones, and says what the device is; then each check
// judges what came back.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Heightfield } from "../shared/world/heightfield.ts";
import { depthCheck } from "./probe-lit/depth.ts";
import { cityCheck } from "./probe-lit/city.ts";
import { detailsCheck } from "./probe-lit/details.ts";
import { rotorCheck } from "./probe-lit/rotor.ts";
import { farCheck } from "./probe-lit/far.ts";
import { farShadowCheck } from "./probe-lit/farshadow.ts";
import { layersCheck } from "./probe-lit/layers.ts";
import { litCheck } from "./probe-lit/lit.ts";
import { nodesCheck } from "./probe-lit/nodes.ts";
import { seamsCheck } from "./probe-lit/seams.ts";
import { shadowCheck } from "./probe-lit/shadow.ts";
import { Shot, topFirst, type Device, type LitCheck, type RawShot, type Readback } from "./probe-lit/shot.ts";
import { facadeCheck } from "./probe-lit/facade.ts";
import { skyCheck } from "./probe-lit/sky.ts";
import { skyOpenCheck } from "./probe-lit/skyopen.ts";
import { standCheck } from "./probe-lit/stand.ts";
import { terrainCheck } from "./probe-lit/terrain.ts";
import { waterCheck } from "./probe-lit/water.ts";

const ROOT = resolve(import.meta.dir, "..");

/** Every check, in the order the page draws them. */
const CHECKS: readonly LitCheck[] = [depthCheck, litCheck, terrainCheck, seamsCheck, farCheck, cityCheck, skyCheck, shadowCheck, farShadowCheck, skyOpenCheck, nodesCheck, waterCheck, layersCheck, standCheck, detailsCheck, rotorCheck, facadeCheck];

const PAGE = `<!doctype html><meta charset="utf-8"><title>lit probe</title><body><script type="module">
const load = (name) => import("/m/" + name + ".js");
const { GlRenderer } = await load("gl");
const { FramePacket } = await load("packet");
const { parsePack } = await load("pack");
const { describePack } = await load("manifest");
const { Heightfield } = await load("heightfield");
const { tierOf } = await load("tiers");

const get = async (path) => (await fetch(path)).json();
const bytes = async (path) => new Uint8Array(await (await fetch(path)).arrayBuffer());
const post = (path, body) => fetch(path, { method: "POST", body });
const errors = [];
const packs = new Map();
const grounds = new Map();

async function packOf(id) {
  if (!packs.has(id)) packs.set(id, parsePack(await bytes("/pack/" + id)));
  return packs.get(id);
}

async function groundOf(id) {
  if (!grounds.has(id)) {
    const g = await get("/ground/" + id);
    const b = await bytes("/ground/" + id + ".bin");
    grounds.set(id, new Heightfield(g.dims, g.cell, g.minY, g.stepY, new Uint16Array(b.buffer, 0, g.n), new Uint8Array(b.buffer, g.n * 2, g.n)));
  }
  return grounds.get(id);
}

function unpack(p, f, blob) {
  p.beginFrame();
  for (const [name, value] of Object.entries(f.scalars)) if (name === "tier") p.tier = tierOf(value); else p[name] = value;
  // An array longer than the packet's own, as the far shadow's rows are, is taken as it comes.
  for (const [name, at, n] of f.arrays) if (n > p[name].length) p[name] = new p[name].constructor(blob.buffer, at, n); else p[name].set(new p[name].constructor(blob.buffer, at, n));
  const data = ([at, n]) => blob.subarray(at, at + n);
  for (const [buffer, at, n] of f.uploads) p.uploads.push({ buffer, data: data([at, n]), slots: new Uint16Array(0) });
  for (const u of f.assetUploads) p.assetUploads.push({ ...u, data: data(u.data) });
  for (const u of f.texUploads) p.texUploads.push({ ...u, data: data(u.data) });
  p.drops.push(...f.drops);
  p.assetDrops.push(...f.assetDrops);
  p.texDrops.push(...f.texDrops);
}

function lose(r) {
  return new Promise((resolve) => {
    const canvas = r.gl.canvas;
    const lost = r.gl.getExtension("WEBGL_lose_context");
    canvas.addEventListener("webglcontextlost", (e) => (e.preventDefault(), setTimeout(() => lost.restoreContext(), 0)), { once: true });
    canvas.addEventListener("webglcontextrestored", () => (r.init(), resolve()), { once: true });
    lost.loseContext();
  });
}

try {
  let told = false;
  for (const s of await get("/shots")) {
    const pack = await packOf(s.pack);
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = [s.width, s.height];
    const manifest = s.manifest ? await get("/manifest/" + s.key) : describePack(pack, { name: "", bytes: pack.blobAt + pack.blob.length });
    const r = new GlRenderer(canvas, pack, await groundOf(s.ground), manifest);
    const gl = r.gl;
    if (!told) {
      told = true;
      const size = gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.DEPTH, gl.FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE);
      await post("/device", JSON.stringify({ renderer: r.rendererName, depthBits: gl.getParameter(gl.DEPTH_BITS), depthSize: size, antialias: gl.getContextAttributes().antialias, samples: gl.getParameter(gl.SAMPLES), shadowLookup: r.shadowLookup }));
    }
    // A shot may have the renderer take compared lookups as another device gives them: its programs are made again.
    if (s.lookup) {
      r.shadowLookup = s.lookup;
      r.programs.clear();
      r.current = r.warmed = null;
    }
    const frames = await get("/shot/" + s.key);
    const blob = await bytes("/shot/" + s.key + ".bin");
    const p = new FramePacket();
    for (let k = 0; k < frames.length; k++) {
      if (k === s.loseAt) await lose(r);
      unpack(p, frames[k], blob);
      r.draw(p);
      if (!s.read.includes(k)) continue;
      const px = new Uint8Array(s.width * s.height * 4);
      gl.readPixels(0, 0, s.width, s.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      await post("/pixels/" + s.key + "/" + k, px);
    }
    const error = gl.getError();
    if (r.errors > 0 || r.failed.length > 0 || error !== 0) errors.push(s.key + ": " + r.errors + " frames the GL refused, " + r.failed.length + " levels it had no room for, error " + error);
    gl.getExtension("WEBGL_lose_context").loseContext();
  }
  // A check's own programs, each a list of triangles drawn once with its attributes, uniforms and textures, and read back.
  for (const s of await get("/raws")) {
    const spec = await get("/raw/" + s.key);
    const blob = await bytes("/raw/" + s.key + ".bin");
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = [spec.width, spec.height];
    const gl = canvas.getContext("webgl2", { antialias: false });
    if (!told) {
      told = true;
      await post("/device", JSON.stringify({ renderer: gl.getParameter(gl.RENDERER), depthBits: gl.getParameter(gl.DEPTH_BITS), depthSize: 0, antialias: false, samples: 0, shadowLookup: "" }));
    }
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, spec.vertex], [gl.FRAGMENT_SHADER, spec.fragment]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) errors.push(s.key + ": " + gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) errors.push(s.key + ": " + gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const view = (at, n) => new Float32Array(blob.buffer, at, n / 4);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, view(spec.vertices[0], spec.vertices[1]), gl.STATIC_DRAW);
    const stride = spec.attributes.reduce((n, a) => n + a[1], 0) * 4;
    let offset = 0;
    for (const [name, size] of spec.attributes) {
      const at = gl.getAttribLocation(program, name);
      if (at >= 0) {
        gl.enableVertexAttribArray(at);
        gl.vertexAttribPointer(at, size, gl.FLOAT, false, stride, offset);
      }
      offset += size * 4;
    }
    for (const [name, values] of Object.entries(spec.uniforms)) {
      const at = gl.getUniformLocation(program, name);
      if (values.length === 16) gl.uniformMatrix4fv(at, false, values);
      else gl["uniform" + values.length + "fv"](at, values);
    }
    spec.textures.forEach((t, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      const [inner, format] = t.channels === 2 ? [gl.RG8, gl.RG] : t.srgb ? [gl.SRGB8_ALPHA8, gl.RGBA] : [gl.RGBA8, gl.RGBA];
      t.levels.forEach(([at, n], level) => {
        const side = t.size >> level;
        gl.texImage2D(gl.TEXTURE_2D, level, inner, side, side, 0, format, gl.UNSIGNED_BYTE, blob.subarray(at, at + n));
      });
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform1i(gl.getUniformLocation(program, t.name), unit);
    });
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, spec.vertices[1] / stride);
    const px = new Uint8Array(spec.width * spec.height * 4);
    gl.readPixels(0, 0, spec.width, spec.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    await post("/pixels/" + s.key + "/0", px);
    // A shot that asks to be timed is drawn that many times more, and the time until a pixel of the last can be read is told.
    if (spec.repeat > 0) {
      // Without depth, so no draw is passed over as hidden by the one before.
      gl.disable(gl.DEPTH_TEST);
      const t0 = performance.now();
      for (let k = 0; k < spec.repeat; k++) gl.drawArrays(gl.TRIANGLES, 0, spec.vertices[1] / stride);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      await post("/time/" + s.key, JSON.stringify(performance.now() - t0));
    }
    if (gl.getError() !== 0) errors.push(s.key + ": error " + gl.getError());
    gl.getExtension("WEBGL_lose_context").loseContext();
  }
} catch (e) {
  errors.push(String((e && e.stack) || e));
}
await post("/report", JSON.stringify({ errors }));
</script>`;

/** Its heights and then its tints, as the page makes a heightfield of them. */
function groundBytes(hf: Heightfield): Uint8Array {
  const out = new Uint8Array(hf.heights.byteLength + hf.tint.byteLength);
  out.set(new Uint8Array(hf.heights.buffer, hf.heights.byteOffset, hf.heights.byteLength));
  out.set(hf.tint, hf.heights.byteLength);
  return out;
}

/** Runs the checks' shots in Chrome, every check's unless `checks` says which, and judges them. True if everything passed. */
export async function litProbe(chrome: string, checks: readonly LitCheck[] = CHECKS): Promise<boolean> {
  const shots: Shot[] = [];
  for (const check of checks) {
    const t0 = performance.now();
    const made = await check.shots();
    shots.push(...made);
    console.log(`  ${check.name}: ${made.length} shots, ${made.reduce((n, s) => n + s.frames.length, 0)} frames, built in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  const raws: RawShot[] = [];
  for (const check of checks) raws.push(...((await check.raws?.()) ?? []));
  const packs = [...new Set(shots.map((s) => s.pack))];
  const grounds = [...new Set(shots.map((s) => s.ground))];
  const modules = await Bun.build({ entrypoints: ["client/shell/gl.ts", "client/core/render/packet.ts", "shared/pack/pack.ts", "shared/pack/manifest.ts", "shared/world/heightfield.ts", "client/core/assets/tiers.ts"].map((f) => join(ROOT, f)), target: "browser", splitting: true, format: "esm", naming: "[name].[ext]" });
  if (!modules.success) throw new Error(modules.logs.map(String).join("\n"));
  const served = new Map<string, Blob>(modules.outputs.map((o) => [`/m/${o.path.slice(2)}`, o]));
  const pixels = new Map<string, Uint8Array>();
  const times = new Map<string, number>();
  let device: Device | null = null;
  let finish: (r: { errors: string[] }) => void = () => {};
  const finished = new Promise<{ errors: string[] }>((r) => (finish = r));
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const body = req.method === "POST" ? new Uint8Array(await req.arrayBuffer()) : null;
      const [, kind, name = "", frame] = path.split("/");
      const id = name.replace(".bin", "");
      const shot = shots.find((s) => s.key === id) ?? raws.find((s) => s.key === id);
      const raw = raws.find((s) => s.key === id);
      if (path === "/raws") return Response.json(raws.map((s) => ({ key: s.key })));
      if (kind === "raw" && raw) return name.endsWith(".bin") ? new Response(raw.bytes()) : Response.json(raw.spec());
      if (path === "/") return new Response(PAGE, { headers: { "content-type": "text/html" } });
      if (served.has(path)) return new Response(served.get(path)!, { headers: { "content-type": "text/javascript" } });
      if (path === "/shots") return Response.json(shots.map((s) => ({ key: s.key, width: s.width, height: s.height, read: s.read, loseAt: s.loseAt, lookup: s.lookup, manifest: s.manifest !== null, pack: packs.indexOf(s.pack), ground: grounds.indexOf(s.ground) })));
      if (kind === "pack") return new Response(packs[Number(id)]);
      if (kind === "ground") {
        const hf = grounds[Number(id)]!;
        return name.endsWith(".bin") ? new Response(groundBytes(hf)) : Response.json({ dims: hf.dims, cell: hf.cell, minY: hf.minY, stepY: hf.stepY, n: hf.nx * hf.nz });
      }
      if (kind === "shot" && shot instanceof Shot) return name.endsWith(".bin") ? new Response(shot.bytes()) : Response.json(shot.frames);
      if (kind === "manifest" && shot instanceof Shot) return Response.json(shot.manifest);
      if (kind === "pixels" && shot) pixels.set(`${shot.key}/${frame}`, topFirst(body!, shot.width, shot.height));
      else if (kind === "time" && raw) times.set(raw.key, JSON.parse(new TextDecoder().decode(body!)) as number);
      else if (kind === "device") device = JSON.parse(new TextDecoder().decode(body!)) as Device;
      else if (kind === "report") finish(JSON.parse(new TextDecoder().decode(body!)) as { errors: string[] });
      else return new Response("not found", { status: 404 });
      return new Response("ok");
    },
  });

  const profile = mkdtempSync(join(tmpdir(), "snark-probe-"));
  const browser = Bun.spawn([chrome, "--headless=new", "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1280,720", `--user-data-dir=${profile}`, `http://localhost:${server.port}/`], { stdout: "ignore", stderr: "ignore" });
  const report = await Promise.race([finished, new Promise<null>((r) => setTimeout(() => r(null), 600000))]);
  browser.kill();
  await browser.exited;
  server.stop(true);
  rmSync(profile, { recursive: true, force: true });
  if (!report || !device) {
    console.error("probe: the lit page sent no report within ten minutes");
    return false;
  }
  const d = device as Device;
  console.log(`renderer: ${d.renderer}; a depth buffer of ${d.depthBits} bits (its attachment says ${d.depthSize}); antialias ${d.antialias}, ${d.samples} samples; compared lookups ${d.shadowLookup}`);
  for (const e of report.errors) console.log(`page error: ${e}`);
  let ok = report.errors.length === 0;
  const back: Readback = { pixels: (key, frame) => pixels.get(`${key}/${frame}`) ?? null, time: (key) => times.get(key) ?? null, device: d };
  for (const check of checks) {
    const j = check.judge(back);
    console.log(`\n${check.name}: ${j.ok ? "ok" : "FAIL"}`);
    for (const line of j.lines) console.log(`  ${line}`);
    ok &&= j.ok;
  }
  return ok;
}
