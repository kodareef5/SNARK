// The dome and the haze on a GPU (D265, D266), a check of tools/probe-lit.ts. On flat ground 4.6 km across, with
// castles drawn as far blocks 300 m, 1.3 km and 2 km off: the dome away from the sun and the moon is the table, within
// 4 steps of the rasterizer; the castles are the rasterizer's colour hazed as atmosphere.ts's twin says, within 4; and
// so is the land fading into the dome over the end of the view, seen from 1 km up. With PROBE_PICTURES naming a folder,
// it writes what the shell draws with the sky's pictures sent: each mood key's two views from the art director's
// cameras, the castles with clouds, and the castles and the horizon as checked.
//
// Run by itself, this file draws the sky program full screen in Chrome with the sky's pictures from their sources, as a
// player sees it toward the sun, away from it and straight up at the art director's hours, and writes the pictures; with
// SKY_TIME it measures the program full screen with 0, 1 and 2 layers, and LIT with and without haze, instead, blended, in
// ms a megapixel; with SKY_LAYER=high or low it draws that layer alone, straight up and 30 degrees up, as the wind
// blows; SKY_TOP sets how large the layers are sent, 1,024 as medium has them or 2,048 as high.
// Run: bun tools/probe-lit/sky.ts [folder] [hours]

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { SKY_MATERIAL, VIEW_FADE, airFrame, hazed } from "../../client/core/render/atmosphere.ts";
import { Camera, FAR_FROM } from "../../client/core/render/camera.ts";
import { FRAME, FRAME_FLOATS, type FramePacket } from "../../client/core/render/packet.ts";
import { PROGRAMS, UNIT } from "../../client/core/render/programs.ts";
import { SKY_SIZE, SKY_SLICES, hourOfSun, shownSky, skyFrame, theSky, trueSun } from "../../client/core/render/sky.ts";
import { KNEE, srgbToLinear } from "../../client/core/render/surface.ts";
import { describePack } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { RGBA_TOP } from "../../shared/pack/texture.ts";
import { castle, farWorld, type FarWorld } from "../../tests/fixtures/farworld.ts";
import { buildCorePack } from "../pack/build.ts";
import { baseMips, packedMips, readPicture } from "../pack/image.ts";
import { PICK_FAR, PICK_SKY, PICK_TERRAIN } from "../snap/raster.ts";
import { encodePng } from "../snap/png.ts";
import { Found } from "../../shared/world/structures.ts";
import { EYE, KEYS } from "../sky/base.ts";
import { provingView } from "../snap.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const ROOT = resolve(import.meta.dir, "../..");
const SKY = join(ROOT, "assets/source/core/sky");

/** A view: its frame block, its view-projection and its size. */
export interface View {
  name: string;
  frame: Float32Array;
  matrix: Float32Array;
  width: number;
  height: number;
}

/** The hours drawn, by the art director's names: the moon's is midnight, with the moon overhead. */
export const HOURS: Record<string, number> = { noon: 12, golden: hourOfSun(8, true), sunset: hourOfSun(0, true), dusk: hourOfSun(-8, true), moon: 0 };

/** A frame block for an hour, the camera `eye` metres over the sea, at x and z, with the clouds blown for `seconds`. */
export function frameAt(hour: number, eye = 10, seconds = 0, x = 0, z = 0): Float32Array {
  const frame = new Float32Array(FRAME_FLOATS);
  skyFrame(hour, theSky(), frame);
  airFrame(frame, theSky(), hour, x, z, seconds, 4000, 2, false);
  frame[FRAME.eyeHeight] = eye;
  return frame;
}

/** The view-projection of a camera at the origin looking `yaw` and `pitch`, in radians, 102 degrees across. */
export function look(yaw: number, pitch: number, aspect = 16 / 9): Float32Array {
  const cam = new Camera();
  [cam.yaw, cam.pitch, cam.aspect] = [yaw, pitch, aspect];
  cam.update();
  return Float32Array.from(cam.viewProj);
}

/**
 * Toward the sun (or the moon, at night) and away from it, 14 degrees up as light.py looks; straight up; and toward
 * and away again 4 degrees up, as a player on the ground mostly looks.
 */
