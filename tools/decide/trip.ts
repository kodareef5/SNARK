// The decider and the waypoints as a player sees them, in the built client: a development world on flat ground with
// movers in trouble (page.ts), a headless Chrome that joins it as an admin, and a picture of each thing nobody had looked
// at: the debug bar's Server tab with its Decide section while the rule decides, the map's pins panel with a pin
// placed from it, that pin on the minimap and the compass, a tame sent to it from the panel, and a tame sent where the
// survivor looks by the go-there whistle. Each act is judged by what the server then holds.
//
//   bun tools/decide/trip.ts --dist <built client> [--out var/decide/trip] [--canvas 1600x900@1] [--tier high]
//
// The client must be built: `bun tools/build-client.ts --quick --dist <folder>` is enough.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PIN_TINT } from "../../client/core/pins.ts";
import { KEY_PIN_KIND, KEY_PIN_LABEL, KEY_PIN_ROW, KEY_PIN_SEND } from "../../client/core/ui/pins-panel.ts";
import { KEY_MAP_CLOSE, KEY_MAP_MARK_TOOL, KEY_MAP_SAVE, KEY_MAP_SURFACE, KEY_MAP_TOOLS } from "../../client/core/ui/screens.ts";
import { PAGE_ACTOR } from "../../server/acts.ts";
import type { Client } from "../../server/game.ts";
import { startServer } from "../../server/main.ts";
import { rowOf } from "../../server/settings/catalog.ts";
import { Rules } from "../../server/settings/rules.ts";
import { WAYPOINT_KINDS } from "../../shared/world/course.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { CHROME_FLAGS, findChrome } from "../chrome.ts";
import { devtools } from "../map/trip.ts";
import { trouble } from "./page.ts";

const ROOT = resolve(import.meta.dir, "../..");
const value = (flag: string, otherwise: string): string => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1]! : otherwise;
};
const dist = resolve(value("--dist", join(ROOT, "client/dist")));
const out = resolve(value("--out", join(ROOT, "var/decide/trip")));
const [size, dprText = "1"] = value("--canvas", "1600x900@1").split("@"), [cssW, cssH] = size!.split("x").map(Number), dpr = Number(dprText);
const tier = value("--tier", "high");
const chromePath = value("--chrome", findChrome() ?? "");
if (!existsSync(join(dist, "main.js"))) throw new Error(`no built client in ${dist}: bun tools/build-client.ts --quick --dist ${dist}`);
if (!chromePath) throw new Error("no Chrome found: set CHROME or pass --chrome");
mkdirSync(out, { recursive: true });

