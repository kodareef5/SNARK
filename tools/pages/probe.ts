// The optional pages mode of the repository's browser probe; it is not a test-suite dependency or a game boot.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveGuide } from "./serve.ts";

export async function guideProbe(chrome: string): Promise<boolean> {
  const root = resolve(import.meta.dir, "../..");
  const artifact = join(root, "artifacts/pages/probe");
  mkdirSync(artifact, { recursive: true });
  const server = serveGuide(join(root, "dist/guide"), 0);
  const profile = mkdtempSync(join(tmpdir(), "snark-pages-probe-"));
  const browser = Bun.spawn([chrome, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--remote-debugging-port=0", "--window-size=1440,1000", `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: Bun.file(join(artifact, "browser.log")) });
  const errors: string[] = [], checks: Record<string, unknown> = {};
  let ws: WebSocket | null = null, nextId = 1;
  const pending = new Map<number, { done: (value: any) => void; fail: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  const until = async (work: () => Promise<boolean>): Promise<void> => {
    const deadline = Date.now() + 45000;
    while (!await work()) { if (Date.now() > deadline) throw new Error("browser condition did not complete"); await Bun.sleep(100); }
  };
  const command = (method: string, params: object = {}): Promise<any> => new Promise((done, fail) => {
    const id = nextId++;
    const timeout = setTimeout(() => { pending.delete(id); fail(new Error(`${method} timed out`)); }, 20000);
    pending.set(id, { done, fail, timeout }); ws!.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression: string): Promise<any> => {
    const r = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const navigate = async (path: string): Promise<void> => {
    await command("Page.navigate", { url: `http://localhost:${server.port}${path}` });
    await until(async () => Boolean(await evaluate(`location.pathname===${JSON.stringify(path.split("?")[0])}&&document.readyState==='complete'`)));
    await evaluate("document.fonts.ready.then(()=>Promise.all([...document.images].filter(i=>i.loading!=='lazy').map(i=>i.complete?null:i.decode().catch(()=>null))))");
  };
  const click = async (selector: string): Promise<void> => {
    const box = await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('missing control');n.scrollIntoView({block:'center'});const b=n.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}})()`);
    await command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...box });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...box });
  };
  const shot = async (name: string): Promise<void> => {
    const r = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(artifact, `${name}.png`), Buffer.from(r.data, "base64"));
  };
  try {
    await until(async () => existsSync(join(profile, "DevToolsActivePort")));
    const port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
    ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
    await new Promise<void>((done, fail) => { ws!.onopen = () => done(); ws!.onerror = () => fail(new Error("browser socket failed")); });
    ws.onmessage = (event) => {
      const r = JSON.parse(String(event.data));
      if (r.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(r.params.exceptionDetails));
      if (r.method === "Log.entryAdded" && r.params.entry.level === "error") errors.push(r.params.entry.text);
      const item = pending.get(r.id); if (!item) return;
      clearTimeout(item.timeout); pending.delete(r.id);
      if (r.error) item.fail(new Error(JSON.stringify(r.error))); else item.done(r.result);
    };
    await command("Page.enable"); await command("Runtime.enable"); await command("Log.enable");
    await navigate("/"); await shot("overview-desktop");
    checks.overview = await evaluate("({title:document.title,overflow:document.documentElement.scrollWidth>innerWidth,bytes:performance.getEntriesByType('resource').reduce((n,r)=>n+r.transferSize,0),modelsLoaded:performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.snpk')).length})");
    await navigate("/search/?q=pteranodon");
    checks.search = await evaluate("({visible:document.querySelectorAll('[data-record]:not([hidden])').length,text:document.querySelector('[data-result-count]')?.textContent})");
    await navigate("/maps/core/miami/");
    await click('[data-map-zoom="in"]'); await click("[data-layer-toggle]");
    checks.map = await evaluate("({zoom:document.querySelector('[data-map-scale]').textContent,visibleLayers:document.querySelectorAll('[data-map-layer]:not([hidden])').length})");
    await shot("map-desktop");
    await navigate("/creatures/core/pteranodon/"); await shot("creature-poster");
    await click("[data-view-model]");
    await until(async () => Boolean(await evaluate("document.querySelector('.model-select')&&/Rest pose|frames/.test(document.querySelector('.model-status')?.textContent||'')")));
    await evaluate("(()=>{const s=document.querySelector('.model-select');s.value=[...s.options].find(o=>o.value.endsWith('/fly'))?.value||s.options[1].value;s.dispatchEvent(new Event('change',{bubbles:true}))})()");
    await until(async () => Boolean(await evaluate("document.querySelector('.model-status')?.textContent.includes('frames')")));
    const timeline = await evaluate("Number(document.querySelector('.model-timeline').value)");
    await until(async () => Number(await evaluate("Number(document.querySelector('.model-timeline').value)")) !== timeline);
    checks.model = await evaluate("({clips:document.querySelector('.model-select').options.length-1,status:document.querySelector('.model-status').textContent,frame:Number(document.querySelector('.model-timeline').value),bytes:performance.getEntriesByType('resource').reduce((n,r)=>n+r.transferSize,0),sameOrigin:performance.getEntriesByType('resource').every(r=>new URL(r.name).origin===location.origin)})");
    const beforeAnimation = await evaluate("({scroll:scrollY,clip:document.querySelector('.model-select').value})");
    await evaluate("document.querySelector('[aria-label=\"Next animation\"]').click()");
    await until(async () => Boolean(await evaluate(`document.querySelector('.model-select').value!==${JSON.stringify(beforeAnimation.clip)}&&document.querySelector('.model-status')?.textContent.includes('frames')`)));
    checks.animation = await evaluate("({scroll:scrollY,clip:document.querySelector('.model-select').value})");
    if (Math.abs((checks.animation as any).scroll - beforeAnimation.scroll) > 1) errors.push("animation selection moved the page");
    await evaluate("(()=>{const r=document.querySelector('.model-timeline');r.value=String(Number(r.max)/2);r.dispatchEvent(new Event('input',{bubbles:true}))})()");
    checks.scrub = await evaluate("({value:Number(document.querySelector('.model-timeline').value),play:document.querySelector('.model-animation .model-button:not([aria-label])')?.textContent||[...document.querySelectorAll('.model-animation button')].find(b=>b.textContent==='Play')?.textContent})");
    if ((checks.scrub as any).value <= 0 || (checks.scrub as any).play !== "Play") errors.push("animation scrubbing did not pause playback");
    await shot("model-desktop");
    await navigate("/sounds/core/dodo/");
    checks.audio = await evaluate("(async()=>{const a=document.querySelector('audio');await a.play();return{preload:a.preload,paused:a.paused,source:a.currentSrc}})()");
    await navigate("/mcp/");
    await shot("mcp-desktop");
    await evaluate("(()=>{const q=document.querySelector('[data-filter-query]');q.value='go_to';q.dispatchEvent(new Event('input',{bubbles:true}))})()");
    checks.mcp = await evaluate("({visible:document.querySelectorAll('[data-record]:not([hidden])').length,overflow:document.documentElement.scrollWidth>innerWidth})");
    if ((checks.mcp as any).visible < 1 || (checks.mcp as any).visible > 4 || (checks.mcp as any).overflow) errors.push("MCP filtering or layout failed");
    await command("Browser.grantPermissions", { origin: `http://localhost:${server.port}`, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
    await click('[data-copy-target="mcp-command"]');
    await until(async () => Boolean(await evaluate("document.querySelector('[data-copy-target=\"mcp-command\"]').textContent.includes('Copied')")));
    checks.copy = await evaluate("navigator.clipboard.readText()");
    if (!(checks.copy as string).includes("bun agent/main.ts")) errors.push("MCP copy control failed");
    await navigate("/commands/");
    checks.commands = await evaluate("({records:document.querySelectorAll('[data-record]').length,title:document.title,overflow:document.documentElement.scrollWidth>innerWidth})");
    await shot("commands-desktop");
    await navigate("/maps/core/miami/settings/");
    checks.settings = await evaluate("({iniLinks:[...document.querySelectorAll('a[href]')].filter(a=>a.pathname.endsWith('.ini')).length,overflow:document.documentElement.scrollWidth>innerWidth})");
    await shot("settings-desktop");
    if ((checks.settings as any).iniLinks < 1 || (checks.settings as any).overflow || (checks.commands as any).overflow) errors.push("reference pages failed");
    await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate("/"); await shot("overview-mobile");
    checks.mobile = await evaluate("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth})");
    await navigate("/mcp/go_to/"); await shot("mcp-mobile");
    checks.mobileReference = await evaluate("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth})");
    if ((checks.mobileReference as any).overflow) errors.push("mobile tool reference overflows");
    if (checks.overview && (checks.overview as any).modelsLoaded !== 0) errors.push("overview eagerly fetched a model");
    if ((checks.mobile as any).overflow || (checks.overview as any).overflow) errors.push("page overflows its viewport");
    if ((checks.search as any).visible < 1 || (checks.search as any).visible > 20) errors.push("search filtering failed");
    if ((checks.map as any).visibleLayers < 1 || (checks.map as any).zoom === "100%") errors.push("map controls failed");
  } catch (error) { errors.push(String(error)); }
  finally {
    for (const p of pending.values()) clearTimeout(p.timeout);
    ws?.close(); browser.kill(); await browser.exited; server.stop(true); rmSync(profile, { recursive: true, force: true });
  }
  const report = { passed: errors.length === 0, checks, errors };
  writeFileSync(join(artifact, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  return report.passed;
}
