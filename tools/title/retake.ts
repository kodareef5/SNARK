// bun tools/title/retake.ts --world http://localhost:8799/miami/ [--video] [--software]
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findChrome, CHROME_FLAGS } from "../chrome.ts";
import { devtools } from "../map/trip.ts";
import { MIAMI_FLIGHT } from "../../client/core/title-route.ts";

const arg = (k: string, f: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1]! : f);
const base = new URL(arg("--world", "http://localhost:8799/miami/"));
const out = resolve(arg("--out", join(import.meta.dir, "../../client/entry/media")));
const temp = mkdtempSync(join(tmpdir(), "snark-title-")),
  profile = join(temp, "chrome");
mkdirSync(profile);
mkdirSync(out, { recursive: true });
const chrome = findChrome();
if (!chrome) throw Error("Chrome is required for native shots.");
const browser = Bun.spawn(
  [
    chrome,
    "--headless=new", "--mute-audio",
    ...CHROME_FLAGS,
    "--no-first-run",
    "--disable-extensions",
    "--ignore-gpu-blocklist",
    ...(process.argv.includes("--software")
      ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
      : process.platform === "linux" && process.env.DISPLAY
        ? ["--ozone-platform=x11", "--use-gl=angle", "--use-angle=gl", "--enable-gpu"]
        : []),
    "--remote-debugging-port=0",
    "--user-data-dir=" + profile,
    "about:blank",
  ],
  { stderr: Bun.file(join(temp, "chrome.log")), stdout: "ignore" },
);
let page: Awaited<ReturnType<typeof devtools>> | undefined;
function encode(args: string[]) {
  const r = Bun.spawnSync(["ffmpeg", "-nostdin", "-y", "-loglevel", "error", ...args]);
  if (r.exitCode !== 0) throw Error(r.stderr.toString());
}
try {
  page = await devtools(profile);
  const metrics = async (width: number, height: number) =>
    page!.send("Emulation.setDeviceMetricsOverride", { width, height, mobile: false, deviceScaleFactor: 1 });
  await metrics(1440, 810);
  await page.send("Page.navigate", { url: new URL("flight.html?retake", base).href });
  async function pose(t: number, view: string, settle: boolean) {
    const expr = "window.snarkShot?.(" + t + "," + JSON.stringify(view) + ")",
      deadline = Date.now() + 180000;
    let stable = 0,
      last;
    while (Date.now() < deadline) {
      last = await page!.value<{ map: string; ready: boolean; pending: number; frames: number; city: number } | null>(expr);
      if (last?.map && last.map !== MIAMI_FLIGHT.map) throw Error("Retakes need a built Miami world.");
      if (last?.ready && (!settle || (last.pending === 0 && (last.city > 0 || view.startsWith("portrait"))))) {
        if (!settle || ++stable >= 6) return;
      } else stable = 0;
      const error = await page!.value<string>("document.body.dataset.error");
      if (error) throw Error(error);
      await Bun.sleep(220);
    }
    throw Error("Scene did not settle: " + JSON.stringify(last));
  }
  for (const [name, time, view] of [
    ["miami-flight", MIAMI_FLIGHT.poster, "flight"],
    ["miami-splash", MIAMI_FLIGHT.splash, "splash"],
    ["survivor", 0, "portrait"],
    ["survivor-create", 0, "portrait-left"],
  ] as const) {
    if(process.argv.includes("--portraits") && !view.startsWith("portrait"))continue;
    await pose(time, view, true);
    const path = join(temp, name + ".png");
    await page.shot(path);
    encode(["-i", path, "-frames:v", "1", "-quality", "91", join(out, name + ".webp")]);
    console.log("Retook " + name);
  }
  if (process.argv.includes("--video")) {
    // A short native sequence dissolves into its opening, while the live route covers the entire bay.
    const fps = 12,
      duration = 12,
      frames = fps * duration;
    await metrics(960, 540);
    await pose(MIAMI_FLIGHT.poster, "flight", true);
    for (let i = 0; i < frames; i++) {
      await pose(MIAMI_FLIGHT.poster + i / fps, "flight", false);
      await page.shot(join(temp, "f" + String(i).padStart(4, "0") + ".png"));
    }
    encode([
      "-framerate",
      String(fps),
      "-i",
      join(temp, "f%04d.png"),
      "-filter_complex",
      "[0:v]split[a][b];[a]trim=start=1,setpts=PTS-STARTPTS[x];[b]trim=end=1,setpts=PTS-STARTPTS[y];[x][y]xfade=transition=fade:duration=1:offset=10,format=yuv420p",
      "-threads",
      "4",
      "-c:v",
      "libvpx-vp9",
      "-crf",
      "34",
      "-b:v",
      "0",
      join(out, "miami-flight.webm"),
    ]);
    console.log("Retook fallback loop");
  }
} finally {
  page?.close();
  browser.kill();
  await browser.exited;
  rmSync(temp, { recursive: true, force: true });
}
