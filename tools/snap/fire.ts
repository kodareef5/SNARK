// Fire as the software renderer draws it (client/core/render/fire-light.ts): a draw's instances of the cone or the ball,
// each vertex placed by the vertex text's twin and each pixel lit by the fragment text's, blended as the card blends
// them. raster.ts draws a frame's fire with `drawFire`. Run alone, this file draws the two looks by themselves on a plain
// ground, which takes a second: flames by seed, phase and view, and fireballs by age and seed.
//
//   bun tools/snap/fire.ts [--flames] [--bands|--coarse] [--night] [--level N] [--out FILE] [--gpu]
//
// With --gpu the same sheet is then drawn by the fire program's own texts in headless Chrome on this machine's card, on
// a plain ground and as low poly lights its soot, and the two pictures are compared: the twin against what it is twin of.
// The flames' last row is Meridian's jet (suit-finish.ts) on the same cone, for setting the two side by side.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Camera } from "../../client/core/render/camera.ts";
import { CONE_TURN, FIRE_FLAME, FIRE_FRAGMENT, FIRE_VERTEX, FIRE_VERTEX_FLOATS, fireFlat, flameLight, flamePhase, flameVertex, lobeLight, lobeSwell, lobeVertex, putFlame, putLobe, type FireSun } from "../../client/core/render/fire-light.ts";
import { FRAME, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { withDefines } from "../../client/core/render/programs.ts";
import { exhaustLight, exhaustPhase } from "../../client/core/render/suit-finish.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";
import { fireMeshes } from "../pack/fire.ts";
import { encodePng } from "./png.ts";

/** What fire is drawn into: a picture of bytes, and the depth it is tested against where there is one. */
export interface FireTarget {
  width: number;
  height: number;
  color: Uint8ClampedArray;
  depth: Float32Array | null;
  /** The view-projection of points from the eye. */
  matrix: ArrayLike<number>;
  /** A triangle with a corner nearer than `near` is left out, and one wholly past `far`; a pixel nearer than `from` is another range's. */
  near: number;
  far: number;
  from: number;
  /** What a pixel at depth `z` after the projection keeps. */
  stored(z: number): number;
}

/** How a frame draws its fire: with how many octaves of the value noise, as light for a finish or for a display, on a lit tier or not. */
export interface FireLook {
  noise: number;
  target: boolean;
  env: FireSun;
}

const N = FIRE_VERTEX_FLOATS;
let made = new Float64Array(0);
let shown = new Float64Array(0);
const lit = [0, 0, 0, 0];
const flat = new Float64Array(6);

/**
 * Draws instance `at` (in bytes) of `bytes` on a mesh level's `positions`, `colors` and `indices`: front faces alone, each
 * pixel's light added over what is there less what it hides. `tone` and `heat` are a blast's soot's shade and its heat,
 * which its draw's effect holds. `other` lights a flame's pixels in the fire's place: another flame on the same cone,
 * to set beside it. Returns the pixels it lit.
 */
export function drawFire(t: FireTarget, positions: Float32Array, colors: Uint8Array, indices: ArrayLike<number>, kind: number, bytes: Uint8Array, at: number, phase: number, look: FireLook, tone = 0.04, heat = 1, other: ((out: number[], around: number, along: number, facing: number) => void) | null = null): number {
  const count = positions.length / 3;
  if (made.length < count * N) {
    made = new Float64Array(count * N);
    shown = new Float64Array(count * 4);
  }
  const m = t.matrix, W = t.width, H = t.height;
  const one = made.subarray(0, N);
  const v = new Float64Array(N);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
    if (kind === FIRE_FLAME) flameVertex(v, x, y, z, colors[i]! / CONE_TURN, bytes, at, phase);
    else lobeVertex(v, x, y, z, bytes, at, look.env);
    made.set(v, i * N);
    const w = m[3]! * v[0]! + m[7]! * v[1]! + m[11]! * v[2]!;
    shown[i * 4] = (((m[0]! * v[0]! + m[4]! * v[1]! + m[8]! * v[2]!) / w) * 0.5 + 0.5) * W;
    shown[i * 4 + 1] = (0.5 - ((m[1]! * v[0]! + m[5]! * v[1]! + m[9]! * v[2]!) / w) * 0.5) * H;
    shown[i * 4 + 2] = w;
    shown[i * 4 + 3] = (m[2]! * v[0]! + m[6]! * v[1]! + m[10]! * v[2]! + m[14]!) / w;
  }
  void one;
  flat.set(fireFlat);
  let pixels = 0;
  for (let k = 0; k < indices.length; k += 3) {
    const [a, b, c] = [indices[k]!, indices[k + 1]!, indices[k + 2]!];
    const [wa, wb, wc] = [shown[a * 4 + 2]!, shown[b * 4 + 2]!, shown[c * 4 + 2]!];
    if (wa < t.near || wb < t.near || wc < t.near || (wa > t.far && wb > t.far && wc > t.far)) continue;
    const [x0, y0, x1, y1, x2, y2] = [shown[a * 4]!, shown[a * 4 + 1]!, shown[b * 4]!, shown[b * 4 + 1]!, shown[c * 4]!, shown[c * 4 + 1]!];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    // The picture's rows run down, so a face toward the eye turns the other way round here.
    if (area >= 0) continue;
    for (let py = Math.max(0, Math.floor(Math.min(y0, y1, y2))); py <= Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2))); py++) {
      for (let px = Math.max(0, Math.floor(Math.min(x0, x1, x2))); px <= Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2))); px++) {
        const [fx, fy] = [px + 0.5, py + 0.5];
        const e0 = ((x1 - fx) * (y2 - fy) - (x2 - fx) * (y1 - fy)) / area;
        const e1 = ((x2 - fx) * (y0 - fy) - (x0 - fx) * (y2 - fy)) / area;
        const e2 = 1 - e0 - e1;
        // A pixel on an edge two triangles share is the first one's.
        if (e0 < 0 || e1 < 0 || e2 < 0 || (e0 === 0 && x1 > x2) || (e1 === 0 && x2 > x0) || (e2 === 0 && x0 > x1)) continue;
        const o = py * W + px;
        if (t.depth) {
          const z = t.stored(e0 * shown[a * 4 + 3]! + e1 * shown[b * 4 + 3]! + e2 * shown[c * 4 + 3]!);
          if (z >= t.depth[o]!) continue;
        }
        const [q0, q1, q2] = [e0 / wa, e1 / wb, e2 / wc];
        const qs = 1 / (q0 + q1 + q2);
        if (qs < t.from) continue;
        const carry = (j: number): number => (q0 * made[a * N + j]! + q1 * made[b * N + j]! + q2 * made[c * N + j]!) * qs;
        if (other) other(lit, carry(3), carry(4), carry(5));
        else if (kind === FIRE_FLAME) flameLight(lit, carry(3), carry(4), carry(5), flat[0]!, flat[1]!, flat[2]!, flat[3]!, flat[4]!, flat[5]!, look.target);
        else lobeLight(lit, carry(3), carry(4), carry(5), carry(9), flat[0]!, heat, flat[2]!, tone, flat[1]!, carry(6), carry(7), carry(8), look.noise, look.target, look.env.lit);
        if (lit[3]! <= 0 && lit[0]! + lit[1]! + lit[2]! <= 0) continue;
        pixels++;
        for (let ch = 0; ch < 3; ch++) t.color[o * 4 + ch] = t.color[o * 4 + ch]! * (1 - lit[3]!) + 255 * lit[ch]!;
      }
    }
  }
  return pixels;
}