export function playerViews(name: string, hour: number, width = 1280, height = 720): View[] {
  const frame = frameAt(hour);
  const s = [0, 0, 0];
  trueSun(frame, s);
  if (name === "moon") for (let k = 0; k < 3; k++) s[k] = -s[k]!;
  const yaw = Math.atan2(s[0]!, s[2]!);
  const [up, level] = [(14 * Math.PI) / 180, (4 * Math.PI) / 180];
  return [
    { name: `${name}-toward`, frame, matrix: look(yaw, up), width, height },
    { name: `${name}-away`, frame, matrix: look(yaw + Math.PI, up), width, height },
    { name: `${name}-up`, frame, matrix: look(yaw, Math.PI / 2 - 1e-4), width, height },
    { name: `${name}-level-toward`, frame, matrix: look(yaw, level), width, height },
    { name: `${name}-level-away`, frame, matrix: look(yaw + Math.PI, level), width, height },
    { name: `${name}-disc`, frame, matrix: look(yaw, Math.asin(s[1]!)), width, height },
  ];
}

/** The sky material's pictures as RGBA8, every mip smallest first, the layers' up to `top` pixels across: 1,024 as medium has them, 2,048 as high. */
export function skyPictures(top = 1024): { moon: Uint8Array[]; low: Uint8Array[]; high: Uint8Array[] } {
  const steps = Math.log2(top) + 1;
  return {
    moon: baseMips(readPicture(join(SKY, "moon/moon.png"))),
    low: process.env.SKY_LAYER === "high" ? [new Uint8Array(4)] : packedMips(readPicture(join(SKY, "clouds/low.png"))).slice(0, steps),
    high: process.env.SKY_LAYER === "low" ? [new Uint8Array(4)] : packedMips(readPicture(join(SKY, "clouds/high.png"))).slice(0, steps),
  };
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>sky</title><body><script type="module">
const get = async (path) => (await fetch(path)).json();
const bytes = async (path) => new Uint8Array(await (await fetch(path)).arrayBuffer());
const post = (path, body) => fetch(path, { method: "POST", body });
try {
  const views = await get("/views");
  const { text, UNIT, SKY_SIZE, SKY_SLICES } = await get("/program");
  const table = await bytes("/table");
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { antialias: false });
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, text.vertex], [gl.FRAGMENT_SHADER, text.fragment]]) {
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
  gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, "Frame"), 0);
  const block = gl.createBuffer();
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, block);
  gl.activeTexture(gl.TEXTURE0 + UNIT.sky);
  gl.bindTexture(gl.TEXTURE_3D, gl.createTexture());
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, SKY_SIZE, SKY_SIZE, SKY_SLICES, 0, gl.RGBA, gl.UNSIGNED_BYTE, table);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  // The moon on the base colour's unit as sRGB, the layers on the masks' as they are, every mip.
  for (const [name, unit, internal] of [["moon", UNIT.maps, gl.SRGB8_ALPHA8], ["low", UNIT.maps + 3, gl.RGBA8], ["high", UNIT.maps + 4, gl.RGBA8]]) {
    const mips = await get("/mips/" + name);
    const blob = await bytes("/mips/" + name + ".bin");
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    const top = mips.length - 1;
    gl.texStorage2D(gl.TEXTURE_2D, mips.length, internal, 1 << top, 1 << top);
    let at = 0;
    for (let k = 0; k < mips.length; k++) {
      const size = 1 << k;
      gl.texSubImage2D(gl.TEXTURE_2D, top - k, 0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, blob.subarray(at, at + size * size * 4));
      at += size * size * 4;
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }
  gl.disable(gl.DEPTH_TEST);
  for (let i = 0; i < views.length; i++) {
    const v = views[i];
    [canvas.width, canvas.height] = [v.width, v.height];
    gl.viewport(0, 0, v.width, v.height);
    gl.bufferData(gl.UNIFORM_BUFFER, new Float32Array(v.frame), gl.DYNAMIC_DRAW);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, "uViewProj"), false, v.matrix);
    gl.uniform3f(gl.getUniformLocation(program, "uSky"), 0.6, 0.75, 0.9);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(v.width * v.height * 4);
    gl.readPixels(0, 0, v.width, v.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    await post("/pixels/" + i, px);
  }
  await post("/done", "{}");
} catch (e) {
  await post("/done", JSON.stringify({ error: String((e && e.stack) || e) }));
}
</script>`;

/**
 * The timing page: each program full screen on a canvas 1,024 square, blended so that a tiled GPU shades every pixel
 * of every draw, by timer query where there is one, else by the clock; seven rounds in a turned order, the median.
 */
const TIME_PAGE = `<!doctype html><meta charset="utf-8"><title>sky timing</title><body><script type="module">
const get = async (path) => (await fetch(path)).json();
const bytes = async (path) => new Uint8Array(await (await fetch(path)).arrayBuffer());
const post = (path, body) => fetch(path, { method: "POST", body });
try {
  const { runs, UNIT, SKY_SIZE, SKY_SLICES } = await get("/runs");
  const table = await bytes("/table");
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = [1024, 1024];
  const gl = canvas.getContext("webgl2", { antialias: false });
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, gl.createBuffer());
  gl.activeTexture(gl.TEXTURE0 + UNIT.sky);
  gl.bindTexture(gl.TEXTURE_3D, gl.createTexture());
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, SKY_SIZE, SKY_SIZE, SKY_SLICES, 0, gl.RGBA, gl.UNSIGNED_BYTE, table);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  for (const [name, unit, internal] of [["moon", UNIT.maps, gl.SRGB8_ALPHA8], ["low", UNIT.maps + 3, gl.RGBA8], ["high", UNIT.maps + 4, gl.RGBA8]]) {
    const mips = await get("/mips/" + name);
    const blob = await bytes("/mips/" + name + ".bin");
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    const top = mips.length - 1;
    gl.texStorage2D(gl.TEXTURE_2D, mips.length, internal, 1 << top, 1 << top);
    let at = 0;
    for (let k = 0; k < mips.length; k++) {
      gl.texSubImage2D(gl.TEXTURE_2D, top - k, 0, 0, 1 << k, 1 << k, gl.RGBA, gl.UNSIGNED_BYTE, blob.subarray(at, at + 4 << (2 * k)));
      at += 4 << (2 * k);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }
  const programs = runs.map((r) => {
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, r.vertex], [gl.FRAGMENT_SHADER, r.fragment]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(r.name + ": " + gl.getShaderInfoLog(s));
      gl.attachShader(program, s);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    for (const name in r.samplers) gl.uniform1i(gl.getUniformLocation(program, name), r.samplers[name]);
    gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, "Frame"), 0);
    const u = (name) => gl.getUniformLocation(program, name);
    gl.uniformMatrix4fv(u("uViewProj"), false, r.matrix);
    gl.uniform3f(u("uSky"), 0.6, 0.75, 0.9);
    gl.uniform3f(u("uCamMod"), 0.3, 0.2, 0.1);
    gl.uniform2f(u("uFog"), 1e6, 2e6);
    for (const name of ["uSolid", "uAlpha"]) gl.uniform1f(u(name), 1);
    return { program, frame: new Float32Array(r.frame) };
  });
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.viewport(0, 0, 1024, 1024);
  const one = new Uint8Array(4);
  const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
  const ms = async (p, n) => {
    gl.useProgram(p.program);
    gl.bufferData(gl.UNIFORM_BUFFER, p.frame, gl.DYNAMIC_DRAW);
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
  const times = runs.map(() => []);
  for (let round = 0; round < 7; round++) {
    for (let k = 0; k < runs.length; k++) {
      const i = (k + round) % runs.length;
      times[i].push((await ms(programs[i], 60)) / ((1024 * 1024) / 1e6));
    }
  }
  const out = { timer: !!timer, renderer: String(gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)) };
  runs.forEach((r, i) => (out[r.name] = times[i].sort((a, b) => a - b)[3]));
  await post("/done", JSON.stringify(out));
} catch (e) {
  await post("/done", JSON.stringify({ error: String((e && e.stack) || e) }));
}
</script>`;

/** What the timing page draws: the sky with 0, 1 and 2 layers and LIT with and without haze, noon's frame block, the sky looking 14 degrees up toward the sun. */
function timingRuns(): Record<string, unknown>[] {
  const frame = (layers: number, plain: boolean): number[] => {
    const f = new Float32Array(FRAME_FLOATS);
    skyFrame(16, theSky(), f);
    airFrame(f, theSky(), 16, 0, 0, 0, 4000, layers, plain);
    f[FRAME.eyeHeight] = 10;
    return [...f];
  };
  const sky = PROGRAMS.sky!(tierOf("medium"), "rgba");
  const s = [0, 0, 0];
  trueSun(new Float32Array(frame(2, false)), s);
  const matrix = [...look(Math.atan2(s[0]!, s[2]!), (14 * Math.PI) / 180, 1)];
  // A wall full screen for LIT, 5 m ahead as the lit check's timing page has it, and 500 m, where it is hazed.
  const flatVertex = (metres: number): string => `#version 300 es\nout vec3 vRel;\nflat out vec3 vColor;\nvoid main() {\n  vec2 at = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;\n  vRel = vec3(at.x * 3.0, at.y * 2.0 - 0.5, 5.0) * ${metres / 5}.0;\n  gl_Position = vec4(at, 0.5, 1.0);\n  vColor = vec3(0.6, 0.4, 0.3);\n}`;
  const lit = PROGRAMS.flat!(tierOf("medium"), "rgba");
  const flat = (name: string, metres: number, plain: boolean): Record<string, unknown> => ({ name, vertex: flatVertex(metres), fragment: lit.fragment, samplers: lit.samplers, frame: frame(0, plain), matrix });
  return [
    { name: "SKY, no layer", ...sky, frame: frame(0, false), matrix },
    { name: "SKY, 1 layer", ...sky, frame: frame(1, false), matrix },
    { name: "SKY, 2 layers", ...sky, frame: frame(2, false), matrix },
    { name: "SKY, the table alone", ...sky, frame: frame(0, true), matrix },
    flat("LIT, no haze", 5, true),
    flat("LIT, haze, 5 m", 5, false),
    flat("LIT, haze, 500 m", 500, false),
    flat("LIT, haze, 3.5 km", 3500, false),
  ];
}

