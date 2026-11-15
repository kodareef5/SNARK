// Boot self-check decisions, testable against the software rasterizer. The shell only reads pixels back from WebGL.
// A probe that fails in the browser but passes here points at the shell: a shader, a buffer layout, a missing upload.

import { B_CHEST, HUMAN } from "../../shared/anim/human.ts";
import { LOOK_SKIN, defaultLook } from "../../shared/anim/look.ts";
import { SKIN_BASE } from "../../shared/pack/palette.ts";
import type { Registry } from "../../shared/content/registry.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { PROBE_BODY, PROBE_CREATURE } from "../../shared/world/proving.ts";
import type { Camera } from "./render/camera.ts";
import type { FramePacket } from "./render/packet.ts";
import { domeLight, theSky, trueSun } from "./render/sky.ts";
import { lit, shown, skyFrom, srgbToLinear } from "./render/surface.ts";

export interface Probe {
  name: string;
  /** Screen position, 0..1, origin top-left. */
  sx: number;
  sy: number;
  /** Expected colour, 0..255: as the frame lights it, or before lighting on low poly. */
  rgb: [number, number, number];
  /** "exact" matches within a few levels. "hue" matches the colour direction at any brightness. */
  mode: "exact" | "hue";
}

/**
 * Probes for the proving ground seen from its spawn point looking north, in frame `p`. The slope probe lands where
 * expected only if terrain heights reach the GPU correctly. `withCreature` adds the creature and the body the probe
 * server places. On a lit frame each colour is the one surface.ts lights it to, facing as the probe's point does (a
 * body's facing the camera), the checker aside, and the sky is the dome, as the sky table gives it.
 */
export function provingProbes(cam: Camera, reg: Registry, palette: Uint8Array, skyIndex: number, hf: Heightfield, withCreature: boolean, p: FramePacket): Probe[] {
  const ray = [0, 0, 0];
  const out = [0, 0, 0];
  const rgb = [0, 0, 0];
  const at = [0, 0, 0];
  /** A palette colour at screen point `at` on a face with normal `n`, or facing the camera. */
  const color = (index: number, n?: readonly number[]): [number, number, number] => {
    const raw: [number, number, number] = [palette[index * 4]!, palette[index * 4 + 1]!, palette[index * 4 + 2]!];
    if (!p.lit) return raw;
    cam.ray(at[0]!, at[1]!, ray);
    const v = ray.map((c) => -c);
    lit(out, raw.map((c) => srgbToLinear(c / 255)), [1, 1, 0], n ?? v, v, p.frame, [0, 0, 0]);
    shown(rgb, out, at[2]!, p);
    return rgb.map((c) => Math.round(c * 255)) as [number, number, number];
  };
  const sky = (): [number, number, number] => {
    if (!p.lit) return color(skyIndex);
    cam.ray(at[0]!, at[1]!, ray);
    const sun = [0, 0, 0];
    trueSun(p.frame, sun);
    skyFrom(out, p.frame, ray, (view, light) => domeLight(theSky().table, sun, view, light));
    shown(rgb, out, 0, p);
    return rgb.map((c) => Math.round(c * 255)) as [number, number, number];
  };
  // The plaza is level, and far nearer than the fog.
  [at[0], at[1], at[2]] = [0.5, 0.03, 0];
  const probes: Probe[] = [{ name: "sky", sx: 0.5, sy: 0.03, rgb: sky(), mode: "exact" }];
  [at[0], at[1]] = [0.5, 0.97];
  probes.push({ name: "plaza", sx: 0.5, sy: 0.97, rgb: color(1, [0, 1, 0]), mode: "hue" });
  const block = reg.defs[reg.index.get("core:block") ?? 0];
  // South face of the block at (253, 1, 262).
  if (block && block.type === "structure" && cam.project(253, 1, 260.99, at)) {
    probes.push({ name: "block", sx: at[0]!, sy: at[1]!, rgb: color(block.color, [0, 0, -1]), mode: "hue" });
  }
  if (cam.project(232, hf.heightAt(232, 296), 296, at)) {
    // The slope is one plane there: its normal from the heights a sample either side.
    const [dx, dz] = [hf.heightAt(232 + hf.cell, 296) - hf.heightAt(232 - hf.cell, 296), hf.heightAt(232, 296 + hf.cell) - hf.heightAt(232, 296 - hf.cell)];
    const n = [-dx, 2 * hf.cell, -dz].map((c, _, all) => c / Math.hypot(...all));
    probes.push({ name: "slope", sx: at[0]!, sy: at[1]!, rgb: color(hf.tint[Math.round(296 / hf.cell) * hf.nx + Math.round(232 / hf.cell)]!, n), mode: "hue" });
  }
  // The probe server stands a grazer at a known spot in a colour not its species' own, which checks the entity path and the colour regions.
  const grazer = reg.defs[reg.index.get("core:grazer") ?? 0];
  if (withCreature && grazer && grazer.type === "species" && cam.project(PROBE_CREATURE.x, hf.heightAt(PROBE_CREATURE.x, PROBE_CREATURE.z) + grazer.height / 2, PROBE_CREATURE.z, at)) {
    probes.push({ name: "creature", sx: at[0]!, sy: at[1]!, rgb: color(PROBE_CREATURE.color), mode: "hue" });
  }
  // The chest of the survivor body is where expected only if bones reach the GPU, and skin-coloured only if its look's
  // colour regions do. The chest is on the body's axis, so its facing does not matter.
  const survivor = reg.defs[reg.index.get("core:survivor") ?? 0];
  const chest = HUMAN.rest[B_CHEST * 3 + 1]! + HUMAN.capA[B_CHEST * 3 + 1]!;
  if (withCreature && survivor && survivor.type === "species" && cam.project(PROBE_BODY.x, hf.heightAt(PROBE_BODY.x, PROBE_BODY.z) + chest, PROBE_BODY.z, at)) {
    probes.push({ name: "body", sx: at[0]!, sy: at[1]!, rgb: color(SKIN_BASE + defaultLook()[LOOK_SKIN]!), mode: "hue" });
  }
  return probes;
}

export function probePasses(p: Probe, r: number, g: number, b: number): boolean {
  if (p.mode === "exact") return Math.abs(r - p.rgb[0]) <= 4 && Math.abs(g - p.rgb[1]) <= 4 && Math.abs(b - p.rgb[2]) <= 4;
  const got = Math.hypot(r, g, b);
  const want = Math.hypot(p.rgb[0], p.rgb[1], p.rgb[2]);
  if (got < 40) return false; // Black means nothing was drawn or lighting is broken.
  // Lighting and the checker scale brightness, so only the direction of the colour must hold.
  const dot = (r * p.rgb[0] + g * p.rgb[1] + b * p.rgb[2]) / (got * want);
  return dot > 0.995;
}
