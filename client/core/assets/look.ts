// What the crosshair is on, for the debug bar's Assets tab: the crosshair's own ray, as the app casts it to name who is
// looked at (prompts.ts), against the ground, structures, nodes (trees, rocks) and bodies, and from what it meets the
// model, the level the scene wants of it and the level drawn, and the material under the crosshair where a coarse level
// the page holds can tell it. Asked for a few times a second while the tab shows, never in a frame of its own. It reads
// the app's, the scene's and the residency's private fields by name.

import type { App } from "../app.ts";
import { castWorld, rayHit } from "../../../shared/world/ray.ts";
import { STEP0_SIZE } from "./copied.ts";
import type { Residency } from "./residency.ts";

/** shared/world/ray.ts's kinds of hit. */
export const HIT_NONE = 0, HIT_TERRAIN = 1, HIT_STRUCTURE = 2, HIT_NODE = 3;
/** shared/world/nodes.ts: a node's size, in these a metre. */
export const SIZE_UNITS = 64;
/** render/scene.ts: a kind or form drawn as nothing. */
export const HIDDEN = 0xffff;
/** shared/anim/pose.ts: a body held in someone's arms, which the crosshair passes. */
export const CUE_HELD = 1 << 22;
/** How far the card looks, in metres. */
export const LOOK_RANGE = 400;

export type LookWhat = "none" | "ground" | "structure" | "node" | "body";

export interface LookPick {
  what: LookWhat;
  /** Metres from the eye to what was met; the range for none. */
  distance: number;
  /** The ray went under the water's surface on its way: it sees through water to what is under it. */
  water: boolean;
  /** Its content id, or the mesh's where it has none of its own. */
  id: string;
  /** Its mesh in the manifest, -1 for none (the ground, or a kind drawn as nothing). */
  mesh: number;
  /** The level the scene wants of the mesh, and the level it draws, -1 where it draws none. */
  wanted: number;
  shown: number;
  /** The material under the crosshair, found on a coarse level the page holds, or -1 where that cannot tell it. */
  material: number;
  /** A body's id, or -1. */
  body: number;
}

/** An id in words, its last part: "core:compact_wreck/tread" is "Tread", "core:oak_1" is "Oak 1". */
export function plainName(id: string): string {
  const tail = id.slice(id.lastIndexOf(":") + 1);
  const words = tail.slice(tail.lastIndexOf("/") + 1).replace(/[_-]+/g, " ").trim();
  return words === "" ? id : words[0]!.toUpperCase() + words.slice(1);
}

/** A mesh's id in words, its whole path: "core:human_f/armor/hide/feet" is "Human f armor hide feet". */
export function meshName(id: string): string {
  const words = id.slice(id.lastIndexOf(":") + 1).replace(/[_/-]+/g, " ").trim();
  return words === "" ? id : words[0]!.toUpperCase() + words.slice(1);
}

export function emptyPick(): LookPick {
  return { what: "none", distance: LOOK_RANGE, water: false, id: "", mesh: -1, wanted: -1, shown: -1, material: -1, body: -1 };
}

/**
 * The nearest triangle of `indices` over `positions` that the ray from (ox, oy, oz) along (dx, dy, dz) meets, from
 * either side: the index of its first corner (a multiple of 3), or -1. `hit[0]` takes how far along the ray it is.
 */
export function nearestTriangle(positions: ArrayLike<number>, indices: ArrayLike<number>, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, hit: Float64Array): number {
  let best = -1, bestT = Infinity;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i]! * 3, b = indices[i + 1]! * 3, c = indices[i + 2]! * 3;
    const ax = positions[a]!, ay = positions[a + 1]!, az = positions[a + 2]!;
    const e1x = positions[b]! - ax, e1y = positions[b + 1]! - ay, e1z = positions[b + 2]! - az;
    const e2x = positions[c]! - ax, e2y = positions[c + 1]! - ay, e2z = positions[c + 2]! - az;
    // Möller and Trumbore: where the ray crosses the triangle's plane, in the triangle's own coordinates.
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-12 && det < 1e-12) continue;
    const inv = 1 / det;
    const sx = ox - ax, sy = oy - ay, sz = oz - az;
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > 1e-6 && t < bestT) {
      bestT = t;
      best = i;
    }
  }
  hit[0] = bestT;
  return best;
}

