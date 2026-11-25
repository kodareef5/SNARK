// What the screens on props cost (client/core/render/screens.ts): their one draw of 30 billboards in view at 1080p,
// timed on this machine's card in Chrome by timer query, seven rounds, the median; the levels made again under a whole
// array of pictures; and the frame's own code, finding the faces and deciding what each shows, timed here. The gates:
// 0.15 ms of GPU and 0.05 ms of code a frame with 30 billboards in view on the RTX 4070.
//
//   SNARK_GPU=nvidia bun tools/screens/cost.ts [--picture out.png]   the view drawn, to look at

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { FACE_FLOATS, FACE_HIGH, FACE_LEVELS, FACE_WIDE, FRAME_FLOATS, FramePacket } from "../../client/core/render/packet.ts";
import { postFrame } from "../../client/core/render/post.ts";
import { PROGRAMS, UNIT, withDefines } from "../../client/core/render/programs.ts";
import { orbLevel } from "../../client/core/render/screen-level.ts";
import { FaceFinder, writeFace } from "../../client/core/render/screens.ts";
import { skyFrame, theSky } from "../../client/core/render/sky.ts";
import { FaceScreens, type FaceHost } from "../../client/core/video/faces.ts";
import type { VideoLike } from "../../client/core/video/player.ts";
import { SCREENS } from "../../shared/video/clip.ts";
import type { ScreenFace } from "../../shared/video/face.ts";
import { SHOW_VIDEO, newScreenState } from "../../shared/video/screen.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";
import { encodePng } from "../snap/png.ts";

const W = 1920, H = 1080, COUNT = 30;
const FACES: (ScreenFace | null)[] = [null, { type: "billboard", face: [-7.4, 7.4, 9.55, 14.4, 1.55], led: true }];
const high = tierOf("high");

/** Thirty billboards along both sides of a road ahead, 20 to 450 m off, each turned a little to the road. */
function street(): { structs: StructureStore; cam: Camera } {
  const half = Float32Array.of(0, 7.5), structs = new StructureStore({ chunksX: 40, chunksZ: 40 }, half, half, half);
  for (let k = 0; k < COUNT; k++) {
    const side = k % 2 === 0 ? 1 : -1;
    structs.add(1, 1000 + side * 22, 0, 1020 + k * 15, Math.round(((Math.PI + side * 0.35) / (2 * Math.PI)) * 65536) & 0xffff, 0, 1);
  }
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.pitch, cam.aspect] = [1000, 2, 1000, 0.12, W / H];
  cam.update();
  return { structs, cam };
}

/** The page's side as the code meets it: the manifest and pictures at once, and clips that never get a frame. */
const MANIFEST = {
  clips: Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, title: "", file: `/a${i}.png`, poster: `/a${i}.png`, width: 1280, height: 420, seconds: 0, bytes: 1, audio: false, rights: "", starter: true, colours: Buffer.from([200, 100, 50, ...Array(12).fill(0)]).toString("base64"), kind: "image" })),
  channels: [{ name: "ads", items: Array.from({ length: 12 }, (_, i) => `a${i}`), shuffle: false, epoch: 0, type: "billboard", still: 8 }],
};
const host: FaceHost = {
  json: () => Promise.resolve(MANIFEST),
  image: (path) => Promise.resolve(path),
  video: () => ({}) as VideoLike,
  visible: () => true,
};

/** Ms of code a frame: finding the faces, deciding what each shows and writing their quads, over `frames` frames. */
async function codeMs(frames: number): Promise<number> {
  const { structs, cam } = street(), finder = new FaceFinder(FACES), screens = new FaceScreens(), p = new FramePacket();
  screens.attach(host);
  const states = SCREENS.map((_, i) => ({ ...newScreenState(), manifest: "0123456789abcdef", show: SHOW_VIDEO, channel: i === 1 ? 0 : 0xffff, epoch: 0 }));
  const view = { states, tick: 0, now: 0, option: true, pixel: cam.fovY / H, count: high.screens.count, layers: high.screens.layers, video: high.screens.video, fps: high.screens.fps };
  const frame = (n: number): void => {
    p.beginFrame();
    view.now = n * 16.7;
    view.tick = n / 2;
    const list = finder.find({ structs }, cam, high.screens);
    screens.step(list, FACES, view, p);
    for (let i = 0; i < list.count; i++) writeFace(p, list, i, FACES[1]!, cam, screens.shows[i]!, 1);
  };
  for (let n = 0; n < 200; n++) {
    frame(n);
    await new Promise((r) => setTimeout(r, 0));
  }
  const t0 = performance.now();
  for (let n = 200; n < 200 + frames; n++) frame(n);
  return (performance.now() - t0) / frames;
}

