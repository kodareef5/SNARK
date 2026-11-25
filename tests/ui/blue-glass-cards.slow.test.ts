import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { until } from "../../tools/bench/driving-browser.ts";
import { CHROME_FLAGS, findChrome } from "../../tools/chrome.ts";
import { devtools } from "../../tools/map/trip.ts";

const chrome = findChrome();
const study = new URL("../../planning/reference/interface-study/blue-glass.html", import.meta.url);

test.skipIf(!chrome)("The bag inspects the item under the mouse or keyboard focus", async () => {
  const profile = mkdtempSync(join(tmpdir(), "snark-items-"));
  const browser = Bun.spawn([chrome!, "--headless=new", ...CHROME_FLAGS, "--no-first-run", "--disable-extensions",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  let tab: Awaited<ReturnType<typeof devtools>> | undefined;
  try {
    const page = tab = await devtools(profile);
    const key = async (key: string, code: string) => {
      const keyCode = key === "Enter" ? 13 : key === "Escape" ? 27 : key.toUpperCase().charCodeAt(0);
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, text: key === "Enter" ? "\r" : "" });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
    };
    const preview = () => page.value<string>("document.querySelector('#focusName').textContent");
    await page.send("Page.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await page.send("Page.navigate", { url: study.href });
    await until(() => page.value<boolean>("document.querySelector('#stage')?.dataset.ready === 'true'"), "opening the study");
    await key("i", "KeyI");
    expect(await preview()).toBe("Stone pick");

    const [x, y] = await page.value<[number, number]>(`(() => {
      const box = document.querySelector('[data-key="item-spyglass"]').getBoundingClientRect();
      return [box.x + box.width / 2, box.y + box.height / 2];
    })()`);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    expect(await preview()).toBe("Spyglass");
    expect(await page.value<boolean>("document.activeElement.id === 'sheet'")).toBe(true);
    expect(await page.value<boolean>(`document.querySelector('.case-window img').src ===
      document.querySelector('[data-key="item-spyglass"] img').src`)).toBe(true);

    await page.value(`document.querySelector('[data-key="item-ingot"]').focus()`);
    expect(await preview()).toBe("Metal ingot");
    await page.value("document.querySelector('.bag-foot button').focus()");
    await key("Enter", "Enter");
    expect(await page.value<string>("document.querySelector('#sheetTitle').textContent")).toBe("Metal ingot");
    expect(await page.value<string>("document.querySelector('.case-stat-value').textContent")).toBe("×2");
    await key("Escape", "Escape");
    expect(await preview()).toBe("Metal ingot");
  } finally {
    tab?.close();
    browser.kill();
    await browser.exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 60 });
  }
});