/** The sky and LIT full screen in Chrome, blended, in ms a megapixel. */
export async function timeSky(chrome: string): Promise<Record<string, number | string | boolean>> {
  const pictures = skyPictures();
  const runs = timingRuns();
  let finish: (r: Record<string, number | string | boolean>) => void = () => {};
  const finished = new Promise<Record<string, number | string | boolean>>((r) => (finish = r));
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const [, kind, name = ""] = path.split("/");
      if (path === "/") return new Response(TIME_PAGE, { headers: { "content-type": "text/html" } });
      if (path === "/runs") return Response.json({ runs, UNIT, SKY_SIZE, SKY_SLICES });
      if (path === "/table") return new Response(theSky().table);
      if (kind === "mips") {
        const key = name.replace(".bin", "") as keyof typeof pictures;
        return name.endsWith(".bin") ? new Response(Buffer.concat(pictures[key])) : Response.json(pictures[key].map((m) => m.length));
      }
      if (path === "/done") finish(JSON.parse(await req.text()));
      return new Response("ok");
    },
  });
  const profile = mkdtempSync(join(tmpdir(), "snark-probe-"));
  const browser = Bun.spawn([chrome, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--user-data-dir=${profile}`, `http://localhost:${server.port}/`], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  const done = await Promise.race([finished, new Promise<Record<string, string>>((r) => setTimeout(() => r({ error: "the page sent nothing within five minutes" }), 300000))]);
  browser.kill();
  await browser.exited;
  server.stop(true);
  rmSync(profile, { recursive: true, force: true });
  if (done.error) throw new Error(String(done.error));
  return done;
}

/** Draws `views` with the sky program in Chrome and gives back each one's pixels, top row first. */
export async function drawSky(chrome: string, views: readonly View[], top = 1024): Promise<Uint8Array[]> {
  const pictures = skyPictures(top);
  const mips = (name: keyof typeof pictures): Uint8Array => Buffer.concat(pictures[name]);
  const program = { text: PROGRAMS.sky!(tierOf("medium"), "rgba"), UNIT, SKY_SIZE, SKY_SLICES };
  const out: Uint8Array[] = [];
  let finish: (r: { error?: string }) => void = () => {};
  const finished = new Promise<{ error?: string }>((r) => (finish = r));
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const [, kind, name = ""] = path.split("/");
      if (path === "/") return new Response(PAGE, { headers: { "content-type": "text/html" } });
      if (path === "/program") return Response.json(program);
      if (path === "/table") return new Response(theSky().table);
      if (path === "/views") return Response.json(views.map((v) => ({ width: v.width, height: v.height, frame: [...v.frame], matrix: [...v.matrix] })));
      if (kind === "mips") {
        const key = name.replace(".bin", "") as keyof typeof pictures;
        return name.endsWith(".bin") ? new Response(mips(key)) : Response.json(pictures[key].map((m) => m.length));
      }
      if (kind === "pixels") {
        const v = views[Number(name)]!;
        const px = new Uint8Array(await req.arrayBuffer());
        const top = new Uint8Array(px.length);
        const row = v.width * 4;
        for (let y = 0; y < v.height; y++) top.set(px.subarray((v.height - 1 - y) * row, (v.height - y) * row), y * row);
        out[Number(name)] = top;
        return new Response("ok");
      }
      if (path === "/done") finish(JSON.parse(await req.text()));
      return new Response("ok");
    },
  });
  const profile = mkdtempSync(join(tmpdir(), "snark-probe-"));
  const browser = Bun.spawn([chrome, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--user-data-dir=${profile}`, `http://localhost:${server.port}/`], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  const done = await Promise.race([finished, new Promise<{ error: string }>((r) => setTimeout(() => r({ error: "the page sent nothing within five minutes" }), 300000))]);
  browser.kill();
  await browser.exited;
  server.stop(true);
  rmSync(profile, { recursive: true, force: true });
  if (done.error) throw new Error(done.error);
  return out;
}

// The check. Its pictures are 640 by 360, the camera 2 m over flat ground at the west edge of a map 72 chunks a side,
// looking east, where castles stand as far blocks.
const [W, H] = [640, 360];
const AT = { x: 64, z: 2304 };
const CASTLES = [300, 1300, 2000];
/** Steps of 255 the GPU may be from what the twins say: the table, the haze's formula, the dome at the view's end. */
const NEAR = 4;
/** Degrees from the sun and the moon inside which the dome is not held to the table: their discs and glows are the GPU's. */
const CLEAR_OF = 12;

/** The sky material's textures as the rgba variant sends them, in the frame given: every picture, as `fill` in the shell takes them. */
function sendPictures(p: FramePacket, pack: Uint8Array): void {
  const parsed = parsePack(pack);
  const manifest = describePack(parsed, { name: "", bytes: pack.length });
  const pictures = skyPictures(RGBA_TOP);
  const material = manifest.materials!.find((m) => m.id === SKY_MATERIAL)!;
  for (const [role, mips] of [["base", pictures.moon], ["mask", pictures.low], ["mask2", pictures.high]] as const) {
    const slot = material[role];
    const top = 1 << (mips.length - 1);
    mips.forEach((data, k) => p.texUploads.push({ slot, role, format: "rgba", top, size: 1 << k, row: 0, rows: 1 << k, data, last: k === mips.length - 1 }));
  }
}

/** The rasterizer's picture of a frame, and the frame block and camera it was drawn with. */
interface Held {
  key: string;
  frame: number;
  name: string;
  color: Uint8Array;
  kind: Uint8Array;
  depth: Float32Array;
  block: Float32Array;
  cam: { yaw: number; pitch: number; near: number; far: number; split: number };
  ray: (x: number, y: number) => number[];
}

const held: Held[] = [];
const pictured: { key: string; frame: number; name: string }[] = [];

/** The ray through the middle of pixel (x, y) of a camera, of length 1. */
function rayOf(cam: Camera): (x: number, y: number) => number[] {
  const out = [0, 0, 0];
  return (x, y) => {
    cam.ray((x + 0.5) / W, (y + 0.5) / H, out);
    return [...out];
  };
}

/** A frame's light shown as the GPU shows it, from the rasterizer's colour at a pixel `rel` metres off: the colour back to light, the twin's air, and shown again. Null over the tone curve's knee. */
function hazedShown(c: ArrayLike<number>, rel: number[], block: Float32Array): number[] | null {
  const e = block[FRAME.exposure]!;
  const lin = [0, 1, 2].map((k) => srgbToLinear(c[k]! / 255));
  if (Math.max(...lin) >= KNEE) return null;
  const sun = [0, 0, 0];
  trueSun(block, sun);
  const out = [0, 0, 0];
  hazed(out, lin.map((v) => v / e), rel, block, theSky().table, sun);
  const shownOut = [0, 0, 0];
  shownSky(out.map((v) => v * e), shownOut);
  return shownOut;
}

export const skyCheck: LitCheck = {
  name: "the dome and the haze (D265, D266)",

  shots(): Shot[] {
    const pack = buildCorePack();
    const flat = (): FarWorld => {
      const w = farWorld({ chunks: 72, tier: tierOf("medium"), width: W, height: H, pack: parsePack(pack) });
      for (const d of CASTLES) castle(w, AT.x + d + 20, AT.z + (d % 7) * 10 - 30);
      w.sendAll();
      w.scene.viewDistance = 4000;
      return w;
    };
    const shot = new Shot("air", W, H, flat().hf, pack);
    // Noon and sunset, looking east: from 2 m up toward the castles; from 1 km up onto the end of the view, where the
    // land meets the dome; and from the ground up, away from the sun.
    for (const [hour, name] of [[12, "noon"], [hourOfSun(0, true), "sunset"]] as const) {
      const w = flat();
      w.scene.hour = hour;
      for (const [up, pitch, view] of [[2, 0.02, "level"], [1000, -0.22, "high"], [2, 0.45, "up"]] as const) {
        [w.cam.x, w.cam.z, w.cam.y, w.cam.yaw, w.cam.pitch] = [AT.x, AT.z, w.hf.heightAt(AT.x, AT.z) + up, Math.PI / 2, pitch];
        for (let f = 0; f < 3; f++) {
          const p = w.frame(true);
          shot.add(p, f === 2);
          if (f < 2) continue;
          const c = w.cam;
          held.push({ key: shot.key, frame: shot.frames.length - 1, name: `${name} ${view}`, color: Uint8Array.from(w.raster.color), kind: w.raster.pickKind.slice(), depth: w.raster.depth.slice(), block: p.frame.slice(), cam: { yaw: c.yaw, pitch: c.pitch, near: c.near, far: c.far, split: p.split }, ray: rayOf(Object.assign(new Camera(), { yaw: c.yaw, pitch: c.pitch, aspect: W / H })) });
          pictured.push({ key: shot.key, frame: shot.frames.length - 1, name: `castles and the horizon, ${name}, ${view}` });
        }
      }
    }
    const shots = [shot];
    if (!process.env.PROBE_PICTURES) return shots;
    // Each mood key's views as the art director's cameras saw them (keys/views/cameras.json): from 4 m over the proving
    // ground's rim, the sea running on past the map, 100 degrees across and 10 up, with the sky's pictures sent.
    const cams = JSON.parse(readFileSync(join(SKY, "keys/views/cameras.json"), "utf8")) as Record<string, Record<string, { heading: number; elevation: number; horizontalFOV: number }>>;
    const ground = new Shot("air-keys", W, H, provingView(W, H).hf, pack);
    for (const key of KEYS) {
      const v = provingView(W, H);
      v.scene.hour = key.hour;
      const found = new Found();
      for (let i = v.nodes.store.query(EYE.x - 60, EYE.z - 60, EYE.x + 60, EYE.z + 60, found) - 1; i >= 0; i--) v.nodes.store.remove(found.refs[i]!);
      const water = v.scene.assets.table.find("core:water");
      for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) v.scene.things.push({ mesh: water, x: 256 + i * 1024, y: v.hf.seaLevel - 0.05, z: 256 + j * 1024, level: -1 });
      for (const side of ["toward", "away"] as const) {
        const c = cams[key.name]![side]!;
        [v.cam.x, v.cam.z] = [EYE.x, EYE.z];
        v.cam.y = v.hf.heightAt(EYE.x, EYE.z) + EYE.over;
        v.cam.fovY = 2 * Math.atan(Math.tan((c.horizontalFOV * Math.PI) / 360) / (W / H));
        [v.cam.yaw, v.cam.pitch] = [(-c.heading * Math.PI) / 180, (c.elevation * Math.PI) / 180];
        for (let f = 0; f < 3; f++) {
          const p = v.render();
          if (ground.frames.length === 0) sendPictures(p, pack);
          ground.add(p, f === 2);
        }
        pictured.push({ key: ground.key, frame: ground.frames.length - 1, name: `${key.name}-${side}` });
      }
    }
    // The castles once more with the clouds.
    const w = flat();
    const castles = new Shot("air-castles", W, H, w.hf, pack);
    for (const [hour, name] of [[16, "afternoon"], [hourOfSun(0, true), "sunset"]] as const) {
      w.scene.hour = hour;
      [w.cam.x, w.cam.z, w.cam.y, w.cam.yaw, w.cam.pitch] = [AT.x, AT.z, w.hf.heightAt(AT.x, AT.z) + 2, Math.PI / 2, 0.06];
      for (let f = 0; f < 3; f++) {
        const p = w.frame(false);
        if (castles.frames.length === 0) sendPictures(p, pack);
        castles.add(p, f === 2);
      }
      pictured.push({ key: castles.key, frame: castles.frames.length - 1, name: `castles 300 m, 1.3 km and 2 km off with clouds, ${name}` });
    }
    return [...shots, ground, castles];
  },

  judge(back: Readback): { ok: boolean; lines: string[] } {
    const lines = [`flat ground with castles as far blocks: the dome ${CLEAR_OF} degrees clear of the sun and moon against the table; the castles, from 2 m up, and the land fading into the dome over the last ${Math.round((1 - VIEW_FADE) * 100)}% of the view, from 1 km up, against the rasterizer's colour put through the twin's air; each within ${NEAR}, 99 points in 100`];
    let ok = true;
    for (const h of held) {
      const gpu = back.pixels(h.key, h.frame);
      if (!gpu) {
        lines.push(`${h.name}: NO PICTURE`);
        ok = false;
        continue;
      }
      const sun = [0, 0, 0], moon = [0, 0, 0];
      trueSun(h.block, sun);
      for (let k = 0; k < 3; k++) moon[k] = h.block[FRAME.moon + k]!;
      const forward = [Math.sin(h.cam.yaw) * Math.cos(h.cam.pitch), Math.sin(h.cam.pitch), Math.cos(h.cam.yaw) * Math.cos(h.cam.pitch)];
      const tally = { dome: [0, 0], castle: [0, 0], end: [0, 0] };
      const worst = { dome: 0, castle: 0, end: 0 };

      for (let y = 2; y < H - 2; y++) {
        for (let x = 2; x < W - 2; x++) {
          const at = y * W + x;
          // Away from edges: the 5 by 5 pixels about it are one kind.
          let same = true;
          for (let dy = -2; dy <= 2 && same; dy++) for (let dx = -2; dx <= 2; dx++) if (h.kind[at + dy * W + dx] !== h.kind[at]) same = false;
          if (!same) continue;
          const r = h.ray(x, y);
          const off = (want: ArrayLike<number>): number => Math.max(...[0, 1, 2].map((c) => Math.abs(gpu[at * 4 + c]! - want[c]!)));
          const count = (what: keyof typeof tally, o: number): void => {
            tally[what][0]!++;
            if (o > NEAR) tally[what][1]!++;
            worst[what] = Math.max(worst[what], Math.round(o * 10) / 10);
          };
          if (h.kind[at] === PICK_SKY) {
            const clear = [sun, moon].every((s) => Math.acos(Math.max(-1, Math.min(1, r[0]! * s[0]! + r[1]! * s[1]! + r[2]! * s[2]!))) > (CLEAR_OF * Math.PI) / 180);
            if (clear) count("dome", off(h.color.subarray(at * 4, at * 4 + 3)));
            continue;
          }
          // How far off the pixel is: its view depth from the depth its range kept, the near one below 0, along the ray.
          const d = h.depth[at]!;
          const far = d >= 0;
          const [n, f] = far ? [h.cam.split * FAR_FROM, h.cam.far] : [h.cam.near, h.cam.split];
          const z = far ? (d - 0.5) * 2 : (d + 0.5) * 2;
          const dist = (2 * f * n) / (f + n - z * (f - n)) / (r[0]! * forward[0]! + r[1]! * forward[1]! + r[2]! * forward[2]!);
          if (!(dist > 0)) continue;
          const rel = r.map((v) => v * dist);
          if (h.kind[at] === PICK_FAR && h.name.endsWith("level")) {
            const want = hazedShown(h.color.subarray(at * 4, at * 4 + 3), rel, h.block);
            if (want) count("castle", off(want));
          } else if (h.kind[at] === PICK_TERRAIN && h.name.endsWith("high") && dist > VIEW_FADE * h.block[FRAME.ends + 1]!) {
            // The end of the view: the twin fades the land into the dome in its direction, which it is at the very end.
            const want = hazedShown(h.color.subarray(at * 4, at * 4 + 3), rel, h.block);
            if (want) count("end", off(want));
          }
        }
      }
      const pass = (what: keyof typeof tally, least: number): boolean => tally[what][0]! >= least && tally[what][1]! <= tally[what][0]! * 0.01;
      const fine = pass("dome", 2000) && (!h.name.endsWith("level") || pass("castle", 30)) && (!h.name.endsWith("high") || pass("end", 300));
      ok &&= fine;
      const say = (what: keyof typeof tally): string => `${what} ${tally[what][0]} points, ${tally[what][1]} over ${NEAR}, worst ${worst[what]}`;
      lines.push(`${h.name.padEnd(13)} ${say("dome")}; ${say("castle")}; ${say("end")}  ${fine ? "ok" : "FAIL"}`);
    }
    const folder = process.env.PROBE_PICTURES;
    if (folder) {
      mkdirSync(folder, { recursive: true });
      for (const p of pictured) {
        const px = back.pixels(p.key, p.frame);
        if (px) writeFileSync(join(folder, `${p.name.replace(/[ ,.]+/g, "-")}.png`), encodePng(W, H, px));
      }
      lines.push(`${pictured.length} pictures written to ${folder}`);
    }
    return { ok, lines };
  },
};