/** The material of the section that index `at` of a level lies in: a level's sections are a material, its first index and how many, each. -1 for none. */
export function sectionAt(sections: readonly number[], at: number): number {
  for (let k = 0; k + 2 < sections.length; k += 3) if (at >= sections[k + 1]! && at < sections[k + 1]! + sections[k + 2]!) return sections[k]!;
  return -1;
}

/** The coarse levels the page holds, read once each, by mesh and level. */
const held = new Map<number, { positions: Float32Array; indices: Uint32Array } | null>();
const along = new Float64Array(1);

/**
 * The material under the ray, given in the mesh's own frame, on the finest level of `mesh` with sections whose
 * triangles the page holds (the boot pack's or a page's): -1 where none holds them or the ray meets none of its triangles.
 */
function materialUnder(r: Residency, sections: readonly (readonly number[])[], mesh: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  const first = r["first"][mesh]!;
  for (let l = 0; l < sections.length; l++) {
    if (sections[l]!.length === 0 || r["inBoot"][first + l] !== 1) continue;
    const key = mesh * 16 + l;
    if (!held.has(key)) held.set(key, r.heldGeometry(mesh, l));
    const g = held.get(key);
    if (!g) continue;
    const at = nearestTriangle(g.positions, g.indices, ox, oy, oz, dx, dy, dz, along);
    return at < 0 ? -1 : sectionAt(sections[l] as number[], at);
  }
  return -1;
}

/** The finest level of `mesh` the last frame wanted, -1 for none. */
function finestWanted(r: Residency, mesh: number): number {
  const first = r["first"][mesh]!, count = r["first"][mesh + 1]! - first;
  for (let l = 0; l < count; l++) if (r["seen"][first + l] === r["frame"]) return l;
  return -1;
}

function firstMesh(slots: Int32Array | undefined): number {
  if (!slots) return -1;
  for (let i = 0; i < slots.length; i++) if (slots[i]! >= 0) return slots[i]!;
  return -1;
}

