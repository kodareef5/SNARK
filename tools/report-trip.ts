// `bun tools/report-trip.ts [--dist folder] [--canvas 1920x1080@1] [--tier high] [--seconds 10] [--reports folder]`: the
// proof of the debug bar. A development server runs here on the proving ground with a reports folder of its own (a
// temporary one unless --reports names one, never var/reports), and a headless Chrome joins at its spawn. Through the
// DevTools protocol it becomes an admin, presses F3, throws an error in the page, has the server print a line, takes a
// picture of the page at each of the drawer's tabs, waits --seconds and saves a capture with words. The reader's tool
// reads it back, and the trip holds: three pictures or more and the last at full size, none blank; a place within a
// metre of the server's; 300 rows of the record or more, and where a frame went by slot; the page's error and the
// server's line in the log; the socket by category. Then one hitch, at a place, in a part of the frame, with a long task
// of its own after it: the survivor goes a block on, the hitch is chosen half a minute later and F8 saves, and the
// capture must agree on when, where and what. It prints what the bar and a picture cost the game's thread, the bar's
// cost by the browser's count of its main thread's work, and the first frame's bytes beside those the bar fetches.
//
// The client must be built (`bun tools/build-client.ts --quick --dist folder` is enough). --chrome names the browser.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "../server/main.ts";
import { jpegSize } from "../shared/report.ts";
import { PROVING_SPAWN } from "../shared/world/proving.ts";
import { CHROME_FLAGS, findChrome } from "./chrome.ts";
import { devtools } from "./map/trip.ts";
import { firstFrame } from "./sizes.ts";

const ROOT = resolve(import.meta.dir, "..");
const value = (flag: string, otherwise: string): string => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1]! : otherwise;
};
const dist = resolve(value("--dist", join(ROOT, "client/dist")));
const [size, dprText = "1"] = value("--canvas", "1920x1080@1").split("@"), [cssW, cssH] = size!.split("x").map(Number), dpr = Number(dprText);
const tier = value("--tier", "high");
const seconds = Number(value("--seconds", "10"));
const chromePath = value("--chrome", findChrome() ?? "");
if (!existsSync(join(dist, "main.js"))) throw new Error(`no built client in ${dist}: bun tools/build-client.ts --quick --dist ${dist}`);
if (!chromePath) throw new Error("no Chrome found: set CHROME or pass --chrome");
const asked = process.argv.includes("--reports") ? resolve(value("--reports", "")) : "";
if (asked === resolve(ROOT, "var/reports")) throw new Error("var/reports is the owner's: name another folder, such as var/reports-dev");
const reports = asked || mkdtempSync(join(tmpdir(), "snark-report-trip-"));