if (import.meta.main) {
  const chrome = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));
  if (!chrome) throw new Error("no Chrome found. Set CHROME to its path.");
  if (process.env.SKY_TIME) {
    const t = await timeSky(chrome);
    console.log(`full screen on ${t.renderer}, blended, ${t.timer ? "by timer query" : "by the clock"}, in ms a megapixel:`);
    for (const [name, v] of Object.entries(t)) if (typeof v === "number") console.log(`  ${name.padEnd(22)} ${v.toFixed(3)}`);
    process.exit(0);
  }
  const dir = process.argv[2] ?? join(tmpdir(), "snark-sky");
  const only = process.argv[3]?.split(",");
  mkdirSync(dir, { recursive: true });
  const t0 = performance.now();
  // An hour a page: more views than that on one page have been seen to stall headless Chrome on this machine.
  // With SKY_LAYER, one layer alone at noon over the keys' camera, straight up and 30 degrees up looking east, as the wind blows.
  if (process.env.SKY_LAYER) {
    const views = [0, 600, 1800].flatMap((t) => [["up", Math.PI / 2 - 1e-4], ["30", Math.PI / 6]].map(([n, pitch]) => ({ name: `${process.env.SKY_LAYER}-${n}-${t}s`, frame: frameAt(12, 60, t, 505, 370), matrix: look(-Math.PI / 2, pitch as number), width: 1280, height: 720 })));
    const pixels = await drawSky(chrome, views, Number(process.env.SKY_TOP ?? 1024));
    views.forEach((v, i) => writeFileSync(join(dir, `${v.name}.png`), encodePng(v.width, v.height, pixels[i]!)));
    process.exit(0);
  }
  for (const [name, hour] of Object.entries(HOURS).filter(([name]) => !only || only.includes(name))) {
    const views = playerViews(name, hour);
    const pixels = await drawSky(chrome, views, Number(process.env.SKY_TOP ?? 1024));
    views.forEach((v, i) => writeFileSync(join(dir, `${v.name}.png`), encodePng(v.width, v.height, pixels[i]!)));
  }
  console.log(`drawn in ${((performance.now() - t0) / 1000).toFixed(1)} s, written to ${dir}`);
}
