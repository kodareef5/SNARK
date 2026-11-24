// Native GPU/software agreement for an orb's screen (client/core/render/orb.ts), run under `bun tools/probe.ts --lit`:
// each scene drawn by the shell's own program `orb` on medium and on low poly, from where its pucks show and from far
// off, and by the rasterizer through the scenes' twins. The shell is a box until the art has one: the program works a
// pixel's place on the ball out from where it is, whatever mesh it is drawn on. Then the light the ball casts by night
// (client/core/render/orb-light.ts): the ground and the plinth at its foot on medium with the light on, where the
// rasterizer's picture with the light differs from its picture without.
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
/** The light's frames: the scene held and where the eye stands south of the axis and over the ground, looking down at the foot. */
const LIT: readonly (readonly [which: number, metres: number, up: number])[] = [[2, 200, 60], [4, 150, 25], [0, 320, 90]];
const LIGHT_KEY = "orb-light";
/** Levels of 255 the light must add to a pixel for it to be judged. */
const LIT_LEAST = 6;
const lights: { pixels: Uint8ClampedArray; where: Uint8Array }[] = [];

export const orbCheck: LitCheck = {
  name: "orb scenes",
  shots() {
    mkdirSync(out, { recursive: true });
    const reg = compileContent(CORE_CONTENT).registry!;
    const bytes = buildPack([...grayboxMeshes(CORE_CONTENT), { id: "core:orb/shell", lods: [boxMesh([44, 44, 44], 12)] }], defaultPalette());
    const pack = parsePack(bytes), dims = { chunksX: 32, chunksZ: 32 };
    const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
    const screens = ["medium", "lowpoly"].map((tier) => {
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
    // The light: medium's programs with ORB_LIGHT, the ground at the ball's foot, no halo and no shadow, at night.
    const ground = new Heightfield(dims, TERRAIN_CELL, 0, 1 / 64), plinth = { id: "core:orb/plinth", lods: [boxMesh([80, 3, 80], 5)] };
    const lightBytes = buildPack([...grayboxMeshes(CORE_CONTENT), { id: "core:orb/shell", lods: [boxMesh([78, 78, 78], 12)] }, plinth], defaultPalette()), lightPack = parsePack(lightBytes);
    const medium = tierOf("medium"), view = (light: boolean) => {
      const scene = new Scene({ dims, hf: ground, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts), orbs: [SITE], tideEyes: [BLUE] }, reg, lightPack);
      scene.assets.tier = { ...medium, orb: { ...medium.orb, light } };
      scene.plainSky = true;
      scene.viewHeight = H;
      scene.orbGlow = false;
      scene.hour = 23;
      scene.eyeSeconds = 380;
      return { scene, raster: new Rasterizer(W, H, lightPack, ground) };
    };
    const on = view(true), off = view(false), cam = new Camera(), shot = new Shot(LIGHT_KEY, W, H, ground, lightBytes.slice());
    cam.aspect = W / H;
    for (const [which, metres, up] of LIT) {
      cam.x = SITE.x + 10;
      cam.y = up;
      cam.z = SITE.z - metres;
      cam.pitch = -0.3;
      on.scene.orbOnly = off.scene.orbOnly = which;
      // A frame before the one read, for the card to have the tier's programs and the meshes by then.
      const first = on.scene.build(cam, null);
      on.raster.render(first);
      shot.add(first, false);
      const p = on.scene.build(cam, null), q = off.scene.build(cam, null);
      on.raster.render(p);
      off.raster.render(q);
      const where = new Uint8Array(W * H), lit = on.raster.color, dark = off.raster.color;
      for (let i = 0; i < where.length; i++) {
        const screen = on.raster.pickDraw[i]! >= 0 && (p.drawFlags[on.raster.pickDraw[i]!]! & DRAW_ORB) !== 0;
        if (!screen && Math.max(lit[i * 4]! - dark[i * 4]!, lit[i * 4 + 1]! - dark[i * 4 + 1]!, lit[i * 4 + 2]! - dark[i * 4 + 2]!) >= LIT_LEAST) where[i] = 1;
      }
      shot.add(p, true);
      lights.push({ pixels: lit.slice(), where });
      writeFileSync(resolve(out, `${LIGHT_KEY}-${ORB_SCENES[which]}-${metres}-software.png`), encodePng(W, H, lit));
    }
    return [...screens, shot];
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
    lights.forEach(({ pixels, where }, frame) => {
      const [which, metres] = LIT[frame]!, name = `the light of ${ORB_SCENES[which]} on the ground from ${metres} m`, gpu = back.pixels(LIGHT_KEY, 2 * frame + 1);
      if (!gpu) {
        ok = false;
        lines.push(`${LIGHT_KEY} ${name}: no native readback`);
        return;
      }
      writeFileSync(resolve(out, `${LIGHT_KEY}-${ORB_SCENES[which]}-${metres}-gpu.png`), encodePng(W, H, gpu));
      const error: number[] = [];
      // A pixel in from where the light's edge and a mesh's edge are, as the screen's are judged.
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        const i = y * W + x;
        if (!where[i] || !where[i - 1] || !where[i + 1] || !where[i - W] || !where[i + W]) continue;
        error.push(Math.max(...[0, 1, 2].map((c) => Math.abs(pixels[i * 4 + c]! - gpu[i * 4 + c]!))));
      }
      const s = spread(error), pass = s.points >= 500 && s.mean <= 2.5 && s.p95 <= 10;
      ok &&= pass;
      lines.push(`${LIGHT_KEY} ${name}: ${s.points} pixels the light adds ${LIT_LEAST} levels or more to, mean ${s.mean.toFixed(2)}/255, p95 ${s.p95}/255, worst ${s.worst}/255; ${pass ? "ok" : "FAIL"}`);
    });
    return { ok, lines };
  },
};