/** The quads of the street's thirty, each in a layer of its own, one of them changing picture. */
function quads(): { bytes: number[]; matrix: number[]; count: number } {
  const { structs, cam } = street(), finder = new FaceFinder(FACES), p = new FramePacket();
  const list = finder.find({ structs }, cam, high.screens);
  for (let i = 0; i < list.count; i++) {
    const show = { layer: i % high.screens.layers, before: (i + 1) % high.screens.layers, wipe: i === 3 ? 0.5 : 1, crop: Float64Array.of(1, 0.583, 0, 0.209), cropBefore: Float64Array.of(1, 0.583, 0, 0.209), mean: 0xff3080c0, meanBefore: 0xff803010, top: 5, topBefore: 5 };
    writeFace(p, list, i, FACES[1]!, cam, show, orbLevel(1e4));
  }
  return { bytes: Array.from(new Uint8Array(p.faces.buffer, 0, p.faceCount * FACE_FLOATS * 4)), matrix: Array.from(cam.viewProj), count: p.faceCount };
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>screens timing</title><body><script type="module">
const post = (path, body) => fetch(path, { method: "POST", body });
try {
  const r = await (await fetch("/run")).json();
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = [r.W, r.H];
  const gl = canvas.getContext("webgl2", { antialias: true });
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, r.vertex], [gl.FRAGMENT_SHADER, r.fragment]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(program, s);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, "Frame"), 0);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, gl.createBuffer());
  gl.bufferData(gl.UNIFORM_BUFFER, new Float32Array(r.frame), gl.STATIC_DRAW);
  gl.uniform1i(gl.getUniformLocation(program, "uFaces"), r.unit);
  gl.uniformMatrix4fv(gl.getUniformLocation(program, "uViewProj"), false, r.matrix);
  // The pictures: a pattern of colour bars and fine checks in every layer, with its levels.
  gl.activeTexture(gl.TEXTURE0 + r.unit);
  const array = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, array);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, r.levels, gl.SRGB8_ALPHA8, r.wide, r.high, r.layers);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  const px = new Uint8Array(r.wide * r.high * 4);
  for (let y = 0; y < r.high; y++) for (let x = 0; x < r.wide; x++) {
    const i = (y * r.wide + x) * 4, bar = Math.floor(x / 80);
    px[i] = bar & 1 ? 230 : 40; px[i + 1] = bar & 2 ? 220 : 30; px[i + 2] = bar & 4 ? 210 : 50; px[i + 3] = 255;
    if (y > r.high / 2 && ((x >> 2) + (y >> 2)) & 1) px[i] = px[i + 1] = px[i + 2] = 255;
  }
  for (let l = 0; l < r.layers; l++) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, l, r.wide, r.high, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(r.bytes), gl.STATIC_DRAW);
  const stride = r.floats * 4;
  for (let a = 0; a < 7; a++) {
    gl.enableVertexAttribArray(a);
    gl.vertexAttribDivisor(a, 1);
    if (a < 6) gl.vertexAttribPointer(a, a < 3 ? 3 : 4, gl.FLOAT, false, stride, a < 3 ? a * 12 : 36 + (a - 3) * 16);
  }
  gl.vertexAttribIPointer(6, 3, gl.UNSIGNED_INT, stride, 84);
  gl.viewport(0, 0, r.W, r.H);
  // Every fragment shaded, as no depth hides one: what the draw costs at the most.
  gl.disable(gl.DEPTH_TEST);
  const one = new Uint8Array(4);
  const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
  const timed = async (work, n) => {
    work();
    finish();
    const q = gl.createQuery();
    gl.beginQuery(timer.TIME_ELAPSED_EXT, q);
    for (let i = 0; i < n; i++) work();
    gl.endQuery(timer.TIME_ELAPSED_EXT);
    finish();
    for (let wait = 0; wait < 400 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); wait++) await new Promise((r) => setTimeout(r, 5));
    if (gl.getParameter(timer.GPU_DISJOINT_EXT) || !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return NaN;
    return gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / n;
  };
  if (!timer) throw new Error("no timer queries: Chrome is not on the card");
  const draw = () => gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, r.count);
  // A layer's levels made by halving, as the shell makes them for each picture put in it.
  const from = gl.createFramebuffer(), to = gl.createFramebuffer();
  const mips = () => {
    for (let level = 1; level < r.levels; level++) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from);
      gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, array, level - 1, 0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to);
      gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, array, level, 0);
      gl.blitFramebuffer(0, 0, r.wide >> (level - 1), r.high >> (level - 1), 0, 0, r.wide >> level, r.high >> level, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  };
  const whole = () => gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  // A clip's frame, 854 by 480, in a texture of its own, drawn into a layer and halved once, as a clip seen near is. The
  // frame's own upload is left out: a canvas comes through the page's memory here, where a video's frame stays on the card.
  const still = new OffscreenCanvas(854, 480), pen = still.getContext("2d");
  pen.fillStyle = "#3080c0";
  pen.fillRect(0, 0, 854, 480);
  const frame = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, frame);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.SRGB8_ALPHA8, 854, 480);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, still);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, array);
  const clip = () => {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, frame, 0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to);
    gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, array, 0, 1);
    gl.blitFramebuffer(0, 0, 854, 480, 0, 0, r.wide, r.high, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from);
    gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, array, 0, 1);
    gl.framebufferTextureLayer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, array, 1, 1);
    gl.blitFramebuffer(0, 0, r.wide, r.high, 0, 0, r.wide >> 1, r.high >> 1, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  };
  const upload = () => { gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, r.wide, r.high, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  const median = async (work, n) => {
    const t = [];
    for (let k = 0; k < 7; k++) t.push(await timed(work, n));
    return t.sort((a, b) => a - b)[3];
  };
  const pixels = new Uint8Array(r.W * r.H * 4);
  gl.clear(gl.COLOR_BUFFER_BIT);
  draw();
  gl.readPixels(0, 0, r.W, r.H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let covered = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 0) covered++;
  const out = {
    renderer: String(gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
    draw: await median(draw, 40),
    mips: await median(mips, 10),
    whole: await median(whole, 5),
    clip: await median(clip, 10),
    upload: await median(upload, 10),
    covered: covered / (r.W * r.H),
  };
  if (r.picture) {
    await post("/picture", pixels);
  }
  await post("/done", JSON.stringify(out));
} catch (e) {
  await post("/done", JSON.stringify({ error: String((e && e.stack) || e) }));
}
</script>`;

const chrome = findChrome();
if (!chrome) throw new Error("no Chrome to measure in");
const text = PROGRAMS.screens!(high, "rgba", false, true);
const frame = new Float32Array(FRAME_FLOATS);
skyFrame(23, theSky(), frame);
postFrame(frame, high, 23, H);
const q = quads();
const at = process.argv.indexOf("--picture"), picture = at > 0 ? process.argv[at + 1] : undefined;
const run = { picture: !!picture, W, H, vertex: withDefines(text.vertex, text.defines), fragment: withDefines(text.fragment, text.defines), frame: Array.from(frame), unit: UNIT.faces, levels: FACE_LEVELS, wide: FACE_WIDE, high: FACE_HIGH, layers: high.screens.layers, floats: FACE_FLOATS, ...q };
let finish: (r: Record<string, number | string>) => void = () => {};
const finished = new Promise<Record<string, number | string>>((r) => (finish = r));
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response(PAGE, { headers: { "content-type": "text/html" } });
    if (path === "/run") return Response.json(run);
    if (path === "/done") finish(JSON.parse(await req.text()));
    if (path === "/picture" && picture) {
      const px = new Uint8Array(await req.arrayBuffer()), row = W * 4, top = new Uint8Array(px.length);
      for (let y = 0; y < H; y++) top.set(px.subarray((H - 1 - y) * row, (H - y) * row), y * row);
      await Bun.write(picture, encodePng(W, H, top));
    }
    return new Response("ok");
  },
});
const profile = mkdtempSync(join(tmpdir(), "snark-screens-"));
const browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--enable-gpu", "--ignore-gpu-blocklist", `--user-data-dir=${profile}`, `http://localhost:${server.port}/`], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
const t = await Promise.race([finished, new Promise<Record<string, string>>((r) => setTimeout(() => r({ error: "the page sent nothing within two minutes" }), 120000))]);
browser.kill();
await browser.exited;
server.stop(true);
rmSync(profile, { recursive: true, force: true });
if (t.error) throw new Error(String(t.error));
const code = await codeMs(2000);
console.log(`the screens on props on ${t.renderer}, ${q.count} billboards at ${W} by ${H} (${(Number(t.covered) * 100).toFixed(1)}% of the view), night, high's defines:`);
console.log(`  the draw, every fragment shaded   ${Number(t.draw).toFixed(4)} ms GPU   (gate 0.15)`);
console.log(`  a layer's levels made by halving   ${Number(t.mips).toFixed(4)} ms GPU   (all ${high.screens.layers} layers' by generateMipmap ${Number(t.whole).toFixed(4)})`);
console.log(`  a 640 by 360 picture put in a layer ${Number(t.upload).toFixed(4)} ms GPU`);
console.log(`  a clip's frame drawn into a layer and halved once ${Number(t.clip).toFixed(4)} ms GPU, its own upload not timed`);
console.log(`  the frame's code: find, decide, write ${code.toFixed(4)} ms   (gate 0.05)`);
console.log(`  the pictures' array on medium ${((tierOf("medium").screens.layers * FACE_WIDE * FACE_HIGH * 4 * 4) / 3 / 2 ** 20).toFixed(1)} MB   (gate 16)`);
process.exit(0);