/** One instance of a sheet: its cell, which mesh and kind, the frame's phase, and its twenty bytes. */
interface Drawn {
  col: number;
  row: number;
  kind: number;
  phase: number;
  tone: number;
  heat: number;
  bytes: number[];
}

/** The page that draws a sheet with the fire program's own texts and posts its pixels back. */
const GPU_PAGE = `<!doctype html><meta charset="utf-8"><body><script type="module">
const post = (path, body) => fetch(path, { method: "POST", body });
try {
  const s = await (await fetch("/sheet")).json();
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = [s.W, s.H];
  const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, s.vertex], [gl.FRAGMENT_SHADER, s.fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const u = (name) => gl.getUniformLocation(program, name);
  gl.uniformMatrix4fv(u("uViewProj"), false, s.matrix);
  gl.uniform3f(u("uCenter"), 0, 0, 0);
  gl.uniform3f(u("uHalf"), 1, 1, 1);
  gl.uniform3f(u("uSun"), ...s.sun);
  gl.uniform1f(u("uLight"), 1);
  gl.uniform1f(u("uFrom"), 0);
  const meshes = s.meshes.map((m) => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(m.positions), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(m.colors), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_BYTE, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(m.indices), gl.STATIC_DRAW);
    const instance = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instance);
    // As the shell binds an instance's twenty bytes (client/shell/gl.ts bind).
    for (const a of [2, 3, 4, 5]) {
      gl.enableVertexAttribArray(a);
      gl.vertexAttribDivisor(a, 1);
    }
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 20, 0);
    gl.vertexAttribPointer(3, 1, gl.UNSIGNED_SHORT, true, 20, 12);
    gl.vertexAttribIPointer(4, 4, gl.UNSIGNED_BYTE, 20, 14);
    gl.vertexAttribIPointer(5, 2, gl.UNSIGNED_BYTE, 20, 18);
    return { vao, instance, count: m.indices.length };
  });
  gl.clearColor(s.ground[0] / 255, s.ground[1] / 255, s.ground[2] / 255, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
  gl.enable(gl.CULL_FACE);
  for (const d of s.drawn) {
    const m = meshes[d.kind];
    gl.viewport(d.col * s.CW, s.H - (d.row + 1) * s.CH, s.CW, s.CH);
    gl.bindVertexArray(m.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.instance);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(d.bytes), gl.DYNAMIC_DRAW);
    gl.uniform4f(u("uEffect"), d.kind, d.phase, d.tone, d.heat);
    gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0, 1);
  }
  const px = new Uint8Array(s.W * s.H * 4);
  gl.readPixels(0, 0, s.W, s.H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  await post("/pixels", px);
  await post("/done", JSON.stringify({ renderer: String(gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)) }));
} catch (e) {
  await post("/done", JSON.stringify({ error: String(e && e.message || e) }));
}
</script>`;

