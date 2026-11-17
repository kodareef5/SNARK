// Boot self-check decisions, testable against the software rasterizer. The shell only reads pixels back from WebGL.
// A probe that fails in the browser but passes here points at the shell: a shader, a buffer layout, a missing upload.

import { surfaceIndex } from "../../content/surfaces.ts";
import { worldSharp, worldSurface, type WorldSample } from "./render/world-surfaces.ts";
import { B_CHEST, HUMAN } from "../../shared/anim/human.ts";
import { LOOK_SKIN, defaultLook } from "../../shared/anim/look.ts";
import { SKIN_BASE } from "../../shared/pack/palette.ts";
import type { Registry } from "../../shared/content/registry.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { PROBE_BODY, PROBE_CREATURE } from "../../shared/world/proving.ts";
import type { Camera } from "./render/camera.ts";
import type { FramePacket } from "./render/packet.ts";
import { domeLight, theSky, trueSun } from "./render/sky.ts";
import { lit, shown, skyFrom, skyLight, srgbToLinear } from "./render/surface.ts";

export interface Probe {
  name: string;
  /** Screen position, 0..1, origin top-left. */
  sx: number;
  sy: number;
  /** Expected colour, 0..255: as the frame lights it, or before lighting on low poly. */
  rgb: [number, number, number];
  /**
   * "exact" matches within a few levels. "hue" matches the colour direction at any brightness, and "lit" at a
   * brightness within LIT_BRIGHTNESS times either way.
   */
  mode: "exact" | "hue" | "lit";
  /**
   * For a lit point whose facing is not known, the twins of FACINGS normals turned toward the camera: the colour is held
   * to the one nearest it in direction. Lit from the side the sun is on, a facet is warmer than one facing the camera.
   */
  facings?: [number, number, number][];
}

/** The reference atlas and the drawing-buffer size, for the exact pixel read by WebGL. */
export interface ProbeSurfaces {
  width: number;
  height: number;
  sample: WorldSample | null;
}

/** Normals spread over the half of the sphere that faces the camera, for a probe's `facings`. */
const FACINGS = 64;

/**
 * Probes for the proving ground seen from its spawn point looking north, in frame `p`. The slope probe lands where
 * expected only if terrain heights reach the GPU correctly. `withCreature` adds the creature and the body the probe
 * server places. Lit ground and statics use world-surfaces.ts at the readback pixel's intersection with their
 * plane, including the projected pixel footprint, and are left out on a lit frame without the reference atlas. Species
 * keep palette lighting. The sky is the same dome table.
 */
