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

async function point(page: Page, selector: string): Promise<{ x: number; y: number }> {
  return page.value(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
}

async function paint(page: Page): Promise<void> {
  await page.send("Runtime.evaluate", { expression: "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))", awaitPromise: true });
}

function dock(page: Page) {
  return page.value<{ slot: number; bottom: number; top: number; width: number; hitHeight: number }[]>(`
    Array.from(document.querySelectorAll('#bar button:not([hidden]):not([inert])'), button => {
      const art = button.querySelector('img').getBoundingClientRect();
      return { slot: Number(button.dataset.slot), bottom: art.bottom, top: art.top, width: art.width,
        hitHeight: button.getBoundingClientRect().height };
    })`);
}

async function stroke(page: Page, selector: string, dx = 0, dy = 0, cancel = false): Promise<void> {
  const { x, y } = await point(page, selector);
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  if (dx || dy) {
    await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx, y: y + dy }] });
  }
  await page.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
  await paint(page);
}

test.skipIf(!chrome)("The dock magnifies under touch and both action levels browse safely", async () => {
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
      const idle = await dock(page);
      const unselected = idle.filter(item => item.slot !== 0);
      const artWidth = (items: typeof idle, slot: number) => items.find(item => item.slot === slot)!.width;
      expect(unselected.length).toBeGreaterThanOrEqual(2);
      expect(Math.max(...unselected.map(item => item.bottom)) - Math.min(...unselected.map(item => item.bottom))).toBeLessThan(2);
      expect(height - Math.min(...idle.map(item => item.top))).toBeLessThanOrEqual(idle[0]!.hitHeight + 8);
      expect(artWidth(idle, 0)).toBeGreaterThan(artWidth(idle, 1));

      const neighbor = await point(page, "#bar [data-slot='1']");
      await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [neighbor] });
      await paint(page);
      const held = await dock(page);
      const growth = (slot: number) => artWidth(held, slot) - artWidth(idle, slot);
      expect(growth(1)).toBeGreaterThan(growth(0));
      expect(growth(0)).toBeGreaterThan(0);
      expect(await track()).toBe("1 · Stone pick");
      await page.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await paint(page);
      expect(artWidth(await dock(page), 1)).toBeCloseTo(artWidth(idle, 1));
      expect(await track()).toBe("1 · Stone pick");
      await stroke(page, "#bar [data-slot='1']");
      expect(await track()).toBe("2 · Stone hatchet");
      expect(artWidth(await dock(page), 1)).toBeCloseTo(artWidth(idle, 0));
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
    for (const key of ["0", "3"]) {
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: "Digit" + key });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: "Digit" + key });
      await paint(page);
      expect(await page.value<string>("document.querySelector('#bar [aria-pressed=true]').ariaLabel")).toStartWith(key + " · ");
    }
    const { x, y } = await point(page, "#bar .chosen");
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