const results: [string, boolean][] = [];
const hold = (what: string, ok: boolean, detail = ""): void => {
  results.push([what, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
};
const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
const bytesUnder = (dir: string): number => readdirSync(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0);

const log = console.log;
const server = startServer({ dev: true, hostname: "127.0.0.1", port: 0, clientDir: dist, reports });
// The page joins at a place known to the trip, as the map trip has it join on its street.
Object.assign(server.host.world, { spawn: { ...PROVING_SPAWN } });
const profile = mkdtempSync(join(tmpdir(), "snark-report-trip-chrome-"));
const chrome = Bun.spawn([chromePath, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--window-size=${cssW},${cssH}`, `--force-device-scale-factor=${dpr}`, "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
let page: Awaited<ReturnType<typeof devtools>> | null = null;
try {
  page = await devtools(profile);
  const p = page;
  await p.send("Page.enable");
  // The page exactly the size asked for, in points and device pixels, whatever the window keeps of it.
  await p.send("Emulation.setDeviceMetricsOverride", { width: cssW, height: cssH, deviceScaleFactor: dpr, mobile: false });
  // The tier chosen, as the settings keep it (client/core/settings.ts); the bar is off until F3 below.
  await p.send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("snark.interface", ${JSON.stringify(JSON.stringify({ version: 2, tier, debug: false, muted: true }))})` });
  await p.send("Page.navigate", { url: `http://127.0.0.1:${server.port}/?quick=1&name=debug-trip&trip` });
  const until = async <T>(what: string, expression: string, ms: number): Promise<T> => {
    const t0 = performance.now();
    for (;;) {
      const got = await p.value<T>(expression).catch(() => null);
      if (got) return got;
      if (performance.now() - t0 > ms || chrome.exitCode !== null) throw new Error(`${what}: not in ${ms / 1000} s`);
      await Bun.sleep(200);
    }
  };
  const app = "globalThis.snarkTrip?.app", bar = `${app}?.ui.debug`;
  const key = async (code: string, keyCode: number): Promise<void> => {
    for (const type of ["keyDown", "keyUp"]) await p.send("Input.dispatchKeyEvent", { type, code, key: code, windowsVirtualKeyCode: keyCode });
  };
  /** Types `line` into the chat box and sends it, as the owner does. */
  const chat = async (line: string): Promise<void> => {
    await key("Enter", 13);
    await Bun.sleep(300);
    await p.send("Input.insertText", { text: line });
    await Bun.sleep(200);
    await key("Enter", 13);
  };
  const scripts = (): Promise<{ name: string; bytes: number }[]> => p.value(`performance.getEntriesByType("resource").filter((r) => /\\.js$/.test(r.name)).map((r) => ({ name: r.name.slice(r.name.lastIndexOf("/") + 1), bytes: r.encodedBodySize }))`);
  await until("the world drawn", `(${app}?.frames?.rows ?? 0) > 120`, 120_000);
  await Bun.sleep(3000);
  const before = new Set((await scripts()).map((s) => s.name));
  // A development server needs no password to make the page an admin, whose bar saves and hears the server.
  await chat("/enablecheats");
  await until("the session an admin", `${app}.session.admin === true`, 20_000);
  await key("F3", 114);
  await until("the bar on, its drawer open and its port come", `${bar}?.open === true && ${bar}.port !== null`, 30_000);
  await until("the record running", `(${bar}.perf.rows ?? 0) > 240`, 60_000);
  // An error the page meets, and a line the server prints: both belong in the bar's one log.
  await p.send("Runtime.evaluate", { expression: `setTimeout(() => { throw new Error("the trip's page error"); })` });
  console.log("the trip's server line");
  await until("the page's error in the log", `(() => { const d = ${bar}, out = []; d.log.read(out, 7, 3, 50); return out.some((l) => l.text.includes("the trip's page error")); })()`, 10_000);
  await until("the server's line in the log", `(() => { const d = ${bar}, out = []; d.log.read(out, 4, 0, 400); return out.some((l) => l.text.includes("the trip's server line")); })()`, 15_000);
  // A picture of the page at each tab, the drawer open over the world.
  const tabs = await p.value<string[]>(`${bar}.tabs.map((t) => t.name)`);
  for (let i = 0; i < tabs.length; i++) {
    await p.value(`${bar}.show(${i})`);
    await Bun.sleep(1500);
    const shot = await p.send("Page.captureScreenshot", { format: "png" });
    const file = join(reports, `tab-${String(i + 1).padStart(2, "0")}-${tabs[i]!.toLowerCase()}.png`);
    await Bun.write(file, Buffer.from(shot.data, "base64"));
    console.log(`the ${tabs[i]} tab: ${file}`);
  }
  await p.value(`${bar}.show(0)`);
  await Bun.sleep(seconds * 1000);
  const canvas = await p.value<[number, number]>(`[document.querySelector("#view").width, document.querySelector("#view").height]`);
  await chat("/debug save the trip's words: the kerb floats here");
  const saved = await until<string>("the capture saved", `${app}.ui.chat.lines.map((l) => l.text).find((t) => t.startsWith("Debug bar: saved") || t.startsWith("Debug bar: not saved")) ?? ""`, 60_000);
  hold("the page saved a capture", saved.startsWith("Debug bar: saved"), saved);

  // The reader's side, as an agent runs it.
  const tool = (...args: string[]): string => Bun.spawnSync(["bun", join(ROOT, "tools/reports.ts"), "--dir", reports, ...args], { stdout: "pipe", stderr: "pipe" }).stdout.toString();
  const id = Number(/saved capture (\d+)/.exec(saved)?.[1] ?? 1);
  for (const args of [["list"], ["show", String(id)], ["perf", String(id)], ["events", String(id)], ["log", String(id), "errors"], ["net", String(id)]]) console.log(`\n$ bun tools/reports.ts ${args.join(" ")}\n${tool(...args)}`);
  const folder = tool("path", String(id)).trim();
  const report = JSON.parse(readFileSync(join(folder, "report.json"), "utf8"));
  const shots = (report.files as string[]).filter((f) => /^shot-\d+\.jpg$/.test(f));
  const sizes = shots.map((f) => jpegSize(new Uint8Array(readFileSync(join(folder, f)))));
  const wide = Math.min(canvas[0], 2560), last = sizes.at(-1);
  hold(`three pictures or more, the last the canvas's ${canvas[0]}×${canvas[1]} (${wide} wide at most)`, shots.length >= 3 && last?.w === wide, `${shots.length}: ${sizes.map((s) => `${s?.w}×${s?.h}`).join(", ")}`);
  // Not blank: each picture's brightness varies, as the page itself reads it back.
  const spreads: number[] = [];
  for (const f of [shots[0]!, shots.at(-1)!]) {
    const data = readFileSync(join(folder, f)).toString("base64");
    spreads.push(await p.send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `(async () => { const b = await (await fetch("data:image/jpeg;base64,${data}")).blob(); const bm = await createImageBitmap(b); const c = new OffscreenCanvas(64, 36), x = c.getContext("2d"); x.drawImage(bm, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let s = 0, q = 0; for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s += l; q += l * l; } const n = d.length / 4; return Math.sqrt(q / n - (s / n) ** 2); })()` }).then((r) => Number(r.result.value)));
  }
  hold("no picture is blank", spreads.every((s) => s > 4), `brightness spread of the first and the last ${spreads.map((s) => s.toFixed(1)).join(", ")}`);
  const server_ = JSON.parse(readFileSync(join(folder, "server.json"), "utf8"));
  const at = report.place, them = server_.survivor;
  const off = them ? Math.hypot(at.x - them.x, at.y - them.y, at.z - them.z) : Infinity;
  hold("the place is within a metre of the server's", off <= 1, `${off.toFixed(3)} m apart`);
  const perf = JSON.parse(readFileSync(join(folder, "perf.json"), "utf8"));
  const tri = perf.fields.indexOf("triangles"), drawn = (perf.frames as number[][]).filter((r) => r[tri]! > 0).length;
  hold("300 rows of the record or more with triangles", drawn >= 300, `${drawn} of ${perf.frames.length}`);
  hold("where a frame went is kept by slot", (perf.spans?.names ?? []).includes("build") && (perf.spans?.mean?.frames ?? 0) > 0, `${perf.spans?.names?.length ?? 0} slots`);
  const logged = JSON.parse(readFileSync(join(folder, "log.json"), "utf8")).lines as { source: string; level: string; text: string }[];
  hold("the log holds the page's error and the server's line", logged.some((l) => l.source === "page" && l.level === "error" && l.text.includes("the trip's page error")) && logged.some((l) => l.source === "server" && l.text.includes("the trip's server line")), `${logged.length} lines`);
  const net = JSON.parse(readFileSync(join(folder, "net.json"), "utf8"));
  const cats = (net.categories as { name: string }[]).map((c) => c.name);
  hold("the socket is kept by category", cats.includes("bodies") && cats.includes("player"), cats.join(", "));
  hold("the typed words went into the capture", report.text.some((t: { line: string }) => t.line.includes("the kerb floats here")), JSON.stringify(report.text));

  // What the bar and its pictures cost the game's thread.
  const f = (name: string): number => perf.fields.indexOf(name);
  const rows = perf.frames as number[][], flags = (r: number[]): number => r[f("flags")]!;
  const median = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1] ?? 0;
  const shotCalls = rows.filter((r) => (flags(r) & 1) !== 0).map((r) => r[f("shotMs")]!);
  const after = rows.filter((r) => (flags(r) & 2) !== 0).map((r) => r[f("interval")]!);
  const plain = rows.filter((r) => (flags(r) & 3) === 0).map((r) => r[f("interval")]!);
  const isLate = (v: number): boolean => v > 1.25 * perf.summary.target, share = (v: number[]): string => `${((v.filter(isLate).length / Math.max(1, v.length)) * 100).toFixed(0)}%`;
  console.log(`\na picture at a ${canvas[0]}×${canvas[1]} canvas (${cssW}×${cssH} at ${dpr}, ${tier}): its call took ${median(shotCalls).toFixed(2)} ms at the middle, ${Math.max(0, ...shotCalls).toFixed(2)} at most, on the game's thread; of the ${after.length} frames from a picture until it was encoded ${share(after)} were late, against ${share(plain)} of the other ${plain.length} (middle ${median(plain).toFixed(1)} ms)`);
  console.log(`the bar's own clock had it at ${(await p.value<number>(`${bar}.costMs`)).toFixed(3)} ms a frame (its record, its events and its layout, not the interface applied); the GPU was ${perf.summary.gpu.frames > 0 ? `timed in ${perf.summary.gpu.frames} frames, middle ${perf.summary.gpu.middle} ms` : "not timed"}`);
  console.log(`the capture is ${kb(bytesUnder(folder))} in ${readdirSync(folder).length} files`);
  const ff = firstFrame(dist), late = (await scripts()).filter((s) => !before.has(s.name));
  console.log(`the first frame waits for ${kb(ff.first)} of this client (Brotli${dist.endsWith("client/dist") ? "" : "; a quick build's runs about a tenth over a real build's"}); once on, the bar fetched ${late.map((l) => `${l.name} ${kb(l.bytes)}`).join(", ") || "nothing"}, ${kb(late.reduce((n, l) => n + l.bytes, 0))} in all`);

  // One hitch, one story. The dash's part of one frame takes 60 ms; two seconds on, a task of the page's own takes 90 ms
  // between frames. The survivor goes a block on, and half a minute later the hitch is chosen and F8 saves.
  console.log("\none hitch, one story:");
  await p.value(`(() => { const a = ${app}, d = a.dash, step = d.step.bind(d); let once = true; d.step = (f) => { if (once) { once = false; const t = performance.now() + 60; while (performance.now() < t); } step(f); }; return true; })()`);
  await until("the hitch an event", `${bar}.events.list.some((e) => e.kind === 1 && /\\bdash\\b/.test(e.cause))`, 5000);
  const there = await p.value<[number, number, number]>(`[${app}.session.own.x, ${app}.session.own.y, ${app}.session.own.z]`);
  await Bun.sleep(2000);
  await p.send("Runtime.evaluate", { expression: `setTimeout(() => { const t = performance.now() + 90; while (performance.now() < t); })` });
  await Bun.sleep(1000);
  await chat(`/tp ${Math.round(there[0] + 150)} ${Math.round(there[2])}`);
  await until("the survivor a block on", `Math.hypot(${app}.session.own.x - ${there[0]}, ${app}.session.own.z - ${there[2]}) > 100`, 10_000);
  await Bun.sleep(30_000);
  const hitchAt = await p.value<number>(`(() => { const d = ${bar}, e = d.events.list.find((e) => e.kind === 1 && /\\bdash\\b/.test(e.cause)); d.show(0); d.choose(e.at, e); d.show(d.tabs.findIndex((t) => t.name === "Frame")); return e.at; })()`);
  await Bun.sleep(1500);
  const frameShot = join(reports, "hitch-frame.png");
  await Bun.write(frameShot, Buffer.from((await p.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await p.value(`${bar}.show(0)`);
  await Bun.sleep(1500);
  const timelineShot = join(reports, "hitch-timeline.png");
  await Bun.write(timelineShot, Buffer.from((await p.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  console.log(`the chosen hitch in the Frame tab: ${frameShot}; on the timeline: ${timelineShot}`);
  await key("F8", 119);
  const saved2 = await until<string>("the hitch saved", `${app}.ui.chat.lines.map((l) => l.text).find((t) => (t.startsWith("Debug bar: saved") && t !== ${JSON.stringify(saved)}) || t.startsWith("Debug bar: not saved")) ?? ""`, 60_000);
  hold("F8 saved the hitch", saved2.startsWith("Debug bar: saved"), saved2);
  const id2 = Number(/saved capture (\d+)/.exec(saved2)?.[1] ?? 2);
  console.log(`\n$ bun tools/reports.ts show ${id2}\n${tool("show", String(id2))}\n$ bun tools/reports.ts events ${id2}\n${tool("events", String(id2))}`);
  const folder2 = tool("path", String(id2)).trim(), read = (name: string) => JSON.parse(readFileSync(join(folder2, name), "utf8"));
  const report2 = read("report.json"), perf2 = read("perf.json"), events2 = read("events.json").events as { at: number; kind: string; size: number; cause: string; top: { slot: string }[] }[];
  const chosen = report2.chosen, saw = report2.shots[chosen?.shot ?? -1];
  hold("the capture's chosen moment is the hitch", chosen !== undefined && Math.abs(chosen.at - (hitchAt - perf2.start)) < 50 && /\bdash\b/.test(chosen.what), JSON.stringify(chosen));
  const hitch = events2.find((e) => e.kind === "long frame" && /\bdash\b/.test(e.cause)), task = events2.find((e) => e.kind === "long task" && e.size >= 85 && e.at > (hitch?.at ?? 0) + 1000);
  hold("the hitch and the long task are two events, each with its own cause", hitch !== undefined && task !== undefined && !/\bdash\b/.test(task.cause) && /\bdash$/.test(hitch.top[0]?.slot ?? ""), `${JSON.stringify(hitch && [hitch.at, hitch.size, hitch.cause])}, ${JSON.stringify(task && [task.at, task.size, task.cause])}`);
  const near = saw?.place ? Math.hypot(saw.place[0] - there[0], saw.place[2] - there[2]) : Infinity, away = Math.hypot(report2.place.x - there[0], report2.place.z - there[2]);
  hold("its picture was taken where the hitch was, and the save a block on", near < 2 && away > 100, `${near.toFixed(1)} m from the hitch, the save ${away.toFixed(0)} m from it`);
  const names2 = perf2.spans.names as string[], slow2 = perf2.spans.slowest?.[0];
  hold("the slowest frame kept is the hitch's, the dash's 60 ms in it", slow2 !== undefined && slow2.ms[names2.indexOf("dash")] > 55 && Math.abs(slow2.at - chosen.at) < 100, slow2 ? `${slow2.ms[names2.indexOf("dash")]} ms at ${slow2.at}` : "none");
  const md2 = readFileSync(join(folder2, "report.md"), "utf8");
  hold("report.md says the moment and goes back to its picture", md2.includes("## Chosen in the bar") && saw?.place !== undefined && md2.includes(`tp ${saw.place[0].toFixed(2)}`), "");
  hold("each record says what part of the capture it holds", [perf2.window, read("events.json").window, read("log.json").window, read("net.json").window].every((w) => w && w.to === report2.ms), JSON.stringify(perf2.window));

  // What the bar costs the page whole, by the browser's own count of its main thread's work: with the bar off, on with
  // its drawer shut, and open at a tab, five seconds each, twice over.
  console.log("\nwhat the bar costs the page's main thread a frame, by the browser's count:");
  await p.send("Performance.enable");
  await p.value(`(() => { globalThis.tripFrames = 0; const f = () => { globalThis.tripFrames++; requestAnimationFrame(f); }; requestAnimationFrame(f); return true; })()`);
  const modes: [string, string][] = [
    ["off", `${app}.ui.settings.debug = false`],
    ["on, drawer shut", `(${app}.ui.settings.debug = true, ${bar}?.close(), true)`],
    ["on, Timeline open", `(${bar}.show(0), true)`],
    ["on, Frame open", `(${bar}.show(${bar}.tabs.findIndex((t) => t.name === "Frame")), true)`],
    ["on, Network open", `(${bar}.show(${bar}.tabs.findIndex((t) => t.name === "Network")), true)`],
  ];
  const metric = async (): Promise<Record<string, number>> => Object.fromEntries(((await p.send("Performance.getMetrics")).metrics as { name: string; value: number }[]).map((m) => [m.name, m.value]));
  const costs = new Map<string, number[]>();
  for (let round = 0; round < 2; round++) {
    for (const [name, set] of modes) {
      await p.value(set);
      await Bun.sleep(1500);
      const a = await metric(), fa = await p.value<number>("globalThis.tripFrames");
      await Bun.sleep(5000);
      const b = await metric(), fb = await p.value<number>("globalThis.tripFrames"), frames = Math.max(1, fb - fa);
      const per = (k: string): number => ((b[k]! - a[k]!) * 1000) / frames;
      const task = per("TaskDuration");
      costs.set(name, [...(costs.get(name) ?? []), task]);
      console.log(`  ${name.padEnd(18)} ${task.toFixed(2)} ms of tasks a frame (script ${per("ScriptDuration").toFixed(2)}, style and layout ${(per("RecalcStyleDuration") + per("LayoutDuration")).toFixed(2)}) over ${frames} frames, ${((frames * 1000) / 5000).toFixed(0)} fps`);
    }
  }
  const mean = (name: string): number => (costs.get(name) ?? [0]).reduce((s, v) => s + v, 0) / Math.max(1, costs.get(name)?.length ?? 1);
  console.log(`  the bar's cost against off: ${modes.slice(1).map(([n]) => `${n} ${(mean(n) - mean("off")).toFixed(2)} ms`).join(", ")}`);
} catch (err) {
  hold("the trip ran to its end", false, err instanceof Error ? err.message : String(err));
} finally {
  console.log = log;
  page?.close();
  chrome.kill();
  await chrome.exited;
  server.stop();
  rmSync(profile, { recursive: true, force: true });
  if (!asked && !process.argv.includes("--keep")) rmSync(reports, { recursive: true, force: true });
  else console.log(`reports kept in ${reports}`);
}
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed === 0 ? `all ${results.length} held` : `${failed} of ${results.length} failed`);
process.exit(failed === 0 ? 0 : 1);
