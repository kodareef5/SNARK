import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { until } from "../../tools/bench/driving-browser.ts";
import { CHROME_FLAGS, findChrome } from "../../tools/chrome.ts";
import { devtools } from "../../tools/map/trip.ts";

const chrome = findChrome();
const study = new URL("../../planning/reference/interface-study/blue-glass.html", import.meta.url);

test.skipIf(!chrome)("Mouse aim, typing and touch each keep their own controls", async () => {
  const profile = mkdtempSync(join(tmpdir(), "snark-field-"));
  const browser = Bun.spawn([chrome!, "--headless=new", ...CHROME_FLAGS, "--no-first-run",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  let tab: Awaited<ReturnType<typeof devtools>> | undefined;
  try {
    const page = tab = await devtools(profile);
    const key = async (key: string, code: string, down: boolean) => {
      await page.send("Input.dispatchKeyEvent", { type: down ? "keyDown" : "keyUp", key, code });
    };
    const press = async (name: string, code = name) => { await key(name, code, true); await key(name, code, false); };
    const clickField = async () => {
      for (const type of ["mousePressed", "mouseReleased"]) {
        await page.send("Input.dispatchMouseEvent", { type, x: 430, y: 308, button: "left", clickCount: 1 });
      }
    };
    const locked = () => page.value<boolean>("document.pointerLockElement?.id === 'field'");
    const uses = () => page.value<number>("Number(document.querySelector('#reticle').dataset.uses || 0)");
    const coordinate = () => page.value<number>("Number(document.querySelector('#lensMetricX').textContent)");
    await page.send("Page.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1152, height: 720, deviceScaleFactor: 1, mobile: false });
    await page.send("Page.navigate", { url: study.href });
    await until(() => page.value<boolean>("document.querySelector('#stage')?.dataset.ready === 'true'"), "opening desktop");
    expect(await page.value("!!document.querySelector('#pcShelf') && !document.querySelector('.sgr-opener')")).toBe(true);
    await page.send("Page.bringToFront");
    await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await clickField();
    await until(locked, "capturing the mouse");
    expect(await uses()).toBe(0);
    await clickField();
    expect(await uses()).toBe(1);
    await press("F3");
    expect(await locked()).toBe(true);
    await key("w", "KeyW", true);
    await until(async () => await coordinate() > 0, "moving east");
    await key("w", "KeyW", false);
    await press("Enter");
    await until(() => page.value<boolean>("document.activeElement?.id === 'lensMessage' && !document.pointerLockElement"), "typing with a free cursor");
    const before = await coordinate();
    await key("w", "KeyW", true);
    await page.send("Input.insertText", { text: "4 west" });
    await key("w", "KeyW", false);
    await press("Escape");
    await press("F3");
    expect(await coordinate()).toBe(before);
    expect(await page.value("document.querySelector('[data-pc-slot][aria-pressed=true]').dataset.pcSlot")).toBe("0");
    await press("4", "Digit4");
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
    await until(() => page.value<boolean>("!!document.querySelector('#leftWheel .sgr-opener') && !document.querySelector('#pcShelf')"), "switching to touch");
    expect(await page.value("document.querySelector('#bar .chosen').getAttribute('aria-label')")).toBe("4 · Bow");
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await until(() => page.value<boolean>("!!document.querySelector('#pcShelf') && !document.querySelector('#leftWheel .sgr-opener')"), "returning to mouse");
    expect(await page.value("document.querySelector('[data-pc-slot][aria-pressed=true]').dataset.pcSlot")).toBe("3");
    await press("Enter");
    expect(await page.value("document.querySelector('#lensMessage').value")).toBe("4 west");
  } finally {
    tab?.close();
    browser.kill();
    await browser.exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 60 });
  }
});