export function provingProbes(cam: Camera, reg: Registry, palette: Uint8Array, skyIndex: number, hf: Heightfield, withCreature: boolean, p: FramePacket, surfaces: ProbeSurfaces): Probe[] {
  const ray = [0, 0, 0];
  const out = [0, 0, 0];
  const rgb = [0, 0, 0];
  const at = [0, 0, 0];
  // gl.readPixel floors bottom-up coordinates. In particular, a probe exactly on a row boundary reads the row
  // ABOVE floor(sy * height). Sample its centre, not the projected landmark or the pixel's corner.
  const screen = (): [number, number] => [(Math.floor(at[0]! * surfaces.width) + 0.5) / surfaces.width, 1 - (Math.floor((1 - at[1]!) * surfaces.height) + 0.5) / surfaces.height];
  const finished = !p.lit || surfaces.sample !== null;
  const sun = [0, 0, 0];
  trueSun(p.frame, sun);
  const look = (view: ArrayLike<number>, light: Float64Array | Float32Array | number[]): void => domeLight(theSky().table, sun, view, light);
  /** Palette lighting, or a world finish on a known plane. The two species intentionally have no plane finish. */
  const color = (index: number, n?: readonly number[], plane?: { point: readonly number[]; ground: boolean }): [number, number, number] => {
    const raw: [number, number, number] = [palette[index * 4]!, palette[index * 4 + 1]!, palette[index * 4 + 2]!];
    if (!p.lit) return raw;
    const [sx, sy] = screen();
    cam.ray(sx, sy, ray);
    const v = ray.map((c) => -c);
    const albedo = Float64Array.from(raw, (c) => srgbToLinear(c / 255));
    const normal = Float64Array.from(n ?? v), orm = Float64Array.of(1, 1, 0), mirrored = new Float64Array(3);
    let distance = at[2]!;
    if (plane && surfaces.sample && n) {
      const eye = [cam.x, cam.y, cam.z];
      const numerator = n.reduce((sum, c, k) => sum + c * (plane.point[k]! - eye[k]!), 0);
      const hit = (x: number, y: number): number[] => {
        const r = [0, 0, 0]; cam.ray(x, y, r);
        const t = numerator / n.reduce((sum, c, k) => sum + c * r[k]!, 0);
        return r.map((c, k) => eye[k]! + c * t);
      };
      const point = hit(sx, sy), right = hit(sx + 1 / surfaces.width, sy), down = hit(sx, sy + 1 / surfaces.height);
      const axis = Math.abs(n[1]!) >= Math.max(Math.abs(n[0]!), Math.abs(n[2]!)) ? 1 : Math.abs(n[0]!) > Math.abs(n[2]!) ? 0 : 2;
      const u = axis === 0 ? 2 : 0, w = axis === 1 ? 2 : 1;
      const footprint = Math.max(...[right, down].map((next) => Math.hypot(next[u]! - point[u]!, next[w]! - point[w]!)));
      distance = Math.hypot(...point.map((c, k) => c - eye[k]!));
      const finish = surfaceIndex(index, plane.ground, p.surfaceCity[7] ? "las-vegas" : "default");
      worldSurface(albedo, orm, normal, albedo, finish, point[0]!, point[1]!, point[2]!, n[0]!, n[1]!, n[2]!, footprint, p.surfaceCity, surfaces.sample, p.tier.finish === "light");
      const twice = 2 * normal.reduce((sum, c, k) => sum + c * v[k]!, 0);
      const reflected = normal.map((c, k) => twice * c - v[k]!);
      if (worldSharp(finish, p.surfaceCity)) skyFrom(mirrored, p.frame, reflected, look);
      else skyLight(mirrored, p.frame, reflected);
    }
    lit(out, albedo, orm, normal, v, p.frame, mirrored);
    shown(rgb, out, distance, p);
    return rgb.map((c) => Math.round(c * 255)) as [number, number, number];
  };
  /** The same colour on FACINGS faces turned toward the camera, spread evenly (a Fibonacci spiral round the view). */
  const facings = (index: number): [number, number, number][] | undefined => {
    if (!p.lit) return undefined;
    cam.ray(...screen(), ray);
    const v = ray.map((c) => -c);
    const [a, b] = [Math.abs(v[1]!) < 0.9 ? [0, 1, 0] : [1, 0, 0], [0, 0, 0]];
    const u = [a[1]! * v[2]! - a[2]! * v[1]!, a[2]! * v[0]! - a[0]! * v[2]!, a[0]! * v[1]! - a[1]! * v[0]!].map((c, _, all) => c / Math.hypot(...all));
    [b[0], b[1], b[2]] = [v[1]! * u[2]! - v[2]! * u[1]!, v[2]! * u[0]! - v[0]! * u[2]!, v[0]! * u[1]! - v[1]! * u[0]!];
    return Array.from({ length: FACINGS }, (_, i) => {
      const z = 1 - (i + 0.5) / FACINGS;
      const [r, t] = [Math.sqrt(1 - z * z), i * Math.PI * (3 - Math.sqrt(5))];
      return color(index, [0, 1, 2].map((k) => v[k]! * z + (u[k]! * Math.cos(t) + b[k]! * Math.sin(t)) * r));
    });
  };
  const sky = (): [number, number, number] => {
    if (!p.lit) return color(skyIndex);
    cam.ray(...screen(), ray);
    skyFrom(out, p.frame, ray, look);
    shown(rgb, out, 0, p);
    return rgb.map((c) => Math.round(c * 255)) as [number, number, number];
  };
  [at[0], at[1], at[2]] = [0.5, 0.03, 0];
  const probes: Probe[] = [{ name: "sky", sx: 0.5, sy: 0.03, rgb: sky(), mode: "exact" }];
  // Lit twins also hold brightness, allowing for compression and a body's unknown facing.
  const hue: Probe["mode"] = p.lit ? "lit" : "hue";
  // The plaza is level, and far nearer than the fog.
  [at[0], at[1]] = [0.5, 0.97];
  if (finished) probes.push({ name: "plaza", sx: 0.5, sy: 0.97, rgb: color(1, [0, 1, 0], { point: [256, hf.heightAt(256, 240), 240], ground: true }), mode: hue });
  const block = reg.defs[reg.index.get("core:block") ?? 0];
  // South face of the block at (253, 1, 262).
  if (finished && block && block.type === "structure" && cam.project(253, 1, 260.99, at)) {
    probes.push({ name: "block", sx: at[0]!, sy: at[1]!, rgb: color(block.color, [0, 0, -1], { point: [253, 1, 261], ground: false }), mode: hue });
  }
  if (finished && cam.project(232, hf.heightAt(232, 296), 296, at)) {
    // The slope is one plane there: its normal from the heights a sample either side.
    const [dx, dz] = [hf.heightAt(232 + hf.cell, 296) - hf.heightAt(232 - hf.cell, 296), hf.heightAt(232, 296 + hf.cell) - hf.heightAt(232, 296 - hf.cell)];
    const n = [-dx, 2 * hf.cell, -dz].map((c, _, all) => c / Math.hypot(...all));
    probes.push({ name: "slope", sx: at[0]!, sy: at[1]!, rgb: color(hf.tint[Math.round(296 / hf.cell) * hf.nx + Math.round(232 / hf.cell)]!, n, { point: [232, hf.heightAt(232, 296), 296], ground: true }), mode: hue });
  }
  // The probe server stands a grazer at a known spot in a colour not its species' own, which checks the entity path and the colour regions.
  const grazer = reg.defs[reg.index.get("core:grazer") ?? 0];
  if (withCreature && grazer && grazer.type === "species" && cam.project(PROBE_CREATURE.x, hf.heightAt(PROBE_CREATURE.x, PROBE_CREATURE.z) + grazer.height / 2, PROBE_CREATURE.z, at)) {
    // Its facing at the point is the pose's, which the twins do not know, so the colour may be lit from any facing.
    probes.push({ name: "creature", sx: at[0]!, sy: at[1]!, rgb: color(PROBE_CREATURE.color), mode: hue, facings: facings(PROBE_CREATURE.color) });
  }
  // The chest of the survivor body is where expected only if bones reach the GPU, and skin-coloured only if its look's
  // colour regions do. The chest is on the body's axis, so its facing does not matter.
  const survivor = reg.defs[reg.index.get("core:survivor") ?? 0];
  const chest = HUMAN.rest[B_CHEST * 3 + 1]! + HUMAN.capA[B_CHEST * 3 + 1]!;
  if (withCreature && survivor && survivor.type === "species" && cam.project(PROBE_BODY.x, hf.heightAt(PROBE_BODY.x, PROBE_BODY.z) + chest, PROBE_BODY.z, at)) {
    probes.push({ name: "body", sx: at[0]!, sy: at[1]!, rgb: color(SKIN_BASE + defaultLook()[LOOK_SKIN]!), mode: hue });
  }
  return probes;
}

