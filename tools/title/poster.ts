import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, copyFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { serveFile } from "../../server/files.ts";
import { DEFAULT_LOADER_SHOT, DEFAULT_TITLE_SHOT } from "../../shared/player-scenes.ts";
import type { TitleShot } from "../../shared/title-scene.ts";
import { findChrome, CHROME_FLAGS } from "../chrome.ts";

/** Bake the native default title and loader frames. The cache lives outside Git. */
export async function titlePoster(dist: string) {
  const hash = createHash("sha256");
  for (const file of ["flight.js", "title/wynwood-shore.json", "assets/manifest.json", "entry-media.json"]) {
    hash.update(readFileSync(join(dist, file)));
  }
  const title = join(dist, "title");
  const cache = join(import.meta.dir, "../../var/title-posters");
  const scenes = [
    { name: "red-tide", shot: DEFAULT_TITLE_SHOT, seconds: 3, width: 1600, quality: 87 },
    { name: "loader-wynwood", shot: DEFAULT_LOADER_SHOT, seconds: 8, width: 1440, quality: 85 },
  ];
  const frames = scenes.flatMap((scene) => [false, true].map((portrait) => {
    const name = `${scene.name}${portrait ? "-portrait" : ""}.webp`;
    const key = hash.copy().update(JSON.stringify(scene)).digest("hex");
    return { ...scene, name, portrait, cached: join(cache, key, name), out: join(title, name) };
  }));
  const missing = frames.filter(({ cached, out }) => {
    if (!existsSync(cached)) return true;
    copyFileSync(cached, out);
    return false;
  });
  if (!missing.length) return;
  const fallback = (out: string) => copyFileSync(join(title, "miami-flight.webp"), out);
  const chrome = findChrome();
  if (!chrome || !existsSync(join(dist, "assets-worker.js"))) {
    console.info("Default stills use the coastal plate on this build.");
    for (const { out } of missing) fallback(out);
    return;
  }
  const { devtools } = await import("../map/trip.ts");
  let preset: TitleShot = DEFAULT_TITLE_SHOT;
  const host = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      return path === "/cluster/title-scene.json" ? Response.json(preset) : serveFile(dist, req, path);
    },
  });
  const profile = mkdtempSync(join(tmpdir(), "snark-title-"));
  const browser = Bun.spawn(
    [
      chrome,
      ...CHROME_FLAGS,
      "--headless=new", "--mute-audio",
      "--remote-debugging-port=0",
      "--user-data-dir=" + profile,
      "--no-first-run",
      "--disable-extensions",
      "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader",
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  let page: Awaited<ReturnType<typeof devtools>> | undefined;
  try {
    page = await devtools(profile);
    for (const { name, cached, out, shot, seconds, portrait, width, quality } of missing) {
      try {
        preset = shot;
        await page.send("Emulation.setDeviceMetricsOverride", {
          width: portrait ? 720 : width,
          height: portrait ? 1280 : width * 9 / 16,
          mobile: false,
          deviceScaleFactor: 1,
        });
        await page.send("Page.navigate", { url: host.url + `flight.html?set=${shot.set}&still=${seconds}&aspect=${name}` });
        const start = Date.now();
        while (!(await page.value<boolean>(`document.body?.dataset.settled === 'true' && location.search.endsWith(${JSON.stringify(name)})`))) {
          const error = await page.value<string>("document.body?.dataset.error");
          if (error || Date.now() - start > 45000) throw Error(error || "Scene materials did not settle.");
          await Bun.sleep(180);
        }
        const picture = await page.send("Page.captureScreenshot", { format: "webp", quality });
        mkdirSync(dirname(cached), { recursive: true });
        const temporary = `${cached}.${process.pid}`;
        writeFileSync(temporary, Buffer.from(picture.data, "base64"));
        renameSync(temporary, cached);
        copyFileSync(cached, out);
      } catch (error) {
        console.warn(`Using the coastal loading plate for ${name}.`, String(error));
        fallback(out);
      }
    }
  } catch (error) {
    console.warn("Using the coastal loading plate.", String(error));
    for (const { out } of missing) fallback(out);
  } finally {
    page?.close();
    browser.kill();
    await browser.exited;
    host.stop(true);
    rmSync(profile, { recursive: true, force: true });
  }
}
