// One-shot shader verification in installed Chrome, using a local file and no listening server.
// bun tools/surfaces/compile.ts; output stays in var/surfaces. No port, including 8787, is used.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { TIERS } from "../../client/core/assets/tiers.ts";
import { PROGRAMS, withDefines } from "../../client/core/render/programs.ts";
import "../../client/core/render/orb-late.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";

const folder = resolve("var/surfaces");
mkdirSync(folder, { recursive: true });
const texts = TIERS.flatMap((tier) => (["rgba", "bc", "astc"] as const).flatMap((format) => Object.entries(PROGRAMS).map(([name, make]) => {
  const p = make(tier, format);
  return { key: `${tier.name}/${format}/${name}`, vertex: withDefines(p.vertex, p.defines), fragment: withDefines(p.fragment, p.defines) };
})));
const page = `<!doctype html><meta charset="utf-8"><body><script>
try {
const canvas=document.createElement('canvas'); const gl=canvas.getContext('webgl2');
if (!gl) throw new Error('WebGL2 unavailable');
const problems=[];
for(const p of ${JSON.stringify(texts)}) {
 const compile=(type,text)=>{ const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))problems.push([p.key,gl.getShaderInfoLog(s)]);return s; };
 const vs=compile(gl.VERTEX_SHADER,p.vertex), fs=compile(gl.FRAGMENT_SHADER,p.fragment);
 const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))problems.push([p.key,gl.getProgramInfoLog(program)]);
 gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
}
const ext=gl.getExtension('WEBGL_debug_renderer_info');
document.body.textContent='SURFACE_REPORT:'+JSON.stringify({programs:${texts.length},renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),problems});
} catch(e) {document.body.textContent='SURFACE_REPORT:'+JSON.stringify({error:String(e)});}
</script>`;
const html = join(folder, "compile.html");
writeFileSync(html, page);
const profile = mkdtempSync(join(tmpdir(), "snark-surfaces-chrome-"));
const chrome = findChrome();
if (!chrome) throw new Error("no Chrome found. Set CHROME to its path.");
const child = Bun.spawn([chrome, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", `--user-data-dir=${profile}`, "--dump-dom", `file://${html}`], { stdout: Bun.file(join(folder, "compile-dom.txt")), stderr: Bun.file(join(folder, "compile-browser.log")) });
const timer = setTimeout(() => child.kill(), 55000);
const code = await child.exited;
clearTimeout(timer);
rmSync(profile, { recursive: true, force: true });
const dom = readFileSync(join(folder, "compile-dom.txt"), "utf8");
const match = dom.match(/<body>SURFACE_REPORT:([^<]+)/);
if (!match) { console.error(`Chrome exited ${code} without a report; see var/surfaces/compile-browser.log`); process.exit(1); }
const report = JSON.parse(match[1]!.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">"));
writeFileSync(join(folder, "compile.json"), JSON.stringify(report, null, 2) + "\n");
console.log(report);
process.exit(report.error || report.problems?.length ? 1 : 0);
