// Native GPU/software agreement for an orb's screen (client/core/render/orb.ts), run under `bun tools/probe.ts --lit`:
// each scene drawn by the shell's own program `orb` on medium and on low poly, from where its pucks show and from far
// off, and by the rasterizer through the scenes' twins. The shell is a box until the art has one: the program works a
// pixel's place on the ball out from where it is, whatever mesh it is drawn on.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import "../../client/core/render/orb-late.ts";
import { DRAW_ORB } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { ORB_SCENES, type OrbSite } from "../../shared/world/orb.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import type { TideEyeSite } from "../../shared/world/tide-eye.ts";
import { grayboxMeshes } from "../pack/build.ts";
import { boxMesh, buildPack } from "../pack/write.ts";
import { spread } from "../probe-textured.ts";
import { Rasterizer } from "../snap/raster.ts";
import { encodePng } from "../snap/png.ts";
import { Shot, type LitCheck } from "./shot.ts";

const W = 320, H = 240, out = resolve("var/orb/probe");
const SITE: OrbSite = { name: "Sphere", x: 1000, y: 0, z: 1000, yaw: 9000, radius: 78, centre: 34 };
const BLUE: TideEyeSite = { name: "Sphere", x: 1000, y: 0, z: 1210, yaw: 0, color: "blue", radius: 28 };
/** Each scene's moment: seconds on the server's clock and the hour, so the eye is at power, the planet is up, and the storm's own lightning is lit. */
const MOMENTS: readonly (readonly [seconds: number, hour: number])[] = [[380, 17.5], [372, 9], [381.4, 23], [362.2, 23], [440, 18]];
/** Metres the eye stands south of the ball's middle: where a puck is some four pixels, and where the ball is small. */
const FROM = [60, 420];
const pictures = new Map<string, { pixels: Uint8ClampedArray; where: Uint8Array }[]>();

export const orbCheck: LitCheck = {
  name: "orb scenes",
  shots() {
    mkdirSync(out, { recursive: true });
    const reg = compileContent(CORE_CONTENT).registry!;
    const bytes = buildPack([...grayboxMeshes(CORE_CONTENT), { id: "core:orb/shell", lods: [boxMesh([44, 44, 44], 12)] }], defaultPalette());
    const pack = parsePack(bytes), dims = { chunksX: 32, chunksZ: 32 };
    const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
    return ["medium", "lowpoly"].map((tier) => {
      const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
      const scene = new Scene({ dims, hf, structs, orbs: [SITE], tideEyes: [BLUE] }, reg, pack);
      scene.assets.tier = tierOf(tier);
      scene.plainSky = true;
      scene.viewHeight = H;
      const cam = new Camera();
      cam.aspect = W / H;
      const raster = new Rasterizer(W, H, pack, hf), shot = new Shot(`orb-${tier}`, W, H, hf, bytes.slice()), kept: { pixels: Uint8ClampedArray; where: Uint8Array }[] = [];
      for (let which = 0; which < ORB_SCENES.length; which++) {
        for (const metres of FROM) {
          cam.x = SITE.x + 12;
          cam.y = SITE.y + SITE.centre + 6;
          cam.z = SITE.z - metres;
          scene.orbOnly = which;
          scene.eyeSeconds = MOMENTS[which]![0];
          scene.hour = MOMENTS[which]![1];
          const p = scene.build(cam, null);
          p.tileCount = p.casterCount = p.cascadeCount = 0;
          raster.render(p);
          const pixels = raster.color.slice(), where = new Uint8Array(W * H);
          for (let i = 0; i < where.length; i++) if (raster.pickDraw[i]! >= 0 && (p.drawFlags[raster.pickDraw[i]!]! & DRAW_ORB) !== 0) where[i] = 1;
          shot.add(p, true);
          kept.push({ pixels, where });
          writeFileSync(resolve(out, `${shot.key}-${ORB_SCENES[which]}-${metres}-software.png`), encodePng(W, H, pixels));
        }
      }
      pictures.set(shot.key, kept);
      return shot;
    });
  },
  judge(back) {
    const lines: string[] = [];
    let ok = true;
    for (const [key, kept] of pictures) {
      kept.forEach(({ pixels, where }, frame) => {
        const name = `${ORB_SCENES[frame >> 1]} from ${FROM[frame & 1]} m`, gpu = back.pixels(key, frame);
        if (!gpu) {
          ok = false;
          lines.push(`${key} ${name}: no native readback`);
          return;
        }
        writeFileSync(resolve(out, `${key}-${ORB_SCENES[frame >> 1]}-${FROM[frame & 1]}-gpu.png`), encodePng(W, H, gpu));
        const error: number[] = [];
        // On the screen and a pixel in from its edges, where the card's samples and the rasterizer's one may differ.
        for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
          const i = y * W + x;
          if (!where[i] || !where[i - 1] || !where[i + 1] || !where[i - W] || !where[i + W]) continue;
          error.push(Math.max(...[0, 1, 2].map((c) => Math.abs(pixels[i * 4 + c]! - gpu[i * 4 + c]!))));
        }
        const s = spread(error), pass = s.points >= 500 && s.mean <= 2.5 && s.p95 <= 10;
        ok &&= pass;
        lines.push(`${key} ${name}: ${s.points} pixels of screen, mean ${s.mean.toFixed(2)}/255, p95 ${s.p95}/255, worst ${s.worst}/255; ${pass ? "ok" : "FAIL"}`);
      });
    }
    return { ok, lines };
  },
};