/** Fills `out` with what the crosshair is on, by the ray the app cast this frame (prompts.ts): from the eye, along its aim. */
export function pickLook(app: App, out: LookPick): LookPick {
  out.what = "none";
  out.distance = LOOK_RANGE;
  out.water = false;
  out.id = "";
  out.mesh = out.wanted = out.shown = out.material = out.body = -1;
  const s = app.session, world = s.world, scene = app.scene, eye = app["eye"];
  // A body that is not alive has no eye, and the app casts no ray.
  if (!world || !scene || eye < 0) return out;
  const d = app["aim"], ox = s.own.x, oy = s.own.y + eye, oz = s.own.z;
  const kind = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, LOOK_RANGE);
  let best = kind === HIT_NONE ? LOOK_RANGE : rayHit.t;
  const ref = rayHit.ref;
  const r = app.remote;
  let body = -1;
  for (let i = 0; i < r.count; i++) {
    if ((r.cue[i]! & CUE_HELD) !== 0) continue;
    const t = app["lookHit"](i, ox, oy, oz);
    if (t < best) {
      best = t;
      body = i;
    }
  }
  if (kind === HIT_NONE && body < 0) return out;
  out.distance = best;
  const hf = world.hf, hx = ox + d[0]! * best, hy = oy + d[1]! * best, hz = oz + d[2]! * best;
  out.water = oy > hf.waterAt(ox, oz) && hf.waterAt(hx, hz) > hy + 0.05;
  const reg = s.registry, assets = scene.assets, residency = assets.residency;
  if (body >= 0) {
    const k = r.kind[body]!, chars = scene.characters;
    out.what = "body";
    out.body = r.id[body]!;
    out.id = reg.defs[k]?.id ?? "";
    const creature = chars["creatures"][k], human = chars["kinds"][k];
    out.mesh = creature ? creature.mesh : human ? firstMesh(human.sets[0]?.slots) : -1;
    out.wanted = out.mesh < 0 ? -1 : (chars["last"].get(out.body) ?? -1);
  } else if (kind === HIT_TERRAIN) {
    out.what = "ground";
    return out;
  } else {
    const store = kind === HIT_STRUCTURE ? world.structs : world.nodes!;
    const chunk = store.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff, k = chunk.kind[slot]!;
    const forms = s.nodeField?.forms;
    out.what = kind === HIT_STRUCTURE ? "structure" : "node";
    out.mesh = kind === HIT_STRUCTURE ? scene.meshOfKind[k]! : scene["meshOfForm"][k]!;
    if (out.mesh === HIDDEN) out.mesh = -1;
    out.id = reg.defs[kind === HIT_STRUCTURE ? k : (forms?.kind[k] ?? 0)]?.id ?? "";
    if (out.mesh >= 0) {
      out.wanted = finestWanted(residency, out.mesh);
      if (out.wanted < 0) out.wanted = assets.choose(assets.table.error[out.mesh]!, best, -1);
      // The ray in the piece's own frame, as the programs place it (render/glsl.ts): turned by its yaw, a node scaled by its size.
      const turn = (chunk.yaw[slot]! / 65535) * Math.PI * 2, c = Math.cos(turn), sn = Math.sin(turn);
      const size = kind === HIT_NODE && forms ? forms.size[k]! / SIZE_UNITS : 1;
      const px = ox - chunk.x[slot]!, py = oy - chunk.y[slot]!, pz = oz - chunk.z[slot]!;
      out.material = materialUnder(residency, assets.table.sections[out.mesh]!, out.mesh, (c * px - sn * pz) / size, py / size, (sn * px + c * pz) / size, (c * d[0]! - sn * d[2]!) / size, d[1]! / size, (sn * d[0]! + c * d[2]!) / size);
    }
  }
  if (out.id === "" && out.mesh >= 0) out.id = assets.manifest.meshes[out.mesh]!.id;
  if (out.mesh >= 0 && out.wanted >= 0) out.shown = assets.heldLevel(out.mesh, out.wanted);
  return out;
}

const ROLE_NAMES: Readonly<Record<string, string>> = { base: "colour", normal: "normal", mro: "packed map", mask: "mask", mask2: "second mask", layer: "wear layer" };

/**
 * What a residency slot is, in words: "Tall palm, model level 0", "Bark colour 1024 px" (at step `step`, a texture's),
 * "Rows of models, page 12". `pair` is a level asked for with its surface.
 */
export function slotName(r: Residency, slot: number, step: number, pair = false): string {
  const m = r["manifest"], levels = r["levels"];
  if (slot >= r["pageBase"]) return `Rows of models, page ${slot - r["pageBase"]}`;
  if (slot >= r["clipBase"]) return `${plainName(m.clips?.[slot - r["clipBase"]]?.rig ?? "")} clips`;
  if (slot >= r["texBase"]) {
    const t = m.textures?.[slot - r["texBase"]];
    if (!t) return "A texture";
    const parts = t.id.split("/");
    return `${plainName(parts.length > 1 ? parts[parts.length - 2]! : t.id)} ${ROLE_NAMES[t.role] ?? t.role} ${STEP0_SIZE << step} px`;
  }
  const level = slot < levels ? slot : slot - levels;
  const name = meshName(m.meshes[r["meshOf"][level]!]?.id ?? "");
  const l = r["levelOf"][level]!;
  return slot >= levels ? `${name}, level ${l} surface` : `${name}, model level ${l}${pair ? " and surface" : ""}`;
}