/** Draws `sheet` in Chrome with the fire program's texts: its pixels, top row first, and the card that drew them. */
async function onCard(sheet: Record<string, unknown> & { W: number; H: number }): Promise<{ pixels: Uint8Array; renderer: string }> {
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome to draw in");
  let pixels = new Uint8Array(0);
  let finish: (r: { renderer?: string; error?: string }) => void = () => {};
  const finished = new Promise<{ renderer?: string; error?: string }>((r) => (finish = r));
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/") return new Response(GPU_PAGE, { headers: { "content-type": "text/html" } });
      if (path === "/sheet") return Response.json(sheet);
      if (path === "/pixels") {
        const px = new Uint8Array(await req.arrayBuffer()), row = sheet.W * 4;
        pixels = new Uint8Array(px.length);
        for (let y = 0; y < sheet.H; y++) pixels.set(px.subarray((sheet.H - 1 - y) * row, (sheet.H - y) * row), y * row);
      }
      if (path === "/done") finish(JSON.parse(await req.text()));
      return new Response("ok");
    },
  });
  const profile = mkdtempSync(join(tmpdir(), "snark-fire-"));
  const browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--enable-gpu", "--ignore-gpu-blocklist", `--user-data-dir=${profile}`, `http://localhost:${server.port}/`], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  const done = await Promise.race([finished, new Promise<{ renderer?: string; error?: string }>((r) => setTimeout(() => r({ error: "the page sent nothing within two minutes" }), 120000))]);
  browser.kill();
  await browser.exited;
  server.stop(true);
  rmSync(profile, { recursive: true, force: true });
  if (done.error) throw new Error(done.error);
  return { pixels, renderer: done.renderer ?? "" };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const night = args.includes("--night");
  const [cone, ball] = fireMeshes().map((mesh) => mesh.lods[Number(arg("level") ?? 0)]!);
  // An afternoon's light, as a frame block holds it, or a night's.
  const frame = new Float32Array(FRAME_FLOATS);
  frame.set([0.35, 0.7, 0.62], FRAME.sun);
  frame.set(night ? [0, 0, 0, 6] : [2.6, 2.4, 2.0, 0.42], FRAME.sunColor);
  frame.set([-0.35, 0.7, -0.62], FRAME.moon);
  frame.set(night ? [0.02, 0.025, 0.04] : [0, 0, 0], FRAME.moonColor);
  frame.set(night ? [0.004, 0.006, 0.012] : [0.5, 0.62, 0.85], FRAME.skyAbove);
  frame.set(night ? [0.002, 0.002, 0.003] : [0.18, 0.16, 0.13], FRAME.skyBelow);
  const gpu = args.includes("--gpu");
  const GROUND = [96, 100, 108];
  const look: FireLook = { noise: args.includes("--bands") ? 0 : args.includes("--coarse") ? 1 : 2, target: false, env: { lit: !gpu, frame, sun: [0.35, 0.7, 0.62], light: 1 } };
  const drawn: Drawn[] = [];
  const flames = args.includes("--flames");
  const [CW, CH] = flames ? [440, 200] : [220, 200];
  const cols = flames ? 4 : 8, rows = flames ? (gpu ? 6 : 7) : 4;
  const [W, H] = [CW * cols, CH * rows];
  const pixels = new Uint8ClampedArray(W * H * 4);
  const cell = new Uint8ClampedArray(CW * CH * 4);
  const bytes = new Uint8Array(INSTANCE_BYTES);
  const cam = new Camera();
  cam.aspect = CW / CH;
  cam.fovY = flames ? 0.5 : 0.7;
  cam.update();
  const target: FireTarget = { width: CW, height: CH, color: cell, depth: null, matrix: cam.viewProj, near: 0.05, far: Infinity, from: 0, stored: (z) => z };
  const ground = (): void => {
    for (let y = 0; gpu && y < CH; y++) for (let x = 0; x < CW; x++) cell.set([...GROUND, 255], (y * CW + x) * 4);
    for (let y = 0; !gpu && y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        const sky = y < CH * 0.62;
        const k = y / CH;
        const rgb = night ? (sky ? [8 + 6 * k, 10 + 8 * k, 18 + 10 * k] : [16, 15, 14]) : sky ? [120 + 60 * k, 160 + 50 * k, 215 + 20 * k] : [118 - 30 * (k - 0.62), 112 - 30 * (k - 0.62), 92 - 20 * (k - 0.62)];
        // A dark post behind, to see what the fire hides.
        const post = Math.abs(x - CW * 0.68) < 5 ? 0.25 : 1;
        cell.set([rgb[0]! * post, rgb[1]! * post, rgb[2]! * post, 255], (y * CW + x) * 4);
      }
    }
  };
  const put = (col: number, row: number): void => {
    for (let y = 0; y < CH; y++) pixels.set(cell.subarray(y * CW * 4, (y + 1) * CW * 4), ((row * CH + y) * W + col * CW) * 4);
  };
  const t0 = performance.now();
  if (!flames) {
    // Fireballs: a row a seed, a column an age.
    const ages = [0.02, 0.08, 0.16, 0.28, 0.42, 0.58, 0.74, 0.9];
    for (let row = 0; row < rows; row++) {
      ages.forEach((age, col) => {
        ground();
        const seeds = [0.13, 0.57, 0.81].map((s) => (s + row * 0.217) % 1);
        // Three lobes, as a blast near has them, the farthest first; the last row one alone.
        const lobes = [[-0.9, 0.3, 0.7, 1.5], [0.8, 0.9, 0.3, 1.3], [0, 0, -0.2, 2]] as const;
        lobes.slice(row === 3 ? 2 : 0).forEach(([x, y, z, r], k) => {
          const rise = 1.6 * age, tone = 0.025 + 0.02 * k;
          // The last row's lobe stands on the ground, which is 1.5 m under where it began.
          putLobe(bytes, 0, x, y + rise - 0.6, 11 + z, r * lobeSwell(age), age, seeds[k]!, row === 3 ? 1.5 + rise : Infinity, 1);
          drawFire(target, ball.positions, ball.colors, ball.indices, 1, bytes, 0, 0, look, tone, 1);
          drawn.push({ col, row, kind: 1, phase: 0, tone, heat: 1, bytes: [...bytes] });
        });
        put(col, row);
      });
    }
  } else {
    // Flames 0.9 m long: from the side at moments of the phase, as its motor lights, from behind, from ahead, and far off.
    const views: [number, number, number, number, number, number, number, number][] = [
      [-0.45, 0, 1.5, 1, 0, 0, 0, 0], [-0.45, 0, 1.5, 1, 0, 0, 0, 400], [-0.45, 0, 2.6, 1, 0, 0, 0, 900], [-0.45, 0, 5, 1, 0, 0, 0, 1700],
      [-0.8, 0, 2, 1, 0, 0, 1, 250], [-0.7, 0, 2, 1, 0, 0, 0.5, 250], [-0.3, -0.05, 2.6, 0.5, 0.1, -1, 0, 0], [0, 0, 2.2, 0.05, 0.03, -1, 0, 0],
      [0.1, 0, 2.8, 0.5, 0.2, 1, 0, 600], [0, 0, 3.2, 0.04, 0.02, 1, 0, 600], [-0.45, 0, 9, 1, 0, 0, 0, 300], [-0.45, 0, 30, 1, 0, 0, 0, 300],
    ];
    const light = new Float64Array(3);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // The last row is the first again, lit as Meridian's jet is.
        const meridian = row === 6;
        const [x, y, z, dx, dy, dz, ignite, ms] = views[(meridian ? col : Math.floor(row / 2) * cols + col) % views.length]!;
        ground();
        const l = Math.hypot(dx, dy, dz);
        putFlame(bytes, 0, x, y, z, dx / l, dy / l, dz / l, 0.9, 1, ignite, (0.21 + (row % 2) * 0.37) % 1);
        const jet = (out: number[], around: number, along: number, facing: number): void => {
          const hides = exhaustLight(light, along, around, facing, exhaustPhase(ms), 1);
          // As a display shows that light: toned as the frame's is, to the same ground.
          for (let c = 0; c < 3; c++) out[c] = hides * Math.min(1, Math.max(0, 1.055 * Math.pow(Math.min(1, light[c]! / (1 + light[c]! * 0.25)), 1 / 2.4) - 0.055));
          out[3] = hides;
        };
        drawFire(target, cone.positions, cone.colors, cone.indices, FIRE_FLAME, bytes, 0, flamePhase(ms + (row % 2) * 333), look, 0, 1, meridian ? jet : null);
        if (!meridian) drawn.push({ col, row, kind: FIRE_FLAME, phase: flamePhase(ms + (row % 2) * 333), tone: 0, heat: 1, bytes: [...bytes] });
        put(col, row);
      }
    }
  }
  const out = resolve(arg("out") ?? `.cache/rocket-fx/${flames ? "flames" : "lobes"}${night ? "-night" : ""}.png`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePng(W, H, pixels));
  console.log(`${out}  ${W}x${H}  ${(performance.now() - t0).toFixed(0)} ms`);
  if (gpu) {
    const defines = (look.noise > 0 ? "#define FIRE_NOISE\n" : "") + (look.noise > 1 ? "#define FIRE_FINE\n" : "");
    const mesh = (lod: typeof cone) => ({ positions: [...lod.positions], colors: [...lod.colors], indices: [...lod.indices] });
    const card = await onCard({ W, H, CW, CH, vertex: withDefines(FIRE_VERTEX, defines), fragment: withDefines(FIRE_FRAGMENT, defines), matrix: [...cam.viewProj], sun: Array.from(look.env.sun), ground: GROUND, meshes: [mesh(cone), mesh(ball)], drawn });
    // How far the twin is from the card, a channel of 255: the mean, and the share of pixels more than eight apart.
    let sum = 0, apart = 0, lit = 0;
    for (let i = 0; i < W * H; i++) {
      let worst = 0, any = false;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(card.pixels[i * 4 + c]! - pixels[i * 4 + c]!);
        sum += d;
        worst = Math.max(worst, d);
        if (card.pixels[i * 4 + c] !== GROUND[c] || pixels[i * 4 + c] !== GROUND[c]) any = true;
      }
      if (any) lit++;
      if (worst > 8) apart++;
    }
    const file = out.replace(/\.png$/, "-gpu.png");
    writeFileSync(file, encodePng(W, H, new Uint8ClampedArray(card.pixels)));
    console.log(`${file}  drawn on ${card.renderer}`);
    console.log(`the twin against the card: ${(sum / (W * H * 3)).toFixed(3)} of 255 apart a channel on average, ${lit} pixels alight, ${apart} of them (${((100 * apart) / Math.max(1, lit)).toFixed(2)}%) more than 8 apart`);
  }
}
