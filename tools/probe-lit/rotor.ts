// Native GPU/software agreement for rotor cards, run under the existing `bun tools/probe.ts --lit` probe.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_BLEND, DRAW_DETAILS } from "../../client/core/render/packet.ts";
import { RotorBlur } from "../../client/core/render/rotor-blur.ts";
import { HELICOPTER_VEHICLE } from "../../content/vehicles/helicopter.ts";
import { corePackBytes } from "../../tests/fixtures/pack.ts";
import { Shot, type LitCheck } from "./shot.ts";
import { spread } from "../probe-textured.ts";
import { provingView } from "../snap.ts";
import { encodePng } from "../snap/png.ts";

const W = 320, H = 240, out = resolve("var/helicopter-preview/rotor-gpu");
const pictures = new Map<string, { pixels: Uint8ClampedArray; where: Uint8Array }>();

export const rotorCheck: LitCheck = {
  name: "rotor swept coverage",
  shots() {
    mkdirSync(out, { recursive: true });
    return ["medium", "lowpoly"].map(tier => {
      const view = provingView(W, H);
      view.scene.assets.tier = tierOf(tier); view.scene.plainSky = true;
      view.cam.yaw = view.cam.pitch = 0;
      const p = view.scene.build(view.cam, null);
      p.tileCount = p.casterCount = p.cascadeCount = p.drawCount = 0;
      view.raster.render(p); const without = view.raster.color.slice();
      const blur = new RotorBlur();
      const q = [new Float64Array([Math.sin(.6), 0, 0, Math.cos(.6)]), new Float64Array([0, Math.sin(.6), 0, Math.cos(.6)])];
      for (let i = 0; i < 2; i++) {
        p.bones.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], i * 12);
        blur.add(p, i, i, { ...HELICOPTER_VEHICLE.rotors[i]!, at: [0, 0, 0] }, 410, q[i]!, i ? 3.5 : -2.5, 0, 15, i ? 3 : 1);
      }
      blur.write(p);
      p.drawCount = 1; p.drawFlags[0] = DRAW_DETAILS | DRAW_BLEND;
      p.drawFirst[0] = 0; p.drawInstances[0] = p.detailCount; p.drawPass[0] = 0;
      view.raster.render(p);
      const pixels = view.raster.color.slice(), where = new Uint8Array(W * H);
      for (let i = 0; i < where.length; i++) if ([0, 1, 2].some(c => Math.abs(pixels[i * 4 + c]! - without[i * 4 + c]!) >= 3)) where[i] = 1;
      const shot = new Shot(`rotor-${tier}`, W, H, view.hf, corePackBytes()); shot.add(p, true);
      pictures.set(shot.key, { pixels, where });
      writeFileSync(resolve(out, `${shot.key}-software.png`), encodePng(W, H, pixels));
      return shot;
    });
  },
  judge(back) {
    const lines: string[] = []; let ok = true;
    for (const [key, { pixels, where }] of pictures) {
      const gpu = back.pixels(key, 0);
      if (!gpu) { ok = false; lines.push(`${key}: no native readback`); continue; }
      writeFileSync(resolve(out, `${key}-gpu.png`), encodePng(W, H, gpu));
      const error: number[] = [];
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        const i = y * W + x;
        if (!where[i] || !where[i - 1] || !where[i + 1] || !where[i - W] || !where[i + W]) continue;
        error.push(Math.max(...[0, 1, 2].map(c => Math.abs(pixels[i * 4 + c]! - gpu[i * 4 + c]!))));
      }
      const s = spread(error), pass = s.points >= 1000 && s.p95 <= 3;
      ok &&= pass;
      lines.push(`${key}: ${s.points} interior pixels, p95 ${s.p95}/255, worst ${s.worst}/255; ${pass ? "ok" : "FAIL"}`);
    }
    return { ok, lines };
  },
};

