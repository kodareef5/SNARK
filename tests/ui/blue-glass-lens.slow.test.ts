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
type Finger = { id: number; x: number; y: number };

async function onPhone(width: number, height: number, run: (page: Page) => Promise<void>): Promise<void> {
  const profile = mkdtempSync(join(tmpdir(), "snark-lens-"));
  const browser = Bun.spawn([chrome!, "--headless=new", ...CHROME_FLAGS, "--no-first-run", "--disable-extensions",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  let tab: Page | undefined;
  try {
    const page = tab = await devtools(profile);
    await page.send("Page.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await page.send("Page.navigate", { url: study.href });
    await until(() => page.value<boolean>("document.querySelector('#stage')?.dataset.ready === 'true'"), "study opening");
    await run(page);
  } finally {
    tab?.close();
    browser.kill();
    await browser.exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

function hands(page: Page) {
  const point = async (selector: string, id: number) => {
    const [x, y] = await page.value<[number, number]>(`(() => {
      const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    })()`);
    return { x, y, id };
  };
  const fingers = (type: string, ...touchPoints: Finger[]) => page.send("Input.dispatchTouchEvent", { type, touchPoints });
  const tap = async (selector: string) => {
    await fingers("touchStart", await point(selector, 1));
    await fingers("touchEnd");
  };
  return { point, fingers, tap };
}

test.skipIf(!chrome)("Map touches keep their owner while the other thumb plays", () => onPhone(844, 390, async page => {
  const { point, fingers, tap } = hands(page);
  const useCount = () => page.value<number>("Number(document.querySelector('#reticle').dataset.uses || 0)");
  await tap("#chartButton");
  expect(await page.value<string>("document.querySelector('#lensMap').dataset.mode")).toBe("peek");
  const uses = await useCount();
  await tap("#lensMapCanvas");
  expect(await useCount()).toBe(uses);
  await tap("#lensMapTools");
  await tap("#lensMapIn");
  expect(await page.value<string>("document.querySelector('#lensMap').dataset.zoom")).toBe("1.5");
  await tap("#lensMapMark");
  const mapFinger = await point("#lensMapCanvas", 1);
  const worldFinger = { id: 2, x: 462, y: 175 };
  await fingers("touchStart", mapFinger);
  await fingers("touchStart", mapFinger, worldFinger);
  expect(await page.value<boolean>("!!document.querySelector('.sn-touch-dial[data-hand=action]')")).toBe(true);
  await fingers("touchEnd", mapFinger);
  await fingers("touchEnd");
  expect(await useCount()).toBe(uses + 1);
  expect(await page.value<boolean>("document.querySelector('#lensMapPin').hidden")).toBe(true);
  expect(await page.value<boolean>("document.querySelector('#lensMapPending').hidden")).toBe(false);
  await tap("#lensMapSave");
  expect(await page.value<boolean>("document.querySelector('#lensMapPin').hidden")).toBe(false);
  await tap("#lensMapClose");
  expect(await page.value<boolean>("document.querySelector('#lensMapFace').hidden")).toBe(true);
}));

test.skipIf(!chrome)("A portrait HUD shows depletion, recovery, radio channels and frame rate", () => onPhone(390, 844, async page => {
  const { tap } = hands(page);
  const state = (selector: string) => page.value<string>(`document.querySelector(${JSON.stringify(selector)}).dataset.state`);
  await tap("#conditions");
  await tap('[data-scenario="exposure"]');
  expect(await state('#meters [data-vital="health"]')).toBe("low");
  expect(await state('#meters [data-vital="water"]')).toBe("empty");
  expect(await page.value<string>("document.querySelector('#lensStatus [data-vital=water] small').textContent")).toBe("Dehydrated");
  await tap('[data-scenario="recovery"]');
  expect(await state('#meters [data-vital="water"]')).toBe("rising");
  await tap('[data-scenario="dive"]');
  expect(await state('#meters [data-vital="oxygen"]')).toBe("low");
  await tap('[data-scenario="field"]');
  expect(await state('#meters [data-vital="water"]')).toBe("steady");
  expect(await page.value<boolean>("document.querySelector('#meters [data-vital=oxygen]').hidden")).toBe(true);
  await tap("#lensStatusClose");
  await tap("#lensChatToggle");
  await page.send("Input.insertText", { text: "At the bridge" });
  await tap("#lensSend");
  expect(await page.value<string>("document.querySelector('#lensChatLog').textContent")).toContain("At the bridge");
  await tap("#lensChannel");
  expect(await page.value<string>("document.querySelector('#lensChannel span').textContent")).toBe("Tribe");
  expect(await page.value<string>("document.querySelector('#lensChatLog').textContent")).toBe("");
  await tap("#lensChatClose");
  await tap("#lensTelemetryToggle");
  await until(() => page.value<boolean>("Number(document.querySelector('#lensMetricFPS').textContent) > 0"), "frame sample");
  const { fingers } = hands(page);
  await fingers("touchStart", { id: 1, x: 106, y: 465 });
  await fingers("touchMove", { id: 1, x: 145, y: 445 });
  await until(() => page.value<boolean>("Number(document.querySelector('#lensMetricX').textContent) !== 0"), "coordinate update");
  await fingers("touchEnd");
  expect(await page.value<boolean>("Number(document.querySelector('#lensMetricY').textContent) !== 0")).toBe(true);
}));
