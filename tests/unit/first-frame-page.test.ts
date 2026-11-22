// The admin's first-frame page (client/core/admin/first-frame.ts): the budget's bar split into its parts and the room
// left, a map's landmarks on it, the script's folders, the largest modules, and each change against the last build.

import { expect, test } from "bun:test";
import { barHtml, changeHtml, firstFrameView, type FirstFrameJson } from "../../client/core/admin/first-frame.ts";

const KB = 1024;
const weighed = (over: Partial<FirstFrameJson> = {}): FirstFrameJson => ({
  at: "2026-11-22T12:00:00.000Z", commit: "abcdef1234567", clean: true, quick: false, budget: 1088 * KB, total: 1080 * KB, room: 8 * KB,
  parts: [{ name: "the page's script", bytes: 526 * KB, files: [] }, { name: "the boot pack", bytes: 343 * KB, files: [] }, { name: "the <content>", bytes: 211 * KB, files: [] }],
  maps: [{ map: "miami", total: 1088.5 * KB, room: -0.5 * KB, landmarks: [{ name: "cruise", bytes: 6.5 * KB, }, { name: "koru", bytes: 2 * KB }] }],
  modules: [{ file: "client/core/render/scene.ts", bytes: 26 * KB, raw: 86 * KB }, { file: "client/core/app.ts", bytes: 15 * KB, raw: 49 * KB }],
  folders: [{ file: "client/core/render", bytes: 180 * KB, raw: 517 * KB }, { file: "client/core", bytes: 83 * KB, raw: 236 * KB }],
  previous: { at: "2026-11-22T10:00:00.000Z", commit: "0123456789", quick: false, total: 1082 * KB, parts: [{ name: "the page's script", bytes: 528 * KB }], maps: [{ map: "miami", total: 1090 * KB }], modules: [{ file: "client/core/app.ts", bytes: 16 * KB, raw: 0 }] },
  ...over,
});

test("the bar is the budget split into its parts and the room left, each part's share of it in turn", () => {
  const html = barHtml([{ name: "a", bytes: 25 }, { name: "b", bytes: 50 }], 100, 25);
  expect([...html.matchAll(/width:([\d.]+)%/g)].map((m) => Number(m[1]))).toEqual([25, 50, 25]);
  expect(html).toContain('class="room"');
  expect([changeHtml(10, 10), changeHtml(2048, 1024), changeHtml(1024, 2048), changeHtml(5, undefined)]).toEqual(['<span class="dim">same</span>', '<span class="warn">+1.0 KB</span>', '<span class="well">-1.0 KB</span>', ""]);
});

test("the page says the total, the room and the change, a map with its landmarks, and the script's folders and modules", () => {
  const core = firstFrameView(weighed());
  expect(core.summary).toContain('<b class="warn">1080.0 KB</b> of 1088.0 KB for every map, 8.0 KB left <span class="well">-2.0 KB</span>');
  expect(core.parts).toContain("the &#60;content&#62;");
  expect(core.parts).toContain('<span class="well">-2.0 KB</span>');
  expect(core.maps).toContain('<td class="bad">0.5 KB over</td>');
  expect(core.modules.indexOf("scene.ts")).toBeLessThan(core.modules.indexOf("app.ts"));
  expect(core.modules).toContain('<span class="warn">+26.0 KB</span>');
  expect(core.modules).toContain('<span class="well">-1.0 KB</span>');
  const miami = firstFrameView(weighed(), "miami");
  expect(miami.summary).toContain('<b class="bad">1088.5 KB</b> of 1088.0 KB on miami, <b class="bad">0.5 KB over</b> <span class="well">-1.5 KB</span>');
  expect(miami.parts).toContain("landmark cruise");
  // Over the budget, the bar's scale is the total, and there is no room.
  expect(miami.bar).not.toContain('class="room"');
  expect(firstFrameView(weighed({ previous: null })).summary).not.toContain("change is against");
});
