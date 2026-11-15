// What the device probe says: which device it takes itself to be on, what a renderer may count on there, the pages the
// owner taps, and the report as lines of plain text, which the page shows and tools/device.ts prints.

import type { Axis, DeviceReport, GpuInfo, Mode, PhaseReport, TerrainRung } from "./device.ts";
import { AXES, FLIGHT_TIER_COUNT, LONG, MODES, RUNGS, formatsOf } from "./device.ts";
import { TIERS } from "./assets/tiers.ts";
import { FRAME_BLOCK_BYTES } from "./devicegpu.ts";
import { FAR_FROM } from "./render/camera.ts";
import { UNIT } from "./render/programs.ts";

const yes = (b: unknown): string => (b ? "yes" : "no");
const mb = (bytes: number): string => (bytes / 1048576).toFixed(1);
const secs = (ms: number): string => (ms / 1000).toFixed(1);
const tenth = (x: number): number => Math.round(x * 10) / 10;
const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const count = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
const pct = (share: number): string => `${(share * 100).toFixed(1)}%`;
const signed = (x: number): string => `${x >= 0 ? "+" : ""}${tenth(x)}`;

/** Text made safe to put in HTML. */
export function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The device, browser and system a user agent names, in words. Every browser on iOS draws with WebKit, which it says. */
export function identify(ua: string, touch: number): string {
  const ios = /\b(iPhone|iPad|iPod)\b.*?OS (\d+)[_.](\d+)/.exec(ua);
  const android = /Android ([\d.]+)/.exec(ua);
  const mac = /Macintosh/.test(ua);
  const device = ios ? `an ${ios[1]}` : android ? "an Android device" : mac ? (touch > 1 ? "an iPad asking for desktop pages" : "a Mac") : /Windows/.test(ua) ? "a Windows computer" : /CrOS/.test(ua) ? "a Chromebook" : /Linux/.test(ua) ? "a Linux computer" : "a device it does not know";
  const system = ios ? `iOS ${ios[2]}.${ios[3]}` : android ? `Android ${android[1]}` : mac ? "macOS" : "";
  const named: [RegExp, string][] = [[/HeadlessChrome\/(\d+)/, "headless Chrome"], [/CriOS\/(\d+)/, "Chrome for iOS"], [/FxiOS\/(\d+)/, "Firefox for iOS"], [/EdgiOS\/(\d+)/, "Edge for iOS"], [/Edg\/(\d+)/, "Edge"], [/SamsungBrowser\/(\d+)/, "Samsung Internet"], [/Firefox\/(\d+)/, "Firefox"], [/Chrome\/(\d+)/, "Chrome"], [/Version\/(\d+[.\d]*).*Safari/, "Safari"]];
  const found = named.map(([re, name]) => [re.exec(ua), name] as const).find(([m]) => m);
  const app = /FBAN|FBAV|Instagram|Line\/|GSA\/|Snapchat/.test(ua) || (ios !== null && !/Safari\//.test(ua));
  const browser = app ? "an app's own browser" : found ? `${found[1]} ${found[0]![1]}` : "a browser it does not know";
  return [device, browser + (ios ? " (WebKit, as every iOS browser)" : ""), system].filter((s) => s !== "").join(", ");
}

/** What a renderer may count on, in a line a designer can read: the targets lighting can draw to and filter, and the limits. */
export function limitsLine(g: GpuInfo): string {
  const has = (e: string): boolean => g.extensions.includes(e);
  const float32 = `32-bit float targets ${yes(has("EXT_color_buffer_float"))}, filtered ${yes(has("OES_texture_float_linear"))}, blended ${yes(has("EXT_float_blend"))}`;
  const float16 = `16-bit float targets ${yes(has("EXT_color_buffer_half_float") || has("EXT_color_buffer_float"))}, filtered yes`;
  return `${float16}; ${float32}; antialiasing up to ${g.maxSamples}x; ${g.drawBuffers} targets at once; ${g.textureUnits} textures a draw, ${g.vertexTextures} in vertex shaders; textures to ${g.maxTexture} px; anisotropy ${g.anisotropy || "none"}; depth buffer ${g.depthBits} bits; reversed depth ${yes(has("EXT_clip_control"))}; GPU timers ${yes(has("EXT_disjoint_timer_query_webgl2"))}; multi-draw ${yes(has("WEBGL_multi_draw"))}; compressed ${formatsOf(g.extensions).join(" ") || "none"}`;
}

/** The device as its page sees it: what it is, and its screen. */
function onThis(g: Record<string, unknown>): string {
  const nav = (g.navigator ?? {}) as { userAgent?: string; maxTouchPoints?: number };
  const screen = (g.screen ?? {}) as { width?: number; height?: number };
  return `${identify(nav.userAgent ?? "", nav.maxTouchPoints ?? 0)}, ${screen.width ?? "?"} by ${screen.height ?? "?"} at ${g.devicePixelRatio ?? "?"}x`;
}

const TESTS: Readonly<Record<Mode, string>> = { quick: "Quick look, about 3 minutes", ladder: "Load ladder, about 5 minutes", soak: "Soak, 10 minutes", terrain: "Terrain flight, about 3 minutes" };
const buttons = (modes: readonly Mode[]): string => modes.map((m) => `<button data-mode="${m}" style="display:block;width:100%;max-width:26em;margin:10px 0;padding:14px;font:inherit;font-size:17px;border-radius:10px;border:0;background:#2a6;color:#fff">${TESTS[m]}</button>`).join("");

/** What a page shows before a test: the device it takes itself to be on, and the tests to tap. */
export function startPage(_r: DeviceReport, g: Record<string, unknown>, modes: readonly Mode[] = MODES): string {
  return `<div style="max-width:34em"><p><b>SNARK device probe</b></p><p>This looks like <b>${escape(onThis(g))}</b>. If that is not the device you meant to test, close this page: nothing has started.</p><p><b>Tap a test to start it.</b> The tap also keeps the screen on. Then leave the device be, screen on, until it says Done.</p>${buttons(modes)}</div>`;
}

/** What a page shows when a test is done, or stopped: the report, and the tests to tap next. */
export function donePage(r: DeviceReport, g: Record<string, unknown>, status: string, modes: readonly Mode[] = MODES): string {
  const early = r.errors.length > 0 || r.reloadedDuring !== null;
  return `<div style="max-width:34em"><p><b>${early ? "Stopped early" : "Done"}.</b> ${escape(status)}</p><p>This was ${escape(onThis(g))}. Tap another test, or close the page.</p>${buttons(modes)}</div><pre style="font:11px ui-monospace,Menlo,monospace;white-space:pre;overflow:auto;margin-top:16px">${escape(deviceTable(r).join("\n"))}</pre>`;
}

/** The line over the game while a test goes on. */
export function progressText(mode: Mode, stage: string, detail: string): string {
  return escape(`${TESTS[mode].replace(/,.*/, "")}: ${stage}${detail ? `, ${detail}` : ""}\nKeep this page open and the screen on until it says Done.`);
}

const WIDTHS = [8, 7, 10, 6, 7, 7, 7, 7, 6, 6, 6, 6, 7, 5, 5, 5, 5, 6, 5, 5];
const row = (cells: string[], widths = WIDTHS): string => cells.map((c, i) => (i < 2 || (widths === WIDTHS && i === 2) ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join(" ").trimEnd();

function phaseRow(p: PhaseReport, tier = p.tier): string {
  const line = row([tier, p.scene, p.canvas.join("x"), `${secs(p.settleMs)}${p.settled ? "" : "!"}`, String(p.frameMs.median), String(p.frameMs.p95), String(p.frameMs.p99), String(p.frameMs.worst), String(p.buildMs.median), String(p.drawMs.median), p.gpuMs == null ? "-" : String(p.gpuMs), count(p.drawCalls), count(p.triangles), count(p.textured), String(p.dropped), String(p.skipped), String(p.lost), mb(p.fetched), String(p.failed), String(p.missed)]);
  const failed = [p.failedHow ? `fetches failed: ${p.failedHow}` : "", p.refused > 0 ? `${p.refused} uploads the card refused` : ""].filter((w) => w !== "").join("; ");
  return `${line}${p.fellTo ? `  fell to ${p.fellTo}` : ""}${failed ? `  ${failed}` : ""}`;
}

/**
 * The tiers that drew with materials, and those that have materials but drew none. A draw counts as with materials only
 * once the card holds them, so a tier that has them and drew none never had its textures arrive or taken.
 */
export function materialsLacking(r: DeviceReport): { drawn: string[]; lacking: string[] } {
  const shown = [...r.phases, ...(r.ladder?.rungs ?? [])].map((p) => ("textured" in p ? { tier: p.tier, mat: p.textured } : { tier: p.tier, mat: p.mat }));
  if (r.soak && !r.soak.wood) shown.push({ tier: r.soak.tier, mat: Math.max(0, ...r.soak.minutes.map((m) => m.mat ?? 0)) });
  const drawn = [...new Set(shown.filter((p) => p.mat > 0).map((p) => p.tier))];
  const textured = new Set<string>(TIERS.filter((t) => t.texture > 0).map((t) => t.name));
  return { drawn, lacking: [...new Set(shown.map((p) => p.tier))].filter((t) => textured.has(t) && !drawn.includes(t)) };
}

function materialsLine(r: DeviceReport): string {
  const { drawn, lacking } = materialsLacking(r);
  const made = drawn.length === 0 ? "" : r.texturesMade > 0 ? `drawn on ${drawn.join(", ")}: the renderer made ${r.texturesMade} textures` : `drawn on ${drawn.join(", ")}, but the renderer made no textures`;
  const lack = lacking.length === 0 ? "" : `none drawn on ${lacking.join(", ")}, which have them: a lack, as their textures never arrived or the card refused them`;
  return [made, lack].filter((w) => w !== "").join("; ") || "none asked for: no tier with materials ran";
}

/** The ladder for each tier: per axis the most that held the display's rate, and the first that did not, with why. */
function ladderLines(r: DeviceReport): string[] {
  const l = r.ladder ?? { display: r.idleFrameMs ?? 0, rungs: [], memory: null };
  const out = [`ladder    a rung holds when its median frame is within 12% of the display's ${l.display} ms and its 95th within 50%`];
  const tiers = [...new Set(l.rungs.map((g) => g.tier))];
  const cell = (tier: string, axis: Axis): string => {
    const mine = l.rungs.filter((g) => g.tier === tier && g.axis === axis);
    const held = mine.filter((g) => g.held).at(-1);
    const broke = mine.find((g) => !g.held);
    if (mine.length === 0) return "not run";
    if (!broke) return `all ${held!.n}, ours ${tenth(held!.buildMs + held!.drawMs)} ms`;
    return `${held ? held.n : "none"}; ${broke.n} ${broke.invalid ? "invalid" : broke.limit}`;
  };
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(i === 0 ? 8 : 24)).join(" ").trimEnd();
  out.push(line(["tier", ...AXES]));
  for (const tier of tiers) out.push(line([tier, ...AXES.map((a) => cell(tier, a))]));
  out.push("each: the most that held, and then the first that did not and what took its frame (our code, the GPU, or a lost context),");
  out.push("or invalid where it did not draw all it was given or never settled, so its frames prove nothing;");
  out.push("where all held: our code's ms a frame at the last rung, which is the engine's most for bodies, draws and pieces");
  for (const g of l.rungs.filter((x) => !x.held)) out.push(`${g.invalid ? "invalid  " : "broke    "} ${g.tier} ${g.axis} ${g.n}: ${g.invalid ? `${g.invalid}; ` : ""}frames ${g.frameMs.median} ms, 95th ${g.frameMs.p95}; our code ${g.buildMs} + ${g.drawMs} ms; ${count(g.calls)} draws, ${count(g.tris)} triangles, ${count(g.bones)} bones, ${g.mat} with materials, canvas ${g.canvas.join("x")}`);
  const top = (axis: Axis): string => count(Math.max(0, ...l.rungs.filter((g) => g.axis === axis && g.held).map((g) => (axis === "triangles" ? g.tris : axis === "draws" ? g.calls : g.n))));
  out.push(`most held ${top("bodies")} bodies, ${top("pieces")} pieces, ${top("triangles")} triangles, ${top("draws")} draws, on any tier; the rungs: ${AXES.map((a) => `${a} ${RUNGS[a].join(" ")}`).join("; ")}`);
  const m = l.memory;
  const crashed = r.reloadedDuring?.startsWith("memory") ? r.reloadedDuring.replace("memory ", "") : null;
  const slow = m?.slowMB == null ? "every amount kept the display's rate" : `frames first fell behind the display's rate at ${m.slowMB} MB`;
  const held = m ? `${m.heldMB} MB of ${m.variant} textures held and sampled besides the game's ${m.gameMB} MB; ${slow}; frames ${m.rungs.map((x) => `${x.mb} MB ${x.frameMs}${x.held === false ? "!" : ""} ms`).join(", ") || "none"}` : "none held";
  if (m || crashed) out.push(`memory    ${held}; ${crashed ? `the page was reloaded while it took ${crashed} of textures: the browser dropped the tab` : m!.failedMB !== null ? `at ${m!.failedMB} MB: ${m!.how}` : m!.how}`);
  return out;
}

/** The GPU questions' answers, and a pass's time a line each. */
function gpuLines(r: DeviceReport): string[] {
  const q = r.gpuTests!;
  const g = r.gpu;
  const gap = (m: number | null, at: string): string => (m === null ? `no gap tried at ${at}` : `${m} m at ${at}`);
  const out = [`depth     depthRange ${q.depthRange}; quads drawn in order ${gap(q.nearGap, "380 m in the near range")} apart, ${gap(q.farGap, "2 km in the far")}`];
  const s = q.seam;
  out.push(`seam      ${typeof s === "string" ? s : `D1's slope over 60 turning frames, the seam crossing ${s.crossing} pixels: ${s.overlap} left the clear colour with the far range from ${FAR_FROM * 100}% of the split, as the game draws, and ${s.flush} with it from the split itself`}`);
  out.push(`shadows   a 16-bit depth array ${q.depthArray}; compared lookups in it ${q.compareArray}, in a plain depth texture ${q.compare2d}; an RGBA8 3D texture ${q.texture3d}`);
  const e = q.farEdge;
  out.push(`far edge  ${typeof e === "string" ? e : `the far blocks' dithered edge keeps ${pct(e.kept)} of a wall halfway through the fade, where the rule keeps ${pct(e.rule)}`}`);
  if (g) {
    const units = Math.max(...Object.values(UNIT)) + 1;
    out.push(`units     ${g.textureUnits} textures a draw in fragments, ${g.vertexTextures} in vertices, ${g.combinedUnits} in all; the renderer uses units 0 to ${units - 1}, the terrain window 11 and 12, so ${g.textureUnits >= units ? "they fit" : "they do not fit"}`);
    out.push(`uniforms  a block holds ${g.uniformBytes} bytes, and the frame block takes ${FRAME_BLOCK_BYTES}; ${g.uniformBlocks[0]} blocks a vertex program, ${g.uniformBlocks[1]} a fragment one; ${g.uniformBindings} bindings; offsets in steps of ${g.uniformAlign}`);
  }
  out.push(`gpu time  ${q.timers ? "by timer queries, and" : "no timer queries here, so only"} by the slope of time against k passes timed across a readback, with its standard error`);
  const widths = [18, 15, 8, 8, 7, 5];
  out.push(row(["pass", "per", "timer", "slope", "+-", "k"], widths));
  const n = (x: number | null): string => (x === null ? "-" : String(x));
  for (const p of q.passes) out.push(row([p.name, p.per === "draw" ? "µs a draw" : `ms a ${p.per === "megapixel" ? "megapixel" : "100k tris"}`, n(p.timer), n(p.slope), n(p.error), String(p.k)], widths) + (p.note ? `  ${p.note}` : ""));
  const slope = (name: string): number | null => q.passes.find((p) => p.name === name)?.slope ?? null;
  const [lit, shadowed, depth] = [slope("lit"), slope("lit shadowed"), slope("depth rigid 2048")];
  const mp = (q.screen[0]! * q.screen[1]!) / 1e6;
  if (lit !== null && shadowed !== null) out.push(`shadowed  LIT looking the sun's shadow up costs ${round3(shadowed - lit)} ms a megapixel more than LIT: ${round3((shadowed - lit) * mp)} ms over this screen's ${mp.toFixed(2)} megapixels; and a cascade of 100k triangles drawn 2,048 square ${depth ?? "?"} ms`);
  out.push(`full screen at ${q.screen.join("x")}, blended, the game's programs under noon's frame block: flat, lit and far on a wall 12 m off, lit hazed`);
  out.push("on one 500 m and 3.5 km off, surface with five maps 512 square; the sky looking 14 degrees up toward the sun, its table alone,");
  out.push("then with the sun, moon and stars and 0, 1 and 2 cloud layers 1,024 square; the sea 2 m deep from 10 m up, calm and with");
  out.push("waves 256 square, and lit where it is. depth into a 16-bit depth array; lit shadowed looks up medium's shadow in the");
  out.push("2,048 one; a draw is a uniform, a vertex array, a buffer, two pointers and the draw");
  if (q.lostDuring) out.push(`lost      the graphics context was lost during ${q.lostDuring}`);
  return out;
}

/** The terrain flight (D253): each tier's frames, and those that carried window rows against those that did not. */
function terrainLines(r: DeviceReport): string[] {
  const t = r.terrain!;
  const mb = (b: number): string => (b / 1e6).toFixed(2);
  const out = [`terrain   a map ${(t.side / 1000).toFixed(1)} km across; its pictures ${mb(t.groundBytes)} MB on the card, of ${mb(t.reservedBytes)} MB reserved for what is not an asset; ${t.flights.length} of ${FLIGHT_TIER_COUNT} tiers flown`];
  out.push(`          flown 60 m over the ground at 100 m a second, turning, with a jump every ${"10"} s of 2 km or more`);
  const widths = [8, 6, 7, 6, 6, 7, 5, 7, 7, 6, 11, 11, 9, 7];
  out.push(row(["tier", "frames", "median", "p95", "p99", "worst", "rows", "worst", "median", "ratio", "draw", "gpu", "jumps", "coarser"], widths));
  const n = (x: number | null): string => (x === null ? "-" : String(x));
  for (const f of t.flights) {
    const ratio = f.plainMedian > 0 ? (f.windowWorst / f.plainMedian).toFixed(2) : "-";
    out.push(row([f.tier, String(f.frames), String(f.frameMs.median), String(f.frameMs.p95), String(f.frameMs.p99), String(f.frameMs.worst), String(f.windowFrames), String(f.windowWorst), String(f.plainMedian), ratio, `${f.drawWindow}/${f.drawPlain}`, `${n(f.gpuWindow)}/${n(f.gpuPlain)}`, f.fills.map((x) => (x < 0 ? "!" : String(x))).join(" "), String(f.coarser)], widths));
  }
  out.push("rows: frames that carried rows of the terrain window; worst: theirs; median: of frames that carried none; ratio: the one");
  out.push("over the other, which D253 holds under 2. draw and gpu: medians with rows/without, our code's ms handing the frame to");
  out.push("WebGL and the GPU's by timer query. jumps: frames until each jump's window was in (! for not before the next); coarser:");
  out.push("tiles drawn a level coarser a frame while it came");
  if (t.far.length === 0) return out;
  out.push(`far       bases as blocks at medium in chunks within 2 km of the map's middle, the camera 30 m up turning once round in 2 s; a rung holds as the ladder's do`);
  const fw = [8, 8, 7, 6, 6, 6, 6, 6, 6, 5, 6];
  out.push(row(["chunks", "held", "median", "p95", "worst", "build", "draw", "calls", "tris", "far", "gpu"], fw));
  const held = (g: TerrainRung): string => (g.invalid ? "invalid" : g.held ? "yes" : g.limit === "the GPU" ? "GPU" : g.limit === "our code" ? "ours" : g.limit);
  for (const g of t.far) {
    out.push(row([g.chunks === g.asked ? String(g.asked) : `${g.chunks}/${g.asked}`, held(g), String(g.frameMs.median), String(g.frameMs.p95), String(g.frameMs.worst), String(g.buildMs), String(g.drawMs), count(g.calls), count(g.tris), String(g.farDraws), g.gpuMs === null ? "-" : String(g.gpuMs)], fw));
  }
  out.push("far: far draws a frame; gpu: the GPU's ms for a frame by timer query; held: GPU or ours for what took a frame that broke");
  for (const g of t.far.filter((x) => x.invalid)) out.push(`invalid   far ${g.asked}: ${g.invalid}`);
  if (t.wood.length === 0) return out;
  out.push("wood      the map's trees, rocks and bushes, 160 slots a chunk, to each tier's reach, from eye height at its middle, turning");
  out.push(row(["tier", "held", "median", "p95", "worst", "build", "draw", "calls", "tris", "nodes", "gpu"], fw));
  for (const g of t.wood) out.push(row([g.tier, held(g), String(g.frameMs.median), String(g.frameMs.p95), String(g.frameMs.worst), String(g.buildMs), String(g.drawMs), count(g.calls), count(g.tris), String(g.nodeDraws), g.gpuMs === null ? "-" : String(g.gpuMs)], fw));
  out.push(`nodes: far node draws a frame; trees reach ${t.wood.map((g) => `${g.reach} m on ${g.tier}`).join(", ")}`);
  for (const g of t.wood.filter((x) => x.invalid)) out.push(`invalid   wood ${g.tier}: ${g.invalid}`);
  return out;
}

function soakLines(r: DeviceReport): string[] {
  const s = r.soak!;
  const l = s.load;
  const what = s.wood ? "" : `${l.bodies} bodies, ${l.pieces} pieces, ${l.near} rocks near, ${l.far} far${l.stress ? ", the stress meshes" : ""}, `;
  const out = [`soak      ${s.tier}: ${what}turning once a minute (${s.from}), ${s.cascades > 0 ? `shadows on in ${s.cascades} cascades` : "no shadows"}; ${s.minutes.length} of ${s.minutesWanted} minutes`];
  const widths = [6, 7, 7, 7, 7, 7, 6, 6, 5, 5, 5];
  out.push(row(["minute", "frames", "median", "p95", "p99", "worst", "build", "draw", "mat", "long", "miss"], widths));
  for (const m of s.minutes) out.push(row([String(m.minute), String(m.frames), String(m.frameMs.median), String(m.frameMs.p95), String(m.frameMs.p99), String(m.frameMs.worst), String(m.buildMs), String(m.drawMs), String(m.mat ?? "?"), String(m.long ?? "?"), String(m.missed)], widths));
  out.push(`mat: the most draws with materials in a frame. long: frames of ${LONG} display intervals or more while the page was shown;`);
  out.push("time it was hidden is left out, a stall is not");
  const [first, final] = [s.minutes[0], s.minutes.at(-1)];
  if (first && final && final !== first) out.push(`warming   minute ${final.minute} against minute 1: frames ${final.frameMs.median} against ${first.frameMs.median} ms, 95th ${final.frameMs.p95} against ${first.frameMs.p95}, our code ${final.buildMs} against ${first.buildMs} ms`);
  out.push(`screen    ${s.hidden === 0 ? "never hidden" : `hidden ${s.hidden} times, ${secs(s.hiddenMs)} s in all; the soak's clock stopped while it was and went on after`}; wake lock ${r.wakeLock}`);
  return out;
}

/** The link: round trips, what was missed and where, and what the server says it held back, in words to act on. */
function linkLines(r: DeviceReport): string[] {
  const l = r.link;
  const measured = Math.max(0, l.missed - l.missedLoading - l.missedHidden);
  const held = l.server ? (l.server.skipped + l.server.overflows === 0 ? "the server held none back" : `the server held back ${l.server.skipped} for a full link and ${l.server.overflows} too large to send, for every page it serves`) : "the server did not say what it held back";
  const out = [`link      a request ${l.httpMs ? `${l.httpMs.median} ms there and back, worst ${l.httpMs.worst}` : "?"}; the game's own measure ${l.gameMs ? `${l.gameMs.median} ms, worst ${l.gameMs.worst}` : "?"}; longest wait for a snapshot ${l.longestGapMs} ms`];
  out.push(`snapshots ${l.snapshots} since the first; missed ${l.missed}: ${l.missedLoading} while the game loaded, ${l.missedHidden} while the page was hidden, ${measured} while tests ran; ${held}`);
  if (l.clockJumps > 0) out.push(`          ${l.clockJumps} clock jumps: the game moved its input clock to keep inputs on time; it follows the round trip, which here swung to ${l.gameMs?.worst ?? "?"} ms`);
  return out;
}

/** The report as lines of plain text: on the page when it is done, and in the terminal of tools/device.ts. */
export function deviceTable(r: DeviceReport): string[] {
  const out: string[] = [`SNARK device report ${r.run}, ${r.mode}: ${r.done ? "done" : `stopped at ${r.stage}`}`];
  if (r.reloadedDuring) out.push(`reloaded  the browser reloaded the page during ${r.reloadedDuring}, as it does after the page crashes`);
  const d = r.device;
  if (d) {
    const f = d.features;
    out.push(`device    ${identify(d.userAgent, d.touch)}`);
    out.push(`agent     ${d.userAgent}`);
    out.push(`screen    ${d.screen.join("x")} CSS pixels, the page ${d.window.join("x")}, ${d.pixelRatio} device pixels to one; ${d.cores} cores${d.memoryGB ? `, ${d.memoryGB} GB` : ""}; ${d.touch} touch points`);
    out.push(`features  workers ${yes(f.workers)}, file storage ${yes(f.opfs)}, decompression ${f.decompress || "none"}, audio worklet ${yes(f.audioWorklet)}, storage quota ${f.quotaMB ?? "?"} MB`);
    out.push(`          opus encode ${yes(f.opusEncode)}, opus decode ${yes(f.opusDecode)}, webtransport ${yes(f.webTransport)}, webgpu ${yes(f.webgpu)}`);
  }
  const g = r.gpu;
  if (g) {
    out.push(`gpu       ${g.renderer} (${g.vendor}), ${g.version}; drawn from the ${g.variant} variant`);
    out.push(`renderer  ${limitsLine(g)}`);
  }
  out.push(`display   ${r.idleFrameMs ?? "?"} ms between frames with nothing drawn; wake lock ${r.wakeLock}`);
  out.push(...linkLines(r));
  const load = r.load;
  if (load) out.push(`load      first frame ${secs(load.firstFrameMs)} s, full detail ${secs(load.fullDetailMs)} s${load.settled ? "" : " (not reached)"}; page ${mb(load.pageBytes)} MB, assets ${mb(load.assetBytes)} MB, ${mb(load.diskBytes)} MB from disk, ${load.failed} fetches failed${load.failedHow ? ` (${load.failedHow})` : ""}, ${load.refused} uploads the card refused; asset cache in ${load.cache}`);
  if (r.served) out.push(`files     the server's files ${r.served}: the run fetched from something else than it started with`);
  if (r.probes) {
    const wrong = r.probes.filter((p) => !p.ok);
    out.push(`picture   ${r.probes.length - wrong.length} of ${r.probes.length} probes right (${r.probes.map((p) => p.name).join(" ")})${wrong.map((p) => `; ${p.name} is ${p.got.join(",")}, not ${p.expected.join(",")}`).join("")}`);
  }
  if (r.hashes) {
    const differ = r.hashes.filter((h) => h.got !== h.want);
    out.push(`hashes    ${r.hashes.length - differ.length} of ${r.hashes.length} as the server's${differ.map((h) => `; ${h.name} ${h.got}, server ${h.want ?? "?"}`).join("")}; ${r.hashes.map((h) => `${h.name} ${h.ms} ms`).join(", ")}`);
  }
  out.push(`materials ${materialsLine(r)}`);
  if (r.phases.length > 0) {
    out.push(`tiers run ${[...new Set(r.phases.map((p) => p.tier))].join(", ")}`);
    out.push("");
    out.push(row(["tier", "scene", "canvas", "settle", "median", "p95", "p99", "worst", "build", "draw", "gpu", "calls", "tris", "mat", "drop", "skip", "lost", "MB", "fail", "miss"]));
    for (const p of r.phases) out.push(phaseRow(p));
    if (r.again) out.push(phaseRow(r.again, "again"));
    out.push("median to worst: ms between frames. settle: s until nothing was on its way, ! if never. build, draw: ms in our code;");
    out.push("gpu: the GPU's ms a frame by timer query, - where there are none.");
    out.push("calls: WebGL draws. mat: draws with materials. drop, skip: what the frame left out.");
    out.push("MB, fail, miss: fetched, fetches failed and snapshots missed while the phase settled and ran.");
    out.push("crowd1: the crowd in one depth range on a tier of two; crowd0: with no shadows on a tier that casts, or where the GPU is");
    out.push("timed, with shadows and none by turns, frame by frame; each to set against crowd");
    for (const one of r.phases.filter((p) => p.scene === "crowd1")) {
      const two = r.phases.find((p) => p.tier === one.tier && p.scene === "crowd");
      if (two) out.push(`ranges    ${one.tier}, two against one in the crowd: frames ${two.frameMs.median} against ${one.frameMs.median} ms, 95th ${two.frameMs.p95} against ${one.frameMs.p95}; our code ${tenth(two.buildMs.median + two.drawMs.median)} against ${tenth(one.buildMs.median + one.drawMs.median)} ms; ${count(two.drawCalls)} against ${count(one.drawCalls)} draws`);
    }
    // What shadows cost a frame, the number the touch-first rule is set from: the GPU's own where there are timer queries.
    for (const off of r.phases.filter((p) => p.scene === "crowd0")) {
      const on = r.phases.find((p) => p.tier === off.tier && p.scene === "crowd");
      if (!on) continue;
      const turns = off.gpuMs != null && off.gpuOff != null;
      const [a, b] = turns ? [off.gpuMs!, off.gpuOff!] : [on.gpuMs, off.gpuMs];
      const gpu = a != null && b != null ? `the GPU ${a} against ${b} ms a frame, ${signed(a - b)} ms by timer query${turns ? ", on and off by turns" : ""}` : "the GPU's time not known here (no timer queries)";
      out.push(`shadows   ${off.tier}, on against off in the crowd: ${gpu}; frames ${on.frameMs.median} against ${off.frameMs.median} ms, 95th ${on.frameMs.p95} against ${off.frameMs.p95}; our code ${tenth(on.buildMs.median + on.drawMs.median)} against ${tenth(off.buildMs.median + off.drawMs.median)} ms; ${count(on.drawCalls)} against ${count(off.drawCalls)} draws`);
    }
  }
  if (r.gpuTests) out.push("", ...gpuLines(r));
  if (r.ladder || r.reloadedDuring?.startsWith("memory")) out.push("", ...ladderLines(r));
  if (r.soak) out.push("", ...soakLines(r));
  if (r.terrain) out.push("", ...terrainLines(r));
  for (const line of r.skipped) out.push(`not run   ${line}`);
  if (r.hidden.length > 0) out.push(`hidden    the page was hidden during: ${r.hidden.join(", ")}`);
  for (const e of r.errors) out.push(`error     ${e}`);
  return out;
}
