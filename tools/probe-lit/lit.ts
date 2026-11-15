// The lit programs on a GPU (D263, D264), a check of tools/probe-lit.ts: the proving ground from its spawn point on
// the default tier at noon, in the morning, in the afterglow and at night, held to the software rasterizer at points
// away from every edge, the dome among them. Textured frames are held to it by `--textured`, which draws its house on
// the lit tiers. Run by itself, this file draws LIT, SURFACE and FLAT full screen in Chrome and reports milliseconds a
// megapixel: the device probe's line for these programs, on this machine.
// Run: bun tools/probe-lit/lit.ts

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { skyFrame, theSky } from "../../client/core/render/sky.ts";
import { buildCorePack } from "../pack/build.ts";
import { spread, type Spread } from "../probe-textured.ts";
import { PICK_SKY } from "../snap/raster.ts";
import { provingView } from "../snap.ts";
import { Shot, type LitCheck, type Readback } from "./shot.ts";

const ROOT = resolve(import.meta.dir, "../..");
const [W, H] = [640, 360];
/** The hours drawn: noon, the morning, the afterglow just after sunset, and the middle of the night. */
const HOURS = [12, 7.5, 18.3, 0];
/** A point is judged where the 9 by 9 pixels about it are one surface, or all dome, and the rasterizer's colour there changes by no more than this from a pixel to the next. */
const NEAR = 4;
const SMOOTH = 3;
/** Levels of 255 the GPU may be from the rasterizer: every point's 5 by 5 mean, and 99 points' pixels in 100. */
const TOLERANCE = { mean: 3, pixelP99: 3 };

/** The rasterizer's picture of a frame read back, and what is under each pixel. */
interface Picture {
  hour: number;
  frame: number;
  color: Uint8ClampedArray;
  depth: Float32Array;
  pickKind: Uint8Array;
  pickId: Uint32Array;
}

const pictures: Picture[] = [];

/** The GPU's picture, top row first, against the rasterizer's at points away from edges: the worst channel of the pixel, and of the 5 by 5 mean about it. */
function judge(pic: Picture, gpu: Uint8Array): { pixel: Spread; mean: Spread; dome: number; ok: boolean } {
  const { color, depth, pickKind, pickId } = pic;
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
        most = Math.max(most, Math.abs(gpu[i * 4 + c]! - color[i * 4 + c]!));
        let sum = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sum += gpu[(i + dy * W + dx) * 4 + c]! - color[(i + dy * W + dx) * 4 + c]!;
        mostMean = Math.max(mostMean, Math.abs(sum / 25));
      }
      pixel.push(most);
      mean.push(mostMean);
    }
  }
  const [p, m] = [spread(pixel), spread(mean)];
  return { pixel: p, mean: m, dome, ok: p.points >= 500 && m.worst <= TOLERANCE.mean && p.p99 <= TOLERANCE.pixelP99 };
}

export const litCheck: LitCheck = {
  name: "lit programs (D263, D264)",

  shots(): Shot[] {
    const view = provingView(W, H);
    view.cam.pitch = 0;
    const shot = new Shot("lit", W, H, view.hf, buildCorePack());
    for (const hour of HOURS) {
      view.scene.hour = hour;
      for (let f = 0; f < 3; f++) shot.add(view.render(), f === 2);
      const r = view.raster;
      pictures.push({ hour, frame: shot.read.at(-1)!, color: r.color.slice(), depth: r.depth.slice(), pickKind: r.pickKind.slice(), pickId: r.pickId.slice() });
    }
    return [shot];
  },

  judge(back: Readback): { ok: boolean; lines: string[] } {
    const lines = [`the proving ground on medium against the rasterizer at points with one surface, or the dome, and no edge within ${NEAR} pixels; every 5 by 5 mean within ${TOLERANCE.mean} and pixels within ${TOLERANCE.pixelP99} at 99 in 100`];
    let ok = true;
    for (const pic of pictures) {
      const gpu = back.pixels("lit", pic.frame);
      if (!gpu) {
        lines.push(`${String(pic.hour).padStart(5)} h: NO PICTURE`);
        ok = false;
        continue;
      }
      const j = judge(pic, gpu);
      ok &&= j.ok;
      lines.push(`${String(pic.hour).padStart(5)} h: ${j.pixel.points} points (${j.dome} on the dome): pixels mean ${j.pixel.mean.toFixed(2)}, 99 in 100 within ${j.pixel.p99}, worst ${j.pixel.worst}; means worst ${j.mean.worst.toFixed(2)}  ${j.ok ? "ok" : "FAIL"}`);
    }
    return { ok, lines };
  },
};

