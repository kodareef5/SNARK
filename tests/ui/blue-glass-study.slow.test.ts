import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { until } from "../../tools/bench/driving-browser.ts";
import { CHROME_FLAGS, findChrome } from "../../tools/chrome.ts";
import { devtools } from "../../tools/map/trip.ts";

const chrome = findChrome();
const study = new URL("../../planning/reference/interface-study/blue-glass.html", import.meta.url);
type Page = Awaited<ReturnType<typeof devtools>>;

async function touch(page: Page, selector: string, upward = 0): Promise<void> {
  const [x, y] = await page.value<[number, number]>(`(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return [rect.x + rect.width / 2, rect.y + rect.height / 2];
  })()`);
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  if (upward) {
    expect(y).toBeGreaterThan(upward);
    await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - upward }] });
  }
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test.skipIf(!chrome)("A wheel tap opens the bag and two card swipes assign its pick", async () => {
  const profile = mkdtempSync(join(tmpdir(), "snark-glass-"));
  const browser = Bun.spawn([chrome!, "--headless=new", ...CHROME_FLAGS, "--no-first-run", "--disable-extensions",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  let tab: Page | undefined;
  try {
    const page = tab = await devtools(profile);
    await page.send("Page.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await page.send("Page.navigate", { url: study.href });
    await until(() => page.value<boolean>("document.querySelector('#stage')?.dataset.ready === 'true'"), "study opening");
    await touch(page, "#leftWheel .sgr-opener");
    await until(() => page.value<boolean>("document.querySelector('#leftWheel .sgr-caption').style.opacity === '1'"), "wheel opening");
    await touch(page, '#leftWheel button[aria-label="Inventory"]');

    // Chrome can deliver a second click to the item under the released wheel station.
    const title = () => page.value<string>("document.querySelector('#sheetTitle').textContent");
    expect(await title()).toBe("Inventory");
    await touch(page, "#grip", 35);
    expect(await title()).toBe("Stone pick");
    await touch(page, "#grip", 35);
    expect(await title()).toBe("Hotkeys");
    await touch(page, '[data-key="slot-3"]');
    expect(await page.value<boolean>("document.querySelector('#sheet').hidden")).toBe(true);
    expect(await page.value<string>("document.querySelector('#bar .chosen').getAttribute('aria-label')")).toBe("4 · Stone pick");
    await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 526, y: 175 }] });
    expect(await page.value<boolean>(`document.querySelector('.sn-touch-action-gem image')?.getAttribute('href')
      === document.querySelector('#bar .chosen img')?.src`)).toBe(true);
    await page.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  } finally {
    tab?.close();
    browser.kill();
    await browser.exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});
