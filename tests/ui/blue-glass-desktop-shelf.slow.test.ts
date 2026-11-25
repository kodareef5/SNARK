import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { until } from "../../tools/bench/driving-browser.ts";
import { CHROME_FLAGS, findChrome } from "../../tools/chrome.ts";
import { devtools } from "../../tools/map/trip.ts";

type Page = Awaited<ReturnType<typeof devtools>>;
const chrome = findChrome();
const url = new URL("../../planning/reference/interface-study/blue-glass.html", import.meta.url);

async function click(page: Page, selector: string): Promise<void> {
  const { x, y } = await page.value<{ x: number; y: number }>(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return {x: r.x + r.width / 2, y: r.y + r.height / 2};
  })()`);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x, y });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x, y });
}

async function key(page: Page, name: string): Promise<void> {
  const enter = name === "Enter" ? { text: "\r", windowsVirtualKeyCode: 13 } : {};
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, ...enter });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name });
}

test.skipIf(!chrome)("Desktop slots stay fixed and browsing a command leaves it unsent", async () => {
  const profile = mkdtempSync(join(tmpdir(), "snark-shelf-"));
  const browser = Bun.spawn([chrome!, "--headless=new", ...CHROME_FLAGS, "--no-first-run", "--disable-extensions",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  let tab: Page | undefined;
  try {
    const page = tab = await devtools(profile);
    await page.send("Page.enable");
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    const positions = () => page.value<number[]>(`Array.from(document.querySelectorAll('[data-pc-slot]'),
      button => button.getBoundingClientRect().left)`);
    for (const [width, height] of [[1024, 768], [1440, 900], [1920, 1080]]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      await page.send("Page.navigate", { url: url.href });
      await until(() => page.value<boolean>("!!document.querySelector('#pcShelf')"), "desktop shelf");
      const atRest = await positions();
      expect(atRest).toHaveLength(10);
      expect(Math.min(...atRest)).toBeGreaterThan(0);
      expect(Math.max(...atRest)).toBeLessThan(width - 30);
      expect(await page.value<string>("Array.from(document.querySelectorAll('[data-pc-slot] kbd'), k => k.textContent).join('')")).toBe("1234567890");
      await click(page, '[data-pc-slot="3"]');
      expect(await page.value<string>("document.querySelector('[data-pc-slot][aria-pressed=true]').dataset.pcSlot")).toBe("3");
      expect(await positions()).toEqual(atRest);
      for (const [family, commands] of [
        ["kit", ["drink", "eat", "spyglass"]], ["gestures", ["wave", "point", "salute"]], ["whistles", ["follow", "stay", "attack-target"]],
      ] as const) {
        await click(page, "[data-pc-family=" + family + "]");
        expect(await page.value<string[]>("Array.from(document.querySelectorAll('[data-pc-command]'), b => b.dataset.pcCommand)")).toEqual([...commands]);
        await key(page, "ArrowUp");
        await key(page, "ArrowRight");
        expect(await page.value<string>("document.activeElement.dataset.pcCommand")).toBe(commands[1]);
        await key(page, "Escape");
        expect(await page.value<string>("document.activeElement.dataset.pcFamily")).toBe(family);
        expect(await page.value<boolean>("document.querySelector('#pcShelfTray').hidden")).toBe(true);
      }
      expect(await page.value<string>("document.querySelector('#stage').dataset.tameOrder ?? ''")).toBe("");
      await click(page, "[data-pc-family=whistles]");
      await key(page, "ArrowUp");
      await key(page, "Enter");
      expect(await page.value<string>("document.querySelector('#stage').dataset.tameOrder")).toBe("follow");
      await click(page, "[data-pc-family=kit]");
      await click(page, "[data-pc-command=eat]");
      expect(await page.value<string>(`document.querySelector('[data-pc-slot="8"] .pc-qty').textContent`)).toBe("7");
      expect(await positions()).toEqual(atRest);
      await click(page, "[data-pc-hub]");
      expect(await page.value<string[]>("Array.from(document.querySelectorAll('[data-pc-destination]'), b => b.dataset.pcDestination)"))
        .toEqual(["bag", "map", "survivor", "craft", "radio", "settings"]);
      await key(page, "Escape");
    }
  } finally {
    tab?.close();
    browser.kill();
    await browser.exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});
