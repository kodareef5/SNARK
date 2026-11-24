// `bun tools/snap/details-ab.ts [branch]`: every kind of small detail that was drawn before fire was, drawn in Chrome by
// the details' texts as `branch` (weapons/plasma) has them, blended as it blended them, and by today's texts, blended as
// today's shell blends them (colour weighed by how much shows, gl.ts `set`), over the same ground; and how far apart the
// two pictures are. On medium's texts into a canvas, on high's into a float light target, and on low poly's.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { airFrame } from "../../client/core/render/atmosphere.ts";
import { DETAIL_DIGITS, DETAIL_GLASS, DETAIL_LAMP, DETAIL_LIT, DETAIL_POOL, DETAIL_PUFF, DETAIL_ROTOR, DETAIL_SHADED_POOL, DETAIL_TIRE, DETAIL_WAKE, DETAIL_WIRE, FRAME, FRAME_FLOATS } from "../../client/core/render/packet.ts";
import { PROGRAMS, withDefines } from "../../client/core/render/programs.ts";
import { skyFrame, theSky } from "../../client/core/render/sky.ts";
import { CARD } from "../bench/fire-cost.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";

/** The kinds of detail there were before fire, by their flags (packet.ts), and the atlas's own: plain, lit, a lit puff, a puff. */
const KINDS: readonly (readonly [string, number])[] = [
  ["a lamp's light", DETAIL_LAMP], ["a lamp's light, second shape", DETAIL_LAMP | 1], ["a pool of light", DETAIL_POOL], ["a wire", DETAIL_WIRE], ["glass", DETAIL_GLASS],
  ["a tyre's mark", DETAIL_TIRE], ["a wake", DETAIL_WAKE], ["a number", DETAIL_DIGITS], ["a shaded pool", DETAIL_SHADED_POOL], ["a rotor's blur", DETAIL_ROTOR],
  ["a picture", 0], ["a lit picture", DETAIL_LIT], ["a lit puff", DETAIL_LIT | DETAIL_PUFF | 1], ["a puff", DETAIL_PUFF | 2], ["flat shape 3", 3], ["flat shape 5, lit", DETAIL_LIT | 5],
];

const PAGE = `<!doctype html><meta charset="utf-8"><title>details, before and after</title><body><script type="module">
const post = (path, body) => fetch(path, { method: "POST", body });
try {
  const { cases, kinds, frame } = await (await fetch("/cases")).json();
  const N = 256;
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = [N, N];
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: false });
  const float = gl.getExtension("EXT_color_buffer_float");
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, gl.createBuffer());
  gl.bufferData(gl.UNIFORM_BUFFER, new Float32Array(frame), gl.STATIC_DRAW);
  // An atlas of noise that shows by halves, so a picture's kinds draw something.
  const atlas = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < atlas.length; i++) atlas[i] = (i * 2654435761 >>> (i % 4 === 3 ? 22 : 24)) & 255;
  const texture = gl.createTexture();
  const build = (vertex, fragment, name) => {
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(name + ": " + gl.getShaderInfoLog(s));
      gl.attachShader(program, s);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(name + ": " + gl.getProgramInfoLog(program));
    const block = gl.getUniformBlockIndex(program, "Frame");
    if (block !== gl.INVALID_INDEX) gl.uniformBlockBinding(program, block, 0);
    return program;
  };
  const target = gl.createFramebuffer(), light = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, light);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, N, N);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, light, 0);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  const out = [];
  for (const c of cases) {
    const programs = [build(c.vertex, c.before, c.name + ", before"), build(c.vertex, c.after, c.name + ", after")];
    gl.bindFramebuffer(gl.FRAMEBUFFER, c.light ? target : null);
    const draw = (which, weighed, flags, grey, shows, bare = false) => {
      const program = programs[which];
      gl.useProgram(program);
      const u = (name) => gl.getUniformLocation(program, name);
      for (const name in c.samplers) gl.uniform1i(u(name), c.samplers[name]);
      gl.activeTexture(gl.TEXTURE0 + (c.samplers.uDetails ?? 0));
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.uniform4f(u("uCard"), flags, grey, shows, 0);
      gl.uniform1f(u("uBlend"), 1);
      gl.uniform1f(u("uCells"), 4);
      gl.uniform1f(u("uFrom"), 0);
      gl.uniform3f(u("uSky"), 0.6, 0.75, 0.9);
      gl.uniform2f(u("uFog"), 1e6, 2e6);
      gl.uniform3f(u("uSun"), 0.35, 0.7, 0.62);
      gl.uniform1f(u("uLight"), 1);
      // A ground of four colours, bright in a light target, and something in its alpha already.
      gl.enable(gl.SCISSOR_TEST);
      const k = c.light ? 2.5 : 1;
      for (const [x, y, r, g, b] of [[0, 0, 0.1, 0.2, 0.6], [1, 0, 0.9, 0.8, 0.3], [0, 1, 0.5, 0.5, 0.5], [1, 1, 0.02, 0.01, 0.03]]) {
        gl.scissor(x * N / 2, y * N / 2, N / 2, N / 2);
        gl.clearColor(r * k, g * k, b * k, 0.25);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.disable(gl.SCISSOR_TEST);
      gl.blendFuncSeparate(weighed ? gl.ONE : gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
      if (!bare) gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = c.light ? new Float32Array(N * N * 4) : new Uint8Array(N * N * 4);
      gl.readPixels(0, 0, N, N, gl.RGBA, c.light ? gl.FLOAT : gl.UNSIGNED_BYTE, px);
      return px;
    };
    const apart = (a, b) => {
      let most = 0, sum = 0, bad = 0;
      for (let i = 0; i < a.length; i++) {
        if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) bad++;
        const d = Math.abs(a[i] - b[i]);
        if (d > most) most = d;
        sum += d;
      }
      return { most, mean: sum / a.length, bad };
    };
    for (const [name, flags] of kinds) for (const [grey, shows] of [[0.3, 1], [0.8, 0.6]]) {
      const before = draw(0, false, flags, grey, shows), after = draw(1, true, flags, grey, shows);
      // The ground alone, and today's text blended the old way: what says the kind drew at all, and that a wrong blend would show.
      const wrong = draw(1, false, flags, grey, shows), bare = draw(1, true, flags, grey, shows, true);
      out.push({ tier: c.name, kind: name, grey, shows, light: c.light, ...apart(before, after), drew: apart(before, bare).most, wrong: apart(before, wrong).most });
    }
  }
  await post("/done", JSON.stringify({ rows: out, renderer: gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER), float: Boolean(float) }));
} catch (e) {
  await post("/done", JSON.stringify({ error: String(e && e.stack || e) }));
}
</script>`;