const PAGE = `<!doctype html><meta charset="utf-8"><title>lit programs full screen</title><body><script type="module">
const load = (name) => import("/m/" + name + ".js");
const { PROGRAMS, UNIT } = await load("programs");
const { tierOf } = await load("tiers");
const { theSky, SKY_SIZE } = await load("sky");
const post = (path, body) => fetch(path, { method: "POST", body });
// A full-screen triangle, a wall 5 m ahead, with what each fragment text takes from its vertex text.
const AT = "vec2 at = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;\\n  vRel = vec3(at.x * 3.0, at.y * 2.0 - 0.5, 5.0);\\n  gl_Position = vec4(at, 0.5, 1.0);\\n";
const FLAT_VS = "#version 300 es\\nout vec3 vRel;\\nflat out vec3 vColor;\\nvoid main() {\\n  " + AT + "  vColor = vec3(0.6, 0.4, 0.3);\\n}";
const SURFACE_VS = "#version 300 es\\nout vec3 vRel, vNormal;\\nout vec4 vTangent;\\nout vec2 vUv;\\nflat out mat3 vDye, vDye2;\\nvoid main() {\\n  " + AT + "  vNormal = vec3(0.0, 0.0, -1.0);\\n  vTangent = vec4(1.0, 0.0, 0.0, 1.0);\\n  vUv = at * 4.0;\\n  vDye = mat3(1.0);\\n  vDye2 = mat3(1.0);\\n}";
try {
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
    for (const name of ["uSolid", "uAlpha", "uLight"]) gl.uniform1f(u(name), 1);
    gl.uniform3f(u("uTint"), 1, 1, 1);
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
  // Milliseconds for one full-screen draw, by timer query where there is one, else by the clock.
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
  const out = { timer: !!timer, renderer: String(gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)) };
  // Seven rounds, the programs in a turned order each time, and the median of each.
  const names = Object.keys(programs);
  const times = Object.fromEntries(names.map((name) => [name, []]));
  for (let round = 0; round < 7; round++) {
    for (let k = 0; k < names.length; k++) {
      const name = names[(k + round) % names.length];
      times[name].push((await ms(programs[name], 100)) / ((1024 * 1024) / 1e6));
    }
  }
  for (const name of names) out[name] = times[name].sort((a, b) => a - b)[3];
  await post("/timing", JSON.stringify(out));
} catch (e) {
  await post("/timing", JSON.stringify({ error: String((e && e.stack) || e) }));
}
</script>`;

/** LIT, SURFACE and FLAT full screen in Chrome, in milliseconds a megapixel, under noon's frame block. */
export async function fullScreen(chrome: string): Promise<Record<string, number | string | boolean> | null> {
  const frame = new Float32Array(FRAME_FLOATS);
  skyFrame(12, theSky(), frame);
  const modules = await Bun.build({ entrypoints: ["client/core/render/programs.ts", "client/core/assets/tiers.ts", "client/core/render/sky.ts"].map((f) => join(ROOT, f)), target: "browser", splitting: true, format: "esm", naming: "[name].[ext]" });
  if (!modules.success) throw new Error(modules.logs.map(String).join("\n"));
  const served = new Map<string, Blob>(modules.outputs.map((o) => [`/m/${o.path.slice(2)}`, o]));
  let finish: (r: Record<string, number | string | boolean>) => void = () => {};
  const finished = new Promise<Record<string, number | string | boolean>>((r) => (finish = r));
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/") return new Response(PAGE, { headers: { "content-type": "text/html" } });
      if (served.has(path)) return new Response(served.get(path)!, { headers: { "content-type": "text/javascript" } });
      if (path === "/frame.bin") return new Response(frame);
      if (path === "/timing") finish(JSON.parse(await req.text()));
      return new Response("ok");
    },
  });
  const profile = mkdtempSync(join(tmpdir(), "snark-probe-"));
  const browser = Bun.spawn([chrome, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--user-data-dir=${profile}`, `http://localhost:${server.port}/`], { stdout: "ignore", stderr: "ignore" });
  const out = await Promise.race([finished, new Promise<null>((r) => setTimeout(() => r(null), 120000))]);
  browser.kill();
  await browser.exited;
  server.stop(true);
  rmSync(profile, { recursive: true, force: true });
  return out;
}

if (import.meta.main) {
  const chrome = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));
  if (!chrome) throw new Error("no Chrome found. Set CHROME to its path.");
  const t = await fullScreen(chrome);
  if (!t || t.error) {
    console.error(`probe: no timing: ${t?.error ?? "the page sent nothing within two minutes"}`);
    process.exit(1);
  }
  const ms = (name: string): string => `${(t[name] as number).toFixed(3)} ms`;
  console.log(`full screen on ${t.renderer}, ${t.timer ? "by timer query" : "by the clock"}, in ms a megapixel: FLAT ${ms("FLAT")}, LIT ${ms("LIT")}, SURFACE ${ms("SURFACE")}`);
}
