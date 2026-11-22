// Whether this machine's card makes the textures the page makes (client/core/texgen) as their TypeScript twins do, drawn
// by the shipped primitive (client/shell/texgen.ts) as the engine orders it, frame by frame and timed as in play: the
// weathering's bays and field and the formwork's tile. Each layer's bytes are set against its twin's; the card's
// floats are 32 bits where the twin's are 64, so a byte may differ by a step where a feature's edge falls between them.
// It says too how long the card took to make each program's pipeline at its first draw, and to make everything.
//
//   bun tools/texgen/check-gpu.ts [--side 512] [--out folder]
//
// With --out, each layer's two pictures and their difference are kept there as PNGs.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { jobPixels } from "../../client/core/texgen/engine.ts";
import { weatherJobs } from "../../client/core/texgen/weather.ts";
import { encodePng } from "../snap/png.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";

const { values } = parseArgs({ options: { side: { type: "string", default: "512" }, out: { type: "string" } } });
const side = Number(values.side);
const chrome = findChrome();
if (!chrome) throw new Error("no Chrome: set CHROME");
const root = resolve(import.meta.dir, "../..");
const work = mkdtempSync(join(tmpdir(), "snark-texgen-"));
const entry = join(work, "entry.ts");
const taking = (names: string, file: string): string => ["import", `{ ${names} }`, "from", JSON.stringify(join(root, file))].join(" ") + ";";
writeFileSync(entry, `${taking("made", "client/shell/texgen.ts")}
${taking("Texgen", "client/core/texgen/engine.ts")}
${taking("weatherJobs", "client/core/texgen/weather.ts")}
${taking("tierOf", "client/core/assets/tiers.ts")}
const gl = (document.getElementById("c") as HTMLCanvasElement).getContext("webgl2")!;
const engine = new Texgen(weatherJobs(), gl), gen = made(gl, 0), tier = tierOf("high");
const programs = engine.orders.programs.map((p) => {
  const g = gl.createProgram()!;
  for (const [type, text] of [[gl.VERTEX_SHADER, p.vertex], [gl.FRAGMENT_SHADER, p.fragment]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, text);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "");
    gl.attachShader(g, s);
  }
  gl.linkProgram(g);
  if (!gl.getProgramParameter(g, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(g) ?? "");
  return g;
});
const pixel = (): void => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
const warming = engine.warm(), w0 = performance.now();
while (warming.drawn < warming.count) gen.draw(warming, (k) => programs[k]!, () => {});
pixel();
const warm = performance.now() - w0, t0 = performance.now();
let frames = 0, slowest = 0;
for (; frames < 5000 && !engine.done; frames++) {
  const f0 = performance.now();
  gen.draw(engine.frame(${side}, tier, true), (k) => programs[k]!, () => {});
  pixel();
  slowest = Math.max(slowest, performance.now() - f0);
}
const ms = performance.now() - t0;
const fb = gl.createFramebuffer();
gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
const out: string[] = [];
for (let l = 0; l < engine.orders.layers; l++) {
  gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gen.texture, 0, l);
  const px = new Uint8Array(${side} * ${side} * 4);
  gl.readPixels(0, 0, ${side}, ${side}, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let s = "";
  for (let i = 0; i < px.length; i += 8192) s += String.fromCharCode(...px.subarray(i, i + 8192));
  out.push(btoa(s));
}
const info = gl.getExtension("WEBGL_debug_renderer_info");
(globalThis as Record<string, unknown>).done = { renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), warm, frames, ms, slowest, out, first: engine.first };
`);
const built = await Bun.build({ entrypoints: [entry], target: "browser", minify: false });
if (!built.success) throw new Error(built.logs.map(String).join("\n"));
const script = (await built.outputs[0]!.text()).replaceAll("</script", "<\\/script");
const page = `<!doctype html><canvas id=c></canvas><script type=module>try {\n${script}\n} catch (e) { globalThis.done = { error: String(e) }; }</script>`;

const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(page, { headers: { "content-type": "text/html" } }) });
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
  let done: { error?: string; renderer: string; warm: number; frames: number; ms: number; slowest: number; out: string[]; first: number[] } | null = null;
  for (let i = 0; i < 1200 && !done; i++) {
    await Bun.sleep(100);
    done = (await send("Runtime.evaluate", { expression: "globalThis.done ?? null", returnByValue: true }))?.result?.value ?? null;
  }
  if (!done) throw new Error("the page made nothing");
  if (done.error) throw new Error(done.error);
  console.log(`card: ${done.renderer}; ${side} a side; its programs' first draws ${done.warm.toFixed(1)} ms; made in ${done.frames} frames, ${done.ms.toFixed(0)} ms by the page's clock with every frame waited for, the slowest frame ${done.slowest.toFixed(1)} ms`);
  const jobs = weatherJobs();
  let worst = 0;
  for (let l = 0; l < done.out.length; l++) {
    const j = done.first.findLastIndex((f) => f <= l), job = jobs[j]!, card = Uint8Array.from(atob(done.out[l]!), (c) => c.charCodeAt(0)), twin = jobPixels(job, l - done.first[j]!, side);
    let most = 0, over = 0;
    const diff = new Uint8Array(card.length);
    for (let i = 0; i < card.length; i++) {
      const d = Math.abs(card[i]! - twin[i]!);
      most = Math.max(most, d);
      if (d > 2) over++;
      diff[i] = (i & 3) === 3 ? 255 : Math.min(255, d * 16);
    }
    worst = Math.max(worst, over / card.length);
    console.log(`layer ${l} (job ${j}): largest difference ${most}, ${((100 * over) / card.length).toFixed(3)}% of bytes over 2`);
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