const results: [string, boolean][] = [];
const hold = (what: string, ok: boolean, detail = ""): void => {
  results.push([what, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `: ${detail}` : ""}`);
};

const map = join(out, "flat.snmap");
writeFileSync(map, writeMap(flatMap(8)));
const config = new Rules();
const refused = config.set(rowOf("NoDinos", true)!, "True", "command line");
if (refused !== "") throw new Error(refused);
const scratch = mkdtempSync(join(ROOT, "var/decide/trip-"));
const server = startServer({ dev: true, hostname: "127.0.0.1", port: 0, clientDir: dist, config, map, dbPath: join(scratch, "world.db"), noBackups: true });
const host = server.host;
// Plant eaters, so the survivor standing in the U is left alone.
const scene = trouble(host, ["core:parasaur", "core:trike", "core:parasaur"]);
const chrome = Bun.spawn([chromePath, "--headless=new", ...CHROME_FLAGS, "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--window-size=${cssW},${cssH}`, `--force-device-scale-factor=${dpr}`, "--remote-debugging-port=0", `--user-data-dir=${scratch}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
let page: Awaited<ReturnType<typeof devtools>> | null = null;
try {
  page = await devtools(scratch);
  const p = page;
  await p.send("Page.enable");
  // What the page throws while the trip runs is a fault of the trip's.
  await p.send("Page.addScriptToEvaluateOnNewDocument", { source: `globalThis.tripErrors = []; addEventListener("error", (e) => globalThis.tripErrors.push(String(e.message))); addEventListener("unhandledrejection", (e) => globalThis.tripErrors.push(String(e.reason)));` });
  await p.send("Emulation.setDeviceMetricsOverride", { width: cssW, height: cssH, deviceScaleFactor: dpr, mobile: false });
  await p.send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("snark.interface", ${JSON.stringify(JSON.stringify({ version: 2, tier, debug: false, muted: true }))})` });
  await p.send("Page.navigate", { url: `http://127.0.0.1:${server.port}/?quick=1&name=decide-trip&trip` });
  const until = async <T>(what: string, expression: string, ms: number): Promise<T | null> => {
    const t0 = performance.now();
    for (;;) {
      const got = await p.value<T>(expression).catch(() => null);
      if (got) return got;
      if (performance.now() - t0 > ms || chrome.exitCode !== null) {
        hold(what, false, `not in ${ms / 1000} s`);
        return null;
      }
      await Bun.sleep(200);
    }
  };
  const app = "globalThis.snarkTrip?.app", bar = `${app}?.ui.debug`;
  const key = async (code: string, keyCode: number, text = code): Promise<void> => {
    for (const type of ["keyDown", "keyUp"]) await p.send("Input.dispatchKeyEvent", { type, code, key: text, windowsVirtualKeyCode: keyCode });
  };
  const chat = async (line: string): Promise<void> => {
    await key("Enter", 13);
    await Bun.sleep(300);
    await p.send("Input.insertText", { text: line });
    await Bun.sleep(200);
    await key("Enter", 13);
  };
  const shot = async (name: string): Promise<void> => {
    await p.shot(join(out, `${name}.png`));
    console.log(`picture: ${join(out, `${name}.png`)}`);
  };
  /** Presses the interface's node `k` at a share of its width and height, as the play tests do. */
  const click = async (k: number, dx = 0.5, dy = 0.5): Promise<boolean> => {
    const ok = await p.value<boolean>(`(() => { const a = ${app}, n = a.ui.frame.find(${k}); if (!n || !n.interactive) return false; const x = n.x + n.w * ${dx}, y = n.y + n.h * ${dy}; a.pointer(0, ${k}, x, y, 0, 1); a.pointer(1, ${k}, x, y, 0, 1); return true; })()`);
    await Bun.sleep(250);
    return ok;
  };
  const look = (yaw: number, pitch: number): Promise<unknown> => p.value(`(() => { const c = ${app}.controls; c.yaw = ${yaw}; c.pitch = ${pitch}; return true; })()`);

  if (!(await until("the world drawn", `(${app}?.frames?.rows ?? 0) > 120`, 180_000))) throw new Error("the page did not draw the world");
  await Bun.sleep(3000);
  await chat("/enablecheats");
  await until("the session an admin", `${app}.session.admin === true`, 20_000);
  const me = host.game.clients.find((c): c is Client => c !== null && c.pid > 0)!;
  const rec = host.records.byPid.get(me.pid)!;
  // Where the survivor's body is now: the record keeps where it was last saved.
  const ents = host.world.ents, body = ents.pid.indexOf(me.pid);
  const here = { x: ents.x[body]!, z: ents.z[body]! };
  await shot("01-arrived");

  // The rule decides every point; the bar's Server tab says so, with its counts and the mover the survivor is by.
  const why = host.pageSetting("DecidePolicy", "*=rule", PAGE_ACTOR).why;
  hold("the world takes the rule for every point", why === "" && /\*=rule/.test(host.rules.text("DecidePolicy")), why || host.rules.text("DecidePolicy"));
  await p.send("Input.dispatchKeyEvent", { type: "keyDown", code: "ShiftLeft", key: "Shift", windowsVirtualKeyCode: 16 });
  await key("F3", 114);
  await p.send("Input.dispatchKeyEvent", { type: "keyUp", code: "ShiftLeft", key: "Shift", windowsVirtualKeyCode: 16 });
  await until("the bar on and its drawer open", `${bar}?.open === true && ${bar}.port !== null`, 30_000);
  const tabs = (await p.value<string[]>(`${bar}.tabs.map((t) => t.name)`)) ?? [];
  const at = tabs.findIndex((t) => /server/i.test(t));
  hold("the drawer has a Server tab", at >= 0, tabs.join(", "));
  await p.value(`${bar}.show(${at})`);
  const said = await until<{ points: { name: string; policy: string; put: number }[]; mover: unknown }>("the server tells the bar of the decider", `(() => { const d = ${bar}.server?.decide; return d && d.points.some((q) => q.put > 0) ? d : null; })()`, 90_000);
  hold("the bar's Decide section has each point under the rule and counts that rise", !!said && said.points.length >= 5 && said.points.every((q) => q.policy === "rule"), said ? said.points.map((q) => `${q.name} ${q.policy} ${q.put}`).join(", ") : "nothing");
  await look(0, -0.15);
  await Bun.sleep(2500);
  await shot("02-bar-server-decide");
  hold("the bar describes a mover near the survivor", !!(await p.value(`!!${bar}.server?.decide?.mover`)), "the section's last line");
  // The drawer put away: the keys again.
  await p.send("Input.dispatchKeyEvent", { type: "keyDown", code: "ShiftLeft", key: "Shift", windowsVirtualKeyCode: 16 });
  await key("F3", 114);
  await p.send("Input.dispatchKeyEvent", { type: "keyUp", code: "ShiftLeft", key: "Shift", windowsVirtualKeyCode: 16 });
  await Bun.sleep(800);

  // A tame beside the survivor; the game asks its name, which takes the keyboard until it is given.
  const tame = host.spawnCreature("core:parasaur", here.x + 4, here.z + 3, 1);
  const tamed = host.taming.give(host.records.byPid.get(ents.pid[tame]!)!, rec, 0.9, "forced");
  hold("the survivor has a tame", tamed, `entity ${tame}`);
  await until("the game asks the tame's name", `${app}.ui.captureKeyboard === true`, 10_000);
  await shot("03-tame-named");
  await p.send("Input.insertText", { text: "Scout" });
  await key("Enter", 13);
  hold("named, the keyboard is the game's again", !!(await until("the name taken", `${app}.ui.captureKeyboard === false`, 10_000)), "Scout");

  // The go-there whistle for all: the tame goes where the survivor looks, a dozen metres south of it.
  const eye = 1.7, pitch = -0.14, ahead = eye / Math.tan(-pitch), spot = { x: here.x, z: here.z - ahead };
  await look(Math.PI, pitch);
  await Bun.sleep(600);
  await key("Quote", 222, "'");
  await Bun.sleep(1500);
  hold("the whistle gives the tame a course", host.courses.of(tame) !== null, "go there: all");
  await shot("04-whistle-go-there");
  await Bun.sleep(7000);
  const off = Math.hypot(ents.x[tame]! - spot.x, ents.z[tame]! - spot.z);
  hold("the tame went where the survivor looked", off < 4, `${off.toFixed(1)} m from ${Math.round(spot.x)}, ${Math.round(spot.z)}`);
  await look(Math.PI, -0.2);
  await Bun.sleep(600);
  await shot("05-whistle-arrived");
  await look(0, -0.1);

  // A pin placed from the map's panel: its kind, its label, a place on the chart, and saved.
  const danger = WAYPOINT_KINDS.indexOf("danger");
  await click(KEY_MAP_TOOLS);
  await click(KEY_MAP_TOOLS);
  hold("the corner chart opens its pins", await click(KEY_MAP_MARK_TOOL), "the mark tool");
  await shot("06-pins-panel-empty");
  await click(KEY_PIN_KIND + danger);
  await click(KEY_PIN_LABEL);
  await p.value(`${app}.ui.input(${KEY_PIN_LABEL}, "Rex nest")`);
  await click(KEY_MAP_SURFACE, 0.62, 0.3);
  await shot("07-pins-panel-chosen");
  await click(KEY_MAP_SAVE);
  await Bun.sleep(800);
  const pins = host.pins.of(rec.team);
  hold("the server holds the pin, with its kind and label", pins.length === 1 && pins[0]!.kind === danger && pins[0]!.label === "Rex nest", JSON.stringify(pins.map((q) => [q.kind, q.label, Math.round(q.x), Math.round(q.z)])));
  hold("the panel lists it", ((await p.value<string>(`${app}.ui.frame.find(${KEY_PIN_ROW})?.text ?? ""`)) ?? "").includes("Rex nest"), "its row");

  await Bun.sleep(600);
  await shot("08-pins-panel-listed");
  const sent = await click(KEY_PIN_SEND);
  await Bun.sleep(1500);
  const going = host.courses.of(tame);
  hold("a tame is sent to the pin from the panel", sent && going !== null, sent ? "the send button" : "the panel offers no send");
  await click(KEY_MAP_CLOSE);
  await look(Math.atan2(pins[0] ? pins[0].x - here.x : 0, pins[0] ? pins[0].z - here.z : 1), -0.1);
  await Bun.sleep(2500);
  await shot("09-hud-pin-and-tame-going");
  const tint = PIN_TINT[danger]!;
  hold("the pin is drawn in its kind's colour on the interface", ((await p.value<number>(`${app}.ui.frame.nodes.slice(0, ${app}.ui.frame.count).filter((n) => n.tint === ${tint}).length`)) ?? 0) > 0, `tint ${tint}`);

  // The whole map, with its marks.
  await p.send("Input.dispatchKeyEvent", { type: "keyDown", code: "ShiftLeft", key: "Shift", windowsVirtualKeyCode: 16 });
  await key("KeyM", 77, "M");
  await p.send("Input.dispatchKeyEvent", { type: "keyUp", code: "ShiftLeft", key: "Shift", windowsVirtualKeyCode: 16 });
  await Bun.sleep(1500);
  await shot("10-whole-map");
  const errors = (await p.value<string[]>("globalThis.tripErrors")) ?? [];
  hold("the page raised nothing", errors.length === 0, errors.slice(0, 3).join("; "));
} finally {
  scene.stop();
  page?.close();
  chrome.kill();
  await chrome.exited;
  server.stop();
  rmSync(scratch, { recursive: true, force: true });
}
const failed = results.filter(([, ok]) => !ok);
console.log(failed.length === 0 ? `the trip held all ${results.length}; pictures in ${out}` : `${failed.length} of ${results.length} did not hold:\n${failed.map(([w]) => `  ${w}`).join("\n")}`);
process.exit(failed.length === 0 ? 0 : 1);
