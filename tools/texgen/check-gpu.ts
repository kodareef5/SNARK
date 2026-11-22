// Whether this machine's card makes the walls' weathering masks as the TypeScript twin does (client/core/texgen/weather.ts):
// one headless Chrome draws every layer with the page's own program into an RGBA8 target, reads it back, and each byte
// is set against weatherPixels's. The card's floats are 32 bits where the twin's are 64, so a few bytes may differ by a
// step or two where a feature's edge falls between them; the report gives the largest difference and the share over 2.
//
//   bun tools/texgen/check-gpu.ts [--side 256] [--out folder]
//
// With --out, each layer's two pictures and their difference are kept there as PNGs.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { WEATHER_RECIPE } from "../../content/texgen/weather.ts";
import { WEATHER_BAYS, WEATHER_GEN_VERTEX, WEATHER_LAYERS, bayFeatures, baySeed, fieldLut, fieldSeed, weatherFragment, weatherPixels } from "../../client/core/texgen/weather.ts";
import { encodePng } from "../snap/png.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";

const { values } = parseArgs({ options: { side: { type: "string", default: "256" }, out: { type: "string" } } });
const side = Number(values.side);
const chrome = findChrome();
if (!chrome) throw new Error("no Chrome: set CHROME");

const jobs = Array.from({ length: WEATHER_LAYERS }, (_, l) => {
  const field = l >= WEATHER_BAYS, seed = field ? fieldSeed(WEATHER_RECIPE, l - WEATHER_BAYS) : 0;
  const bays = field ? [] : [0, 1].map((half) => [...bayFeatures(WEATHER_RECIPE, baySeed(WEATHER_RECIPE, l, half))]);
  return { seed, field: field ? 1 : 0, lut: field ? [...fieldLut(seed)] : [], bays };
});
const page = `<!doctype html><canvas id=c></canvas><script>
const gl = document.getElementById("c").getContext("webgl2");
const side = ${side}, jobs = ${JSON.stringify(jobs)};
const shader = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
const p = gl.createProgram();
gl.attachShader(p, shader(gl.VERTEX_SHADER, ${JSON.stringify(WEATHER_GEN_VERTEX)}));
gl.attachShader(p, shader(gl.FRAGMENT_SHADER, ${JSON.stringify(weatherFragment())}));
gl.linkProgram(p);
if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
gl.useProgram(p);
gl.bindVertexArray(gl.createVertexArray());
const t = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, t);
gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, side, side);
const fb = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
gl.viewport(0, 0, side, side);
const out = [], times = [];
for (const j of jobs) {
  gl.uniform1i(gl.getUniformLocation(p, "uSeed"), j.seed);
  gl.uniform1i(gl.getUniformLocation(p, "uField"), j.field);
  gl.uniform1f(gl.getUniformLocation(p, "uSide"), side);
  if (j.field) gl.uniform4fv(gl.getUniformLocation(p, "uLut"), new Float32Array(j.lut));
  gl.finish(); const t0 = performance.now();
  if (j.field) gl.drawArrays(gl.TRIANGLES, 0, 3);
  else for (const half of [0, 1]) { gl.uniform4fv(gl.getUniformLocation(p, "uBay"), new Float32Array(j.bays[half])); gl.viewport(0, half * side / 2, side, side / 2); gl.drawArrays(gl.TRIANGLES, 0, 3); }
  gl.viewport(0, 0, side, side);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); times.push(performance.now() - t0);
  const px = new Uint8Array(side * side * 4);
  gl.readPixels(0, 0, side, side, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let s = ""; for (let i = 0; i < px.length; i += 8192) s += String.fromCharCode(...px.subarray(i, i + 8192));
  out.push(btoa(s));
}
const info = gl.getExtension("WEBGL_debug_renderer_info"); globalThis.done = { renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), out, times };
</script>`;

const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(page, { headers: { "content-type": "text/html" } }) });
const work = mkdtempSync(join(tmpdir(), "snark-texgen-"));
const port = 9800 + Math.floor(Math.random() * 100);
const browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run", `--user-data-dir=${join(work, "profile")}`, `--remote-debugging-port=${port}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
try {
  let target: { type: string; webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 100 && !target; i++) {
    await Bun.sleep(100);
    try { target = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === "page"); } catch { /* not up yet */ }
  }
  if (!target) throw new Error("Chrome did not open a page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const waiting = new Map<number, (v: any) => void>();
  ws.onmessage = (e) => { const d = JSON.parse(String(e.data)); if (d.id && waiting.has(d.id)) { waiting.get(d.id)!(d.result); waiting.delete(d.id); } };
  const send = (method: string, params: object): Promise<any> => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/` });
  let done: { renderer: string; out: string[]; times: number[] } | null = null;
  for (let i = 0; i < 600 && !done; i++) {
    await Bun.sleep(100);
    done = (await send("Runtime.evaluate", { expression: "globalThis.done ?? null", returnByValue: true }))?.result?.value ?? null;
  }
  if (!done) throw new Error("the page did not draw the masks");
  console.log(`card: ${done.renderer}; layers ${side} a side; ms a layer: ${done.times.map((t) => t.toFixed(1)).join(", ")}`);
  let worst = 0;
  for (let l = 0; l < WEATHER_LAYERS; l++) {
    const card = Uint8Array.from(atob(done.out[l]!), (c) => c.charCodeAt(0)), twin = weatherPixels(l, side);
    let most = 0, over = 0;
    const diff = new Uint8Array(card.length);
    for (let i = 0; i < card.length; i++) {
      const d = Math.abs(card[i]! - twin[i]!);
      most = Math.max(most, d);
      if (d > 2) over++;
      diff[i] = (i & 3) === 3 ? 255 : Math.min(255, d * 16);
    }
    worst = Math.max(worst, over / card.length);
    console.log(`layer ${l} (${l < WEATHER_BAYS ? "bay" : "field"}): largest difference ${most}, ${((100 * over) / card.length).toFixed(3)}% of bytes over 2`);
    if (values.out) {
      mkdirSync(values.out, { recursive: true });
      for (const [name, data] of [["card", card], ["twin", twin], ["diff", diff]] as const) writeFileSync(join(values.out, `layer${l}-${name}.png`), encodePng(side, side, data));
    }
  }
  if (worst > 0.001) {
    console.log(`the card and the twin differ in more than 0.1% of a layer's bytes (${(100 * worst).toFixed(3)}%)`);
    process.exitCode = 1;
  }
} finally {
  browser.kill();
  server.stop();
}
