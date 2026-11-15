// The device probe's ladder and soaks: whole runs of a client on the harness, as a phone's page makes them, of the ladder,
// a rung that is invalid, the soak and the governed soak. Beside device.test.ts, on the page they share
// (tests/fixtures/device.ts).

import { expect, test } from "bun:test";
import { JOIN_MS } from "../../client/core/governor.ts";
import { DeviceProbe, MEMORY_MB } from "../../client/core/device.ts";
import { deviceTable } from "../../client/core/devicetext.ts";
import { lacking } from "../../tools/device.ts";
import { TIMING, TOKEN, browser, client, renderer, run } from "../fixtures/device.ts";

test("the ladder climbs until a rung breaks, asks the server for the base, and ends taking texture memory until the device refuses it", async () => {
  const { h, pack, app, expected } = client();
  // A display twice as fast as the harness draws: no rung holds its rate, so each axis stops at its first.
  const { b, asked } = browser({ clock: () => h.now, expected, mode: "ladder", frameMs: 8.3 });
  const probe = new DeviceProbe(TOKEN, b, TIMING);
  expect(await probe.before()).toBe(true);
  const card = renderer(300);
  probe.attach({ app, pack, reg: h.reg, hf: h.world.hf }, card.r);
  await run(probe, h, app, card.r, 60000);
  const r = probe.report;
  expect([r.mode, r.done, r.errors]).toEqual(["ladder", true, []]);
  const l = r.ladder!;
  expect(l.display).toBe(8.3);
  expect(l.rungs.map((g) => `${g.tier} ${g.axis} ${g.n} ${g.held}`)).toEqual(["lowpoly", "medium", "high"].flatMap((t) => [`${t} bodies 25 false`, `${t} triangles 8 false`, `${t} draws 256 false`, `${t} pieces 64 false`]));
  // The harness frames take its 16.7 ms while our code takes 1.5, so the GPU is said to have taken the frame.
  expect(l.rungs.every((g) => g.limit === "the GPU")).toBe(true);
  // The base was asked for on each tier's pieces rung, and let go after.
  expect(asked).toEqual([64, 0, 64, 0, 64, 0]);
  // Every amount was sampled and read back as the colour its blocks decode to; the harness's frames are slow for a display this fast.
  const rung = { frameMs: 16.7, p95: 16.7, worst: 16.7, oursMs: 0, held: false };
  expect(l.memory).toEqual({ variant: "astc", gameMB: 0, heldMB: 256, failedMB: 512, slowMB: 128, how: "out of memory", rungs: [{ mb: 128, ...rung }, { mb: 256, ...rung }] });
  expect(card.tiles()).toBe(0);
  expect(MEMORY_MB[2]).toBe(512);
  // The probe binds its textures only on units the renderer leaves free.
  expect([...card.gl.boundOn].sort((a, b) => a - b)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  const table = deviceTable(r);
  expect(table).toContain("memory    256 MB of astc textures held and sampled besides the game's 0 MB; frames first fell behind the display's rate at 128 MB; frames 128 MB 16.7! ms, 256 MB 16.7! ms; at 512 MB: out of memory");
  expect(table.some((line) => line.startsWith("broke     medium bodies 25: frames 16.7 ms"))).toBe(true);
});

test("the soak counts a long frame while the page is shown as a stall, and leaves out only the time the page was hidden", async () => {
  const { h, pack, app, expected } = client();
  let offset = 0;
  const { b } = browser({ clock: () => h.now + offset, expected, mode: "soak" });
  const probe = new DeviceProbe(TOKEN, b, { ...TIMING, soakMs: 5000 });
  await probe.before();
  const { r: gpu } = renderer();
  probe.attach({ app, pack, reg: h.reg, hf: h.world.hf }, gpu);
  let frames = 0;
  const each = (): void => {
    if (probe.report.stage !== "soak") return;
    // Hidden for 5 s, then shown; later a stall of 2.5 s with the page shown all the while.
    if (++frames === 60) {
      probe.visible(false);
      offset += 5000;
      probe.visible(true);
    }
    if (frames === 120) offset += 2500;
  };
  await run(probe, h, app, gpu, 60000, { each, clock: (now) => now + offset });
  const s = probe.report.soak!;
  expect([probe.report.done, probe.report.errors, s.hidden, s.hiddenMs, s.minutes.length]).toEqual([true, [], 1, 5000, 1]);
  const m = s.minutes[0]!;
  expect(m.frameMs.worst).toBeGreaterThanOrEqual(2500);
  expect(m.frameMs.worst).toBeLessThan(3000);
  expect(m.long).toBe(1);
  // The stall took its share of the soak's 5 s, so fewer frames were drawn in it; the hidden 5 s took none.
  expect(m.frames).toBeGreaterThan((5000 - 2600) / 16.7 - 2);
  expect(m.frames).toBeLessThan((5000 - 2400) / 16.7 + 2);
  expect(deviceTable(probe.report).some((line) => /^1 +\d+ +16\.7 +16\.7 +16\.7 +25\d\d\.\d +[\d.]+ +[\d.]+ +\d+ +1 +0$/.test(line))).toBe(true);
});

test("the governed soak lets the governor act, says beside each minute what it did, and holds it at the tier after", async () => {
  const { h, pack, app, expected } = client();
  const { b } = browser({ clock: () => h.now, expected, mode: "governed" });
  const probe = new DeviceProbe(TOKEN, b, { ...TIMING, soakMs: 5000 });
  await probe.before();
  const { r: gpu } = renderer();
  probe.attach({ app, pack, reg: h.reg, hf: h.world.hf }, gpu);
  app.governor.held = 0;
  let held: unknown = "never";
  // The harness draws in no time, so the governor is told of frames of 30 ms, which no step makes faster, on a clock
  // past the wait that follows the soak's tier.
  const each = (now: number): void => {
    if (probe.report.stage !== "soak") return;
    held = app.governor.held;
    app.governor.frame(now + JOIN_MS, 30, 1, false, 1e6);
  };
  await run(probe, h, app, gpu, 60000, { each });
  const s = probe.report.soak!;
  expect([probe.report.done, probe.report.errors, held, app.governor.held, s.minutes.length]).toEqual([true, [], null, 0, 1]);
  // Two missed windows took a step: the far trees', the leaves' passed by with no crowns near to give.
  expect(s.governed!.map((x) => x.level)).toEqual([2]);
  expect([s.minutes[0]!.level, s.minutes[0]!.most, s.minutes[0]!.steps!.length]).toEqual([2, 2, 1]);
  const table = deviceTable(probe.report);
  expect(table.some((line) => line.includes("the governor on"))).toBe(true);
  expect(table.some((line) => line.startsWith("          to 2: far trees, rocks and bushes to 70% as far (30 ms a frame)"))).toBe(true);
  const lacks = lacking(probe.report, "governed");
  expect([lacks.includes("the soak did not run its minutes"), lacks.includes("the governed soak does not say what the governor did")]).toEqual([false, false]);
});

test("a rung that did not draw all it was given, or never settled, is invalid: neither held nor broke, and not counted as held", async () => {
  const { h, pack, app, expected } = client();
  // A display the harness keeps up with, so every rung would hold on its frames alone.
  const { b } = browser({ clock: () => h.now, expected, mode: "ladder" });
  const probe = new DeviceProbe(TOKEN, b, { ...TIMING, settleMs: 300 });
  await probe.before();
  const card = renderer(300);
  probe.attach({ app, pack, reg: h.reg, hf: h.world.hf }, card.r);
  // Ten draws skipped and ten things dropped every frame, as an outside review did.
  await run(probe, h, app, card.r, 60000, { tamper: (p) => void ((p.skipped += 10), (p.dropped += 10)) });
  const r = probe.report;
  expect([r.done, r.errors]).toEqual([true, []]);
  const rungs = r.ladder!.rungs;
  expect(rungs.map((g) => `${g.tier} ${g.axis} ${g.n}`)).toEqual(["lowpoly", "medium", "high"].flatMap((t) => [`${t} bodies 25`, `${t} triangles 8`, `${t} draws 256`, `${t} pieces 64`]));
  for (const g of rungs) {
    expect([g.held, g.limit, g.settled]).toEqual([false, "", false]);
    expect(g.invalid).toMatch(/^\d+ things dropped, \d+ draws skipped, never settled$/);
  }
  const table = deviceTable(r);
  expect(table).toContain("lowpoly  none; 25 invalid         none; 8 invalid          none; 256 invalid        none; 64 invalid");
  expect(table.some((line) => line.startsWith("most held 0 bodies, 0 pieces, 0 triangles, 0 draws"))).toBe(true);
  expect(table.some((line) => line.startsWith("invalid   medium bodies 25: ") && line.includes("draws skipped, never settled"))).toBe(true);
  expect(table.some((line) => line.startsWith("broke "))).toBe(false);
});