/** The details' texts as `branch` has them, read from git and evaluated beside today's modules, which they share unchanged. */
async function textsOf(branch: string): Promise<{ lit: string; flat: string }> {
  const dir = resolve(import.meta.dir, "../../.cache/details-ab");
  mkdirSync(dir, { recursive: true });
  const show = Bun.spawnSync(["git", "show", `${branch}:client/core/render/detailtext.ts`], { cwd: resolve(import.meta.dir, "../..") });
  if (show.exitCode !== 0) throw new Error(`no client/core/render/detailtext.ts on ${branch}`);
  const render = resolve(import.meta.dir, "../../client/core/render");
  const source = show.stdout.toString().replace(/from "(\.\.?\/[^"]+)"/g, (_, path: string) => `from "${resolve(render, path)}"`);
  const file = join(dir, `detailtext-${branch.replaceAll("/", "-")}.ts`);
  writeFileSync(file, source);
  const old = (await import(file)) as { DETAIL_LIT_FRAGMENT: string; DETAIL_FLAT_FRAGMENT: string };
  return { lit: old.DETAIL_LIT_FRAGMENT, flat: old.DETAIL_FLAT_FRAGMENT };
}

if (import.meta.main) {
  const chrome = findChrome();
  if (!chrome) throw new Error("no Chrome to draw in");
  const branch = process.argv[2] ?? "weapons/plasma";
  const before = await textsOf(branch);
  const f = new Float32Array(FRAME_FLOATS);
  skyFrame(16, theSky(), f);
  airFrame(f, theSky(), 16, 0, 0, 0, 4000, 1, false);
  f[FRAME.eyeHeight] = 10;
  const cases = [["medium", false], ["high", true], ["lowpoly", false]].map(([name, light]) => {
    const text = PROGRAMS.details!(tierOf(name as string), "rgba", false, light as boolean);
    const flat = !tierOf(name as string).lit;
    return { name, light, vertex: CARD, before: withDefines(flat ? before.flat : before.lit, text.defines), after: withDefines(text.fragment, text.defines), samplers: text.samplers };
  });
  let finish: (r: Record<string, any>) => void = () => {};
  const finished = new Promise<Record<string, any>>((r) => (finish = r));
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/") return new Response(PAGE, { headers: { "content-type": "text/html" } });
      if (path === "/cases") return Response.json({ cases, kinds: KINDS, frame: [...f] });
      if (path === "/done") finish(JSON.parse(await req.text()));
      return new Response("ok");
    },
  });
  const profile = mkdtempSync(join(tmpdir(), "snark-ab-"));
  const browser = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--enable-gpu", "--ignore-gpu-blocklist", `--user-data-dir=${profile}`, `http://localhost:${server.port}/`], { stdout: "ignore", stderr: "ignore" });
  const done = await Promise.race([finished, new Promise<Record<string, any>>((r) => setTimeout(() => r({ error: "the page sent nothing within five minutes" }), 300000))]);
  browser.kill();
  await browser.exited;
  server.stop(true);
  rmSync(profile, { recursive: true, force: true });
  if (done.error) throw new Error(String(done.error));
  console.log(`the details' texts of ${branch} blended its way, against today's blended today's way, on ${done.renderer}${done.float ? "" : " (no float target: high's row is not to be trusted)"}:`);
  let worst = 0;
  for (const r of done.rows as { tier: string; kind: string; grey: number; shows: number; light: boolean; most: number; mean: number; bad: number; drew: number; wrong: number }[]) {
    // A canvas's values are of 255; a light target's are light, told as they are.
    const unit = r.light ? "" : " of 255";
    worst = Math.max(worst, r.light ? r.most * 255 : r.most);
    console.log(`  ${r.tier.padEnd(8)} ${r.kind.padEnd(30)} grey ${r.grey} shows ${r.shows}: at most ${r.most.toFixed(r.light ? 5 : 0)}${unit} apart, ${r.mean.toFixed(5)} on average; it changed the ground by at most ${r.drew.toFixed(r.light ? 3 : 0)}, and the wrong blend would be ${r.wrong.toFixed(r.light ? 3 : 0)} apart${r.bad > 0 ? `; ${r.bad} values are not numbers` : ""}`);
  }
  // Two steps is the rounding of a colour weighed in the text against one weighed by the card.
  console.log(worst <= 2 ? `no kind is more than ${worst.toFixed(1)} steps of 255 apart: the rounding of the two ways` : `MISS: a kind is ${worst.toFixed(2)} steps of 255 apart`);
}
