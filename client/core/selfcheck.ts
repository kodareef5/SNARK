// Boot self-check: what the page verifies about itself in a real browser.
//
// The decisions are made here so they can be tested against the software
// rasterizer. The shell only reads pixels back from WebGL and passes them in.
// A probe that fails in the browser but passes here points at the shell: a
// shader, a buffer layout, a missing upload.

import type { Registry } from "../../shared/content/registry.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { PROBE_CREATURE } from "../../shared/world/proving.ts";
import type { Camera } from "./render/camera.ts";

export interface Probe {
  name: string;
  /** Screen position, 0..1, origin top-left. */
  sx: number;
  sy: number;
  /** Expected colour before lighting, 0..255. */
  rgb: [number, number, number];
  /** "exact": matches within a few levels. "hue": same colour direction at any brightness. */
  mode: "exact" | "hue";
}

/**
 * Probes for the proving ground seen from its spawn point looking north: sky
 * at the top, plaza at the bottom, the face of a known block, and a point on
 * the 50 degree slope, which is only where expected if terrain heights reach
 * the GPU correctly. With `withCreature`, also the creature the probe server
 * places.
 */
export function provingProbes(cam: Camera, reg: Registry, palette: Uint8Array, skyIndex: number, hf: Heightfield, withCreature: boolean): Probe[] {
  const color = (index: number): [number, number, number] => [palette[index * 4]!, palette[index * 4 + 1]!, palette[index * 4 + 2]!];
  const probes: Probe[] = [
    { name: "sky", sx: 0.5, sy: 0.03, rgb: color(skyIndex), mode: "exact" },
    { name: "plaza", sx: 0.5, sy: 0.97, rgb: color(1), mode: "hue" },
  ];
  const block = reg.defs[reg.index.get("core:block") ?? 0];
  const at = [0, 0, 0];
  // South face of the block at (253, 1, 262).
  if (block && block.type === "structure" && cam.project(253, 1, 260.99, at)) {
    probes.push({ name: "block", sx: at[0]!, sy: at[1]!, rgb: color(block.color), mode: "hue" });
  }
  if (cam.project(232, hf.heightAt(232, 296), 296, at)) {
    probes.push({ name: "slope", sx: at[0]!, sy: at[1]!, rgb: color(hf.tint[Math.round(296 / hf.cell) * hf.nx + Math.round(232 / hf.cell)]!), mode: "hue" });
  }
  // The probe server stands one grazer at a known spot: checks the per-frame entity path and its colour region.
  const grazer = reg.defs[reg.index.get("core:grazer") ?? 0];
  if (withCreature && grazer && grazer.type === "species" && cam.project(PROBE_CREATURE.x, hf.heightAt(PROBE_CREATURE.x, PROBE_CREATURE.z) + grazer.height / 2, PROBE_CREATURE.z, at)) {
    probes.push({ name: "creature", sx: at[0]!, sy: at[1]!, rgb: color(grazer.color), mode: "hue" });
  }
  return probes;
}

export function probePasses(p: Probe, r: number, g: number, b: number): boolean {
  if (p.mode === "exact") return Math.abs(r - p.rgb[0]) <= 4 && Math.abs(g - p.rgb[1]) <= 4 && Math.abs(b - p.rgb[2]) <= 4;
  const got = Math.hypot(r, g, b);
  const want = Math.hypot(p.rgb[0], p.rgb[1], p.rgb[2]);
  if (got < 40) return false; // black: nothing was drawn or lighting is broken
  // Lighting and the checker scale brightness; the direction of the colour must hold.
  const dot = (r * p.rgb[0] + g * p.rgb[1] + b * p.rgb[2]) / (got * want);
  return dot > 0.995;
}