/** The twin a colour read is held to: the probe's, or of its facings the one nearest the colour in direction. */
export function heldTo(p: Probe, r: number, g: number, b: number): [number, number, number] {
  const toward = (rgb: readonly number[]): number => (r * rgb[0]! + g * rgb[1]! + b * rgb[2]!) / Math.max(Math.hypot(rgb[0]!, rgb[1]!, rgb[2]!), 1e-9);
  return (p.facings ?? []).reduce((best, rgb) => (toward(rgb) > toward(best) ? rgb : best), p.rgb);
}

export function probePasses(p: Probe, r: number, g: number, b: number): boolean {
  if (p.facings) return probePasses({ ...p, rgb: heldTo(p, r, g, b), facings: undefined }, r, g, b);
  if (p.mode === "exact") return Math.abs(r - p.rgb[0]) <= 4 && Math.abs(g - p.rgb[1]) <= 4 && Math.abs(b - p.rgb[2]) <= 4;
  const got = Math.hypot(r, g, b);
  const want = Math.hypot(p.rgb[0], p.rgb[1], p.rgb[2]);
  if (got < 40) return false; // Black means nothing was drawn or lighting is broken.
  if (p.mode === "lit" && (got > want * LIT_BRIGHTNESS || got * LIT_BRIGHTNESS < want)) return false;
  // Lighting and the checker scale brightness, so only the direction of the colour must hold.
  const dot = (r * p.rgb[0] + g * p.rgb[1] + b * p.rgb[2]) / (got * want);
  return dot > 0.995;
}

/**
 * How far a "lit" probe may be from the twins' brightness: the checker darkens to 0.82 of it, and a body's chest
 * faces the camera only roughly. A skin in the noon sky's bluish shade is near grey, and this tells it from the
 * ground behind it, which is lit by the sun.
 */
const LIT_BRIGHTNESS = 1.5;
