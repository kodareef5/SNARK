import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { until } from "../../tools/bench/driving-browser.ts";
import { CHROME_FLAGS, findChrome } from "../../tools/chrome.ts";
import { devtools } from "../../tools/map/trip.ts";

const chrome = findChrome();
const url = new URL("../../planning/reference/interface-study/blue-glass.html", import.meta.url);
type Page = Awaited<ReturnType<typeof devtools>>;

async function stroke(page: Page, selector: string, dx = 0, dy = 0, cancel = false): Promise<void> {
  const [x, y] = await page.value<[number, number]>(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  })()`);
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  if (dx || dy) {
    await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx, y: y + dy }] });
  }
  await page.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
  await page.send("Runtime.evaluate", { expression: "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))", awaitPromise: true });
}

test.skipIf(!chrome)("Two wheel levels browse safely and the bottom wheel equips on release", async () => {
  const profile = mkdtempSync(join(tmpdir(), "snark-rims-"));
  const browser = Bun.spawn([chrome!, "--headless=new", ...CHROME_FLAGS, "--no-first-run", "--disable-extensions",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  let tab: Page | undefined;
  try {
    const page = tab = await devtools(profile);
    await page.send("Page.enable");
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: true });
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    for (const [width, height] of [[844, 390], [390, 844]]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
      await page.send("Page.navigate", { url: url.href });
      await until(() => page.value<boolean>("document.querySelector('#stage')?.dataset.ready === 'true'"), "study opening");
      const track = () => page.value<string>("document.querySelector('#bar .chosen').ariaLabel");
      const depth = () => page.value<string>("document.querySelector('#rightWheel').dataset.depth");
      const order = () => page.value<string>("document.querySelector('#stage').dataset.tameOrder || ''");
      const centers = await page.value<{ x: number; y: number }[]>(`
        Array.from(document.querySelectorAll('#bar button:not([hidden]):not([inert])'), button => {
          const rect = button.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }).sort((a, b) => a.x - b.x)`);
      // Equal turns of a circular wheel put neighboring slot centers the same distance apart.
      const gaps = centers.slice(1).map((point, i) => Math.hypot(point.x - centers[i]!.x, point.y - centers[i]!.y));
      expect(gaps.length).toBeGreaterThan(1);
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
      await stroke(page, "#bar [data-slot='1']");
      expect(await track()).toBe("2 · Stone hatchet");
      await stroke(page, "#bar [data-slot='0']");
      await stroke(page, "[data-action-open]");
      await stroke(page, "[data-family='0']", -55);
      expect(await depth()).toBe("children");
      expect(await order()).toBe("");
      await stroke(page, "[data-command=follow]", 0, -52);
      expect(await page.value<string>("document.querySelector('.nr-leaf[aria-pressed=true]').ariaLabel")).toBe("Stay");
      await stroke(page, "[data-command=stay]", 45);
      expect(await depth()).toBe("families");
      expect(await order()).toBe("");
      await stroke(page, "[data-family='0']");
      await stroke(page, "[data-command=follow]");
      expect(await order()).toBe("follow");
      expect(await depth()).toBe("closed");
      await stroke(page, "#bar [data-slot='0']", -98, 0, true);
      expect(await track()).toBe("1 · Stone pick");
      await stroke(page, "#bar [data-slot='0']", -98);
      expect(await track()).toBe("3 · Spear");
      expect(await page.value<string>("document.querySelector('#reticle').dataset.uses || ''")).toBe("");
    }
    const [x, y] = await page.value<[number, number]>(`(() => {
      const r = document.querySelector("#bar .chosen").getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    })()`);
    await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 57, y }] });
    await page.send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
    await until(() => page.value<boolean>("!document.querySelector('#stage').dataset.wheel"), "held wheel closing on rotation");
    await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect(await page.value<string>("document.querySelector('#bar .chosen').ariaLabel")).toBe("3 · Spear");
  } finally {
    tab?.close();
    browser.kill();
    await browser.exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});
