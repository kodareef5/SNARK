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

async function atDesk(run: (page: Page) => Promise<void>): Promise<void> {
  const profile = mkdtempSync(join(tmpdir(), "snark-field-"));
  const browser = Bun.spawn([chrome!, "--headless=new", ...CHROME_FLAGS, "--remote-debugging-port=0",
    "--user-data-dir=" + profile, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  let tab: Page | undefined;
  try {
    const page = tab = await devtools(profile);
    await page.send("Page.enable");
    await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 810, deviceScaleFactor: 1, mobile: false });
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await page.send("Page.navigate", { url: study.href });
    await until(() => page.value<boolean>("!!document.querySelector('#stage[data-ready=true] #pcRadio')"), "desktop radio");
    await run(page);
  } finally {
    tab?.close();
    browser.kill();
    await browser.exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

async function click(page: Page, selector: string): Promise<void> {
  const [x, y] = await page.value<[number, number]>(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  })()`);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function key(page: Page, name: string, code: string, keyCode: number, text = ""): Promise<void> {
  const payload = { key: name, code, windowsVirtualKeyCode: keyCode };
  await page.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...payload, text });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...payload });
}

test.skipIf(!chrome)("A desktop pin needs a chosen point and confirmation", () => atDesk(async page => {
  const box = () => page.value<[number, number]>("(() => { const r = document.querySelector('#lensMap').getBoundingClientRect(); return [r.width, r.right]; })()");
  const uses = () => page.value<number>("Number(document.querySelector('#reticle').dataset.uses || 0)");
  const [width, edge] = await box();
  expect(width).toBeGreaterThan(190);
  const before = await uses();
  await click(page, "#chartButton");
  expect((await box())[0]).toBeGreaterThan(width + 70);
  expect((await box())[1]).toBeCloseTo(edge, 0);
  await click(page, "#lensMapCanvas");
  expect(await page.value<boolean>("document.querySelector('#lensMapPin').hidden")).toBe(true);
  await click(page, "#lensMapTools");
  const playerWidth = () => page.value<number>("document.querySelector('#lensMapPaper [data-map-self]').getBoundingClientRect().width");
  const bearingWidth = await playerWidth();
  await click(page, "#lensMapIn");
  expect(await playerWidth()).toBeCloseTo(bearingWidth, 0);
  expect(await page.value<string>("document.querySelector('#lensMap').dataset.zoom")).toBe("1.5");
  await click(page, "#lensMapMark");
  await click(page, "#lensMapCanvas");
  expect(await page.value<boolean>("document.querySelector('#lensMapPin').hidden")).toBe(true);
  expect(await page.value<boolean>("document.querySelector('#lensMapPending').hidden")).toBe(false);
  await click(page, "#lensMapSave");
  const survivorPosition = () => page.value<string>("document.querySelector('#chartSurface [data-map-self]').style.cssText");
  const origin = await survivorPosition();
  await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "w", code: "KeyW", windowsVirtualKeyCode: 87 });
  await until(async () => (await survivorPosition()) !== origin, "movement beside the open map", 2000);
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w", code: "KeyW", windowsVirtualKeyCode: 87 });
  await click(page, "#lensMapClose");
  expect(await page.value<boolean>("document.querySelector('#pcMapPin').hidden")).toBe(false);
  expect((await box())[0]).toBeCloseTo(width, 0);
  expect(await uses()).toBe(before);
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  await until(() => page.value<boolean>("!document.querySelector('#pcRadio')"), "mobile controls");
  await click(page, "#chartButton");
  expect(await page.value<boolean>("document.querySelector('#lensMapPin').hidden")).toBe(false);
}));

test.skipIf(!chrome)("Desktop radio preserves drafts, recalls lines and shields combat keys", () => atDesk(async page => {
  const message = () => page.value<string>("document.querySelector('#lensMessage').value");
  const slot = () => page.value<string>("document.querySelector('[data-pc-slot][aria-pressed=true]').dataset.pcSlot");
  const start = await slot();
  await key(page, "Enter", "Enter", 13);
  expect(await page.value<string>("document.activeElement.id")).toBe("lensMessage");
  await key(page, "4", "Digit4", 52, "4");
  await key(page, "w", "KeyW", 87, "w");
  await page.send("Input.insertText", { text: " at the bridge" });
  expect(await message()).toBe("4w at the bridge");
  expect(await slot()).toBe(start);
  await key(page, "Tab", "Tab", 9);
  expect(await page.value<string>("document.querySelector('#lensChannel span').textContent")).toBe("Tribe");
  await page.send("Input.insertText", { text: "Crossing now" });
  await key(page, "Enter", "Enter", 13);
  expect(await page.value<string>("document.querySelector('#pcRadioLog').textContent")).toContain("Crossing now");
  expect(await page.value<boolean>("document.querySelector('#lensChat').hidden")).toBe(true);
  await key(page, "Enter", "Enter", 13);
  await key(page, "ArrowUp", "ArrowUp", 38);
  expect(await message()).toBe("Crossing now");
  await key(page, "ArrowDown", "ArrowDown", 40);
  expect(await message()).toBe("");
  await key(page, "Tab", "Tab", 9);
  await key(page, "Tab", "Tab", 9);
  expect(await message()).toBe("4w at the bridge");
  await key(page, "Escape", "Escape", 27);
  expect(await page.value<boolean>("document.querySelector('#lensChat').hidden")).toBe(true);
  expect(await page.value<string>("document.activeElement.id")).toBe("pcRadioCompose");
  await key(page, "4", "Digit4", 52, "4");
  expect(await slot()).toBe("3");
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  await until(() => page.value<boolean>("!document.querySelector('#pcRadio')"), "mobile radio");
  await click(page, "#lensChatToggle");
  expect(await message()).toBe("4w at the bridge");
}));
