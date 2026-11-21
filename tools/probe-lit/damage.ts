// Native GPU/software agreement for damage numbers (client/core/render/damage-numbers.ts), run under `bun tools/probe.ts --lit`:
// a body hit, a head hit, a kill and a blocked hit drawn by the shell's own detail program on the lit and low poly tiers, and
// by the rasterizer through the glyphs' twin (digits.ts). Their filled and outlined interiors must agree.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { DAMAGE_BLOCKED, DAMAGE_BODY, DAMAGE_HEAD, DAMAGE_KILL, DamageNumbers } from "../../client/core/render/damage-numbers.ts";
import { DRAW_BLEND, DRAW_DETAILS } from "../../client/core/render/packet.ts";
import { corePackBytes } from "../../tests/fixtures/pack.ts";
import { Shot, type LitCheck } from "./shot.ts";
import { spread } from "../probe-textured.ts";
import { provingView } from "../snap.ts";
import { encodePng } from "../snap/png.ts";

const W = 640, H = 480, out = resolve("var/damage-numbers-gpu");
const pictures = new Map<string, { pixels: Uint8ClampedArray; where: Uint8Array }>();

export const damageCheck: LitCheck = {
  name: "damage numbers",
  shots() {
    mkdirSync(out, { recursive: true });
    return ["medium", "lowpoly"].map((tier) => {
      const view = provingView(W, H);
      view.scene.assets.tier = tierOf(tier);
      view.scene.plainSky = true;
      view.cam.yaw = view.cam.pitch = 0;
      const p = view.scene.build(view.cam, null);
      p.tileCount = p.casterCount = p.cascadeCount = p.drawCount = 0;
      view.raster.render(p);
      const without = view.raster.color.slice();
      const numbers = new DamageNumbers(), c = view.cam;
      numbers.hit(c.x - 1.2, c.y + 0.4, c.z + 6, 37, DAMAGE_BODY, 0);
      numbers.hit(c.x + 1.3, c.y + 0.5, c.z + 8, 112, DAMAGE_HEAD, 0);
      numbers.hit(c.x, c.y - 0.5, c.z + 5, 1250, DAMAGE_KILL, 0);
      numbers.hit(c.x + 2, c.y - 0.6, c.z + 9, 4, DAMAGE_BLOCKED, 0);
      numbers.build(c, 300);
      p.detailCount = 0;
      numbers.write(p);
      p.drawCount = 1;
      p.drawFlags[0] = DRAW_DETAILS | DRAW_BLEND;
      p.drawFirst[0] = 0;
      p.drawInstances[0] = p.detailCount;
      p.drawPass[0] = 0;
      view.raster.render(p);
      const pixels = view.raster.color.slice(), where = new Uint8Array(W * H);
      for (let i = 0; i < where.length; i++) if ([0, 1, 2].some((k) => Math.abs(pixels[i * 4 + k]! - without[i * 4 + k]!) >= 3)) where[i] = 1;
      const shot = new Shot(`damage-${tier}`, W, H, view.hf, corePackBytes());
      shot.add(p, true);
      pictures.set(shot.key, { pixels, where });
      writeFileSync(resolve(out, `${shot.key}-software.png`), encodePng(W, H, pixels));
      return shot;
    });
  },
  judge(back) {
    const lines: string[] = [];
    let ok = true;
    for (const [key, { pixels, where }] of pictures) {
      const gpu = back.pixels(key, 0);
      if (!gpu) {
        ok = false;
        lines.push(`${key}: no native readback`);
        continue;
      }
      writeFileSync(resolve(out, `${key}-gpu.png`), encodePng(W, H, gpu));
      const error: number[] = [];
      // Within a fill or an outline, away from the soft edges between them (and the world), which the shader and the twin
      // smooth a little differently: the number all round, and the software picture flat there.
      const flat = (i: number, j: number): boolean => [0, 1, 2].every((k) => Math.abs(pixels[i * 4 + k]! - pixels[j * 4 + k]!) <= 4);
      const inside = (i: number): boolean => {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (!where[i + dy * W + dx]) return false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!flat(i, i + dy * W + dx)) return false;
        return true;
      };
      for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) {
        const i = y * W + x;
        if (!inside(i)) continue;
        error.push(Math.max(...[0, 1, 2].map((k) => Math.abs(pixels[i * 4 + k]! - gpu[i * 4 + k]!))));
      }
      const s = spread(error), pass = s.points >= 500 && s.p95 <= 6;
      ok &&= pass;
      lines.push(`${key}: ${s.points} interior pixels, p95 ${s.p95}/255, worst ${s.worst}/255; ${pass ? "ok" : "FAIL"}`);
    }
    return { ok, lines };
  },
};
