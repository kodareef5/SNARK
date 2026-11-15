// A scene whose levels arrive over a slow link: no frame draws what the card lacks, and the last is the whole pack's
// picture. Apart from render.test.ts, whose frames it would wait behind, so the two run side by side.

import { expect, test } from "bun:test";
import { provingView } from "../../tools/snap.ts";

test("a scene whose levels stream never draws what the card lacks, and ends with the picture the whole pack gives", () => {
  const [whole, stream] = [provingView(320, 180), provingView(320, 180, { latencyMs: 150, bytesPerSecond: 300e3 })];
  for (const view of [whole, stream]) {
    // Three metres from the survivor, so its finest level is wanted.
    view.cam.yaw = 0;
    view.cam.x = view.remote.x[0]!;
    view.cam.y = view.remote.y[0]! + 1.5;
    view.cam.z = view.remote.z[0]! - 3;
  }
  whole.render();
  const first = stream.render();
  // The first frame has the boot pack alone: every body part at its coarsest, and nothing left out.
  const head = stream.pack.meshIndex.get("core:human_m/head")!;
  const level = (p: typeof first): number => p.drawLod[[...Array(p.drawCount).keys()].find((i) => p.drawMesh[i] === head)!]!;
  expect([level(first), first.skipped, first.drawCount]).toEqual([2, 0, whole.scene.packet.drawCount]);
  expect(stream.raster.color).not.toEqual(whole.raster.color);
  let uploads = first.assetUploads.length;
  // The rasterizer throws at a draw of anything not uploaded, so each of these frames is a check.
  for (let ms = 100; ms <= 6000; ms += 100) {
    stream.port!.advance(ms);
    stream.scene.now = ms;
    uploads += stream.render().assetUploads.length;
  }
  expect([level(stream.scene.packet), stream.scene.assets.residency.flying]).toEqual([0, 0]);
  expect(uploads).toBeGreaterThan(first.assetUploads.length + 4);
  expect(stream.raster.color).toEqual(whole.raster.color);
});
