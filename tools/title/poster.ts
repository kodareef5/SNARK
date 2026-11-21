import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveFile } from "../../server/files.ts";
import { findChrome, CHROME_FLAGS } from "../chrome.ts";
import { OPENING_SHOT } from "../../shared/title-scene.ts";

/** Bake the default still from the actual cooked client. Cached by scene and pack contents outside Git. */
export async function titlePoster(dist: string) {
  const names = ["red-tide.webp", "red-tide-portrait.webp"];
  const loadingPlate = () => {
    for (const name of names) copyFileSync(join(dist, "title/miami-flight.webp"), join(dist, "title", name));
  };
  const hash = createHash("sha256");
  for (const file of ["flight.js", "title/wynwood-shore.json", "assets/manifest.json", "entry-media.json"])
    hash.update(readFileSync(join(dist, file)));
  const cache = join(import.meta.dir, "../../var/title-posters", hash.digest("hex"));
  if (names.every((n) => existsSync(join(cache, n)))) {
    for (const name of names) copyFileSync(join(cache, name), join(dist, "title", name));
    return;
  }
  // Source-only builds and machines without a browser still ship the existing coastal loading plate.
  const chrome = findChrome();
  if (!chrome || !existsSync(join(dist, "assets-worker.js"))) {
    console.info("Title stills use the coastal plate. Publishing a shot replaces both.");
    loadingPlate();
    return;
  }
  const { devtools } = await import("../map/trip.ts");
  const host = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      return path === "/cluster/title-scene.json" ? Response.json(OPENING_SHOT) : serveFile(dist, req, path);
    },
  });
  const profile = mkdtempSync(join(tmpdir(), "snark-title-"));
  const browser = Bun.spawn(
    [
      chrome,
      ...CHROME_FLAGS,
      "--headless=new",
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
    for (const name of names) {
      const portrait = name.includes("portrait");
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: portrait ? 720 : 1600,
        height: portrait ? 1280 : 900,
        mobile: false,
        deviceScaleFactor: 1,
      });
      await page.send("Page.navigate", { url: host.url + "flight.html?set=wynwood-shore&still&aspect=" + name });
      const start = Date.now();
      while (!(await page.value<boolean>("document.body?.dataset.settled === 'true' && location.search.endsWith('" + name + "')"))) {
        const error = await page.value<string>("document.body?.dataset.error");
        if (error || Date.now() - start > 45000)
          throw Error(error || "Title materials: " + JSON.stringify(await page.value("window.titleRetake?.()")));
        await Bun.sleep(180);
      }
      const shot = await page.send("Page.captureScreenshot", { format: "webp", quality: 87 });
      mkdirSync(cache, { recursive: true });
      writeFileSync(join(cache, name), Buffer.from(shot.data, "base64"));
      copyFileSync(join(cache, name), join(dist, "title", name));
    }
  } catch (error) {
    console.warn("Using the coastal loading plate:", String(error));
    loadingPlate();
  } finally {
    page?.close();
    browser.kill();
    await browser.exited;
    host.stop(true);
    rmSync(profile, { recursive: true, force: true });
  }
}
