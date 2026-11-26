// A program's uniforms are rows (programs.ts UNIFORMS). A row is a uniform's name in the texts, how it is sent, when,
// and where its value comes from: the frame, a column of the draw, its material, its mesh, a number. A shell finds each
// row's place once, when the program links, and from then on walks the rows it found: it has no line for any of them.
// So a new uniform is a row here and its place in a program's list, and a new column or lane to read is this file's.

import { CELL } from "../../../shared/pack/details.ts";
import type { FinishTable } from "../../../shared/pack/finish.ts";
import type { ManifestMesh } from "../../../shared/pack/manifest.ts";
import type { Pack, PackMaterial } from "../../../shared/pack/pack.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import { ROAD_STEP, roadSamples } from "../../../shared/world/roadframe.ts";
import { DRAW_BLEND, DRAW_CUTOUT, DRAW_HEAT_SHIFT, DRAW_PIECE, DRAW_PLAIN, DRAW_PULLED, DRAW_SIZED, DRAW_TEXTURED, SOURCE_MAP, SOURCE_WINDOW, type FramePacket } from "./packet.ts";
import { PIECE_ROWS } from "./pieces.ts";
import { WATER_ALPHA } from "./shading.ts";
import { LAYER_LEVELS, materialEmission, skinMode } from "./surface.ts";
import type { GroundSize } from "./terrain.ts";

/** How a row is sent: one number as a float, an int or an unsigned int; two to four floats; an array of vec3s or vec4s as it is. */
export const SEND_1F = 0, SEND_1I = 1, SEND_1UI = 2, SEND_2F = 3, SEND_3F = 4, SEND_4F = 5, SEND_3FV = 6, SEND_4FV = 7;
/** The floats a row sent as SEND_2F, _3F or _4F fills. */
export const SEND_FLOATS = [1, 1, 1, 2, 3, 4, 0, 0] as const;

/**
 * When a row is set: once when its program links (`start` alone); the first time its program is drawn with in a frame;
 * for each draw or caster; for each run of terrain tiles.
 */
export const AT_LINK = 0, AT_FRAME = 1, AT_DRAW = 2, AT_TILES = 3;

/**
 * What a row reads. A shell keeps one for a pack and a map, sets what holds for the frame once, and for each draw or
 * caster its fields below `d`. Nothing here is made in a frame.
 */
export class Drawn {
  readonly pack: Pack;
  readonly hf: Heightfield;
  readonly ground: GroundSize;
  readonly materials: readonly PackMaterial[];
  readonly meshes: readonly ManifestMesh[];
  /** Each mesh's row of the palette's finishes (shared/pack/finish.ts). */
  readonly finishRow: FinishTable["row"];
  /** Each rig's wheel centres at rest, as `uWheelCenters` takes them. */
  readonly wheelCenters: readonly Float32Array[];

  p!: FramePacket;
  /** The frame's number, which a row set once a frame is keyed by. */
  serial = 0;
  /** Whether the frame is drawn into a light target (post.ts drawsLight). */
  lightTarget = false;
  /** How much a material that glows only by night glows (surface.ts lampsOn), and the frame's exposure. */
  night = 0;
  exposure = 1;

  /** The draw's row in the packet's draws, or the caster's in its casters. */
  d = 0;
  flags = 0;
  /** Its mesh and material, by their numbers in the manifest, and the material where there is one. */
  mesh = 0;
  m = 0;
  material: PackMaterial | undefined = undefined;
  /** Whether the level the card holds for it has skin entries. */
  skinned = false;

  constructor(pack: Pack, hf: Heightfield, ground: GroundSize, materials: readonly PackMaterial[], meshes: readonly ManifestMesh[], finishRow: FinishTable["row"]) {
    this.pack = pack;
    this.hf = hf;
    this.ground = ground;
    this.materials = materials;
    this.meshes = meshes;
    this.finishRow = finishRow;
    this.wheelCenters = (pack.header.rigs ?? []).map((rig) => Float32Array.from(rig.rest.slice(0, 96)));
  }
}

export interface UniformRow {
  /** Its name in the texts. */
  readonly name: string;
  /** How it is sent (SEND_) and when it is set (AT_). */
  readonly send: number;
  readonly at: number;
  /** The number it holds from when its program links, where it has one. */
  readonly start: number | null;
  /** Its number, for SEND_1F, _1I and _1UI. It is sent when it differs from the last sent. */
  readonly value: ((c: Drawn) => number) | null;
  /** Writes its floats to `out`, for SEND_2F, _3F and _4F. */
  readonly fill: ((c: Drawn, out: Float64Array) => void) | null;
  /** The array sent as it is, for SEND_3FV and _4FV, or null where the draw has nothing to say. */
  readonly array: ((c: Drawn) => Float32Array | readonly number[] | null) | null;
  /**
   * What its floats or its array were last sent for: they are sent again only when this differs. A row of floats
   * without one is sent when a float differs; a row with an array needs one.
   */
  readonly key: ((c: Drawn) => number) | null;
}

type Read = (c: Drawn) => number;
// Every row is made here, with every field, so a shell's walk reads objects of one shape.
const row = (name: string, send: number, at: number, start: number | null, value: UniformRow["value"], fill: UniformRow["fill"], array: UniformRow["array"], key: UniformRow["key"]): UniformRow => ({ name, send, at, start, value, fill, array, key });
/** A row of one number. */
const one = (name: string, at: number, value: Read, send = SEND_1F, start: number | null = null): UniformRow => row(name, send, at, start, value, null, null, null);
/** A row of two to four floats. */
const floats = (name: string, send: number, at: number, fill: NonNullable<UniformRow["fill"]>, key: Read | null): UniformRow => row(name, send, at, null, null, fill, null, key);
/** A row of an array. */
const array = (name: string, send: number, at: number, read: NonNullable<UniformRow["array"]>, key: Read): UniformRow => row(name, send, at, null, null, null, read, key);

const frame: Read = (c) => c.serial;
const WHOLE_UV: readonly number[] = [0, 0, 1, 1];

/**
 * What the frame gives every program that declares it, the first time the program is drawn with in the frame. The fog
 * is of the sky a frame drawn into a light target shows, or of the one it shows without (packet.ts skyShown).
 */
export const FRAME_ROWS: readonly UniformRow[] = [
  array("uSun", SEND_3FV, AT_FRAME, (c) => c.p.sun, frame),
  array("uSky", SEND_3FV, AT_FRAME, (c) => (c.lightTarget ? c.p.sky : c.p.skyShown), frame),
  floats("uFog", SEND_2F, AT_FRAME, (c, out) => {
    out[0] = c.p.fogStart;
    out[1] = c.p.fogEnd;
  }, frame),
  // Checker parity repeats every 16 m, so a small remainder keeps float precision.
  floats("uCamMod", SEND_3F, AT_FRAME, (c, out) => {
    out[0] = c.p.camX % 16;
    out[1] = c.p.camY % 16;
    out[2] = c.p.camZ % 16;
  }, frame),
  one("uLight", AT_FRAME, (c) => c.p.light),
  floats("uWorldEye", SEND_3F, AT_FRAME, (c, out) => {
    out[0] = c.p.camX;
    out[1] = c.p.camY;
    out[2] = c.p.camZ;
  }, frame),
  array("uWorldPhase", SEND_3FV, AT_FRAME, (c) => c.p.worldPhase, frame),
  array("uWorldLeast", SEND_3FV, AT_FRAME, (c) => c.p.worldLeast, frame),
  floats("uField", SEND_4F, AT_FRAME, (c, out) => field(c, out, SOURCE_MAP), frame),
  array("uSurfaceCity", SEND_4FV, AT_FRAME, (c) => c.p.surfaceCity, frame),
  one("uCascades", AT_FRAME, (c) => c.p.cascadeCount, SEND_1I),
];

/** The ground's heights as a program reads them from the pair `source`: the lowest, a step, a cell's width, the camera's height. */
function field(c: Drawn, out: Float64Array, source: number): void {
  out[0] = c.hf.minY;
  out[1] = c.hf.stepY;
  out[2] = c.ground.cell[source]!;
  out[3] = c.p.camY;
}

const heat = one("uHeat", AT_DRAW, (c) => (c.flags >>> DRAW_HEAT_SHIFT) & 3);

/**
 * The nine rows of the pieces' states a near chunk's mesh is drawn with (pieces.ts), by the buffer `of` names, which is
 * its chunk: sent when the chunk or its nine change. Any other draw sends nothing, and its vertices read none.
 */
function pieceRows(of: (c: Drawn) => number): UniformRow {
  return array("uPieceRows", SEND_3FV, AT_DRAW, (c) => {
    const row = c.p.pieceRowOf.get(of(c));
    return row === undefined ? null : c.p.pieceRowsOf[row]!;
  }, (c) => {
    const row = c.p.pieceRowOf.get(of(c));
    return row === undefined ? -1 : row + c.p.pieceStamp[row]! * PIECE_ROWS;
  });
}

/** Whether a draw's instances are built pieces (piece-fit.ts). */
const piece = one("uPiece", AT_DRAW, (c) => ((c.flags & DRAW_PIECE) !== 0 ? 1 : 0));

/**
 * The bases a draw of built pieces stands in (piece-fit.ts FrameTable), by the buffer `of` names: sent when the table
 * changes or the draw is of another buffer's. Any other draw sends nothing.
 */
function frames(of: (c: Drawn) => number): UniformRow {
  return array("uFrames", SEND_4FV, AT_DRAW, (c) => ((c.flags & DRAW_PIECE) !== 0 ? (c.p.frameTables.get(of(c))?.axes ?? null) : null), (c) => ((c.flags & DRAW_PIECE) !== 0 ? (c.p.frameTables.get(of(c))?.stamp ?? -1) : -1));
}

/** What a draw of a mesh gives its program, flat or with a material: its columns of the packet. */
export const MESH_ROWS: readonly UniformRow[] = [
  // A level's skin entries are read only by a draw with a material.
  one("uSkin", AT_DRAW, (c) => skinMode(c.flags, (c.flags & DRAW_TEXTURED) !== 0 && c.skinned)),
  one("uFade", AT_DRAW, (c) => c.p.drawFade[c.d]!),
  one("uHand", AT_DRAW, (c) => c.p.drawHand[c.d]!),
  one("uSwap", AT_DRAW, (c) => c.p.drawSwap[c.d]!),
  floats("uEffect", SEND_4F, AT_DRAW, (c, out) => {
    const fx = c.p.drawEffect, e = c.d * 4;
    out[0] = fx[e]!;
    out[1] = fx[e + 1]!;
    out[2] = fx[e + 2]!;
    out[3] = fx[e + 3]!;
  }, null),
  // A body that shimmers for a moment (packet.ts drawGlow).
  floats("uGlow", SEND_4F, AT_DRAW, (c, out) => {
    const g = c.p.drawGlow, e = c.d * 4;
    out[0] = g[e]!;
    out[1] = g[e + 1]!;
    out[2] = g[e + 2]!;
    out[3] = g[e + 3]!;
  }, null),
  // A piece about to be built is one colour, whatever its mesh's own (packet.ts drawTint).
  one("uOneColor", AT_DRAW, (c) => c.p.drawTint[c.d * 2]!),
  heat,
  pieceRows((c) => c.p.drawBuffer[c.d]!),
  piece,
  frames((c) => c.p.drawBuffer[c.d]!),
];

const cutoff = one("uCutoff", AT_DRAW, (c) => ((c.flags & DRAW_CUTOUT) !== 0 ? c.material!.cutoff : 0));
// What a mesh's stored texture coordinates span, set when the mesh changes.
const uv = array("uUv", SEND_4FV, AT_DRAW, (c) => c.meshes[c.mesh]!.uv ?? WHOLE_UV, (c) => c.mesh);
const rig: Read = (c) => c.meshes[c.mesh]!.rig ?? -1;

/** What a draw with a material gives a SURFACE program after MESH_ROWS: its street finish and wheels, then its material. */
export const MATERIAL_ROWS: readonly UniformRow[] = [
  one("uStreetMaterial", AT_DRAW, (c) => c.p.drawStreetMaterial[c.d]!),
  one("uOptics", AT_DRAW, (c) => c.p.drawOptics[c.d]!),
  // Its rig's wheel centres, set when the rig changes, for a draw with wheels alone.
  array("uWheelCenters", SEND_3FV, AT_DRAW, (c) => (c.p.drawWheelBones[c.d] !== 0 ? c.wheelCenters[rig(c)]! : null), rig),
  one("uWheelBones", AT_DRAW, (c) => c.p.drawWheelBones[c.d]!, SEND_1UI),
  floats("uTint", SEND_3F, AT_DRAW, (c, out) => {
    const tint = c.material!.tint;
    out[0] = tint[0];
    out[1] = tint[1];
    out[2] = tint[2];
  }, (c) => c.m),
  one("uGrey", AT_DRAW, (c) => c.material!.grey),
  cutoff,
  one("uSheet", AT_DRAW, (c) => c.material!.sheet ?? 0),
  one("uEmissive", AT_DRAW, (c) => materialEmission(c.material!, c.night, c.exposure)),
  uv,
];

/** After those, for a body with a layer (packet.ts drawLayer): the level it is drawn at and its wear story. */
export const LAYER_ROWS: readonly UniformRow[] = [
  one("uLevel", AT_DRAW, (c) => c.p.drawLayer[c.d]! / LAYER_LEVELS),
  one("uWear", AT_DRAW, (c) => c.p.drawWear[c.d]!),
];

/**
 * What a flat draw gives its program after MESH_ROWS: its fixture; whether it is drawn plain, by its mesh's finishes,
 * or chequered; and how see-through it is, which only a see-through draw of a mesh without finishes is.
 */
export const FLAT_ROWS: readonly UniformRow[] = [
  one("uFixture", AT_DRAW, (c) => c.p.drawFixture[c.d]!),
  one("uSolid", AT_DRAW, (c) => ((c.flags & DRAW_PLAIN) !== 0 || (c.p.lit && (c.flags & (DRAW_SIZED | DRAW_PULLED)) !== 0) ? 2 + c.finishRow[c.mesh]! : 1)),
  one("uAlpha", AT_DRAW, (c) => ((c.flags & DRAW_BLEND) !== 0 && c.finishRow[c.mesh] === 0 ? WATER_ALPHA : 1) * (1 - c.p.drawTint[c.d * 2 + 1]!), SEND_1F, 1),
];

/** What a caster gives the depth programs: how its vertices are placed, and cut out, what cuts it. */
export const CASTER_ROWS: readonly UniformRow[] = [one("uSkin", AT_DRAW, (c) => skinMode(c.flags, c.skinned)), pieceRows((c) => c.p.casterBuffer[c.d]!), piece, frames((c) => c.p.casterBuffer[c.d]!)];
export const CUTOUT_CASTER_ROWS: readonly UniformRow[] = [...CASTER_ROWS, cutoff, uv];

/** What a draw of small details gives theirs: whether it is see-through, and the cells its atlas has a side. */
export const DETAIL_ROWS: readonly UniformRow[] = [
  one("uBlend", AT_DRAW, (c) => ((c.flags & DRAW_BLEND) !== 0 ? 1 : 0)),
  one("uCells", AT_DRAW, (c) => (c.pack.header.details?.atlas.side ?? CELL) / CELL),
];

/**
 * What a run of terrain tiles gives a program that reads the pair of pictures `source` (packet.ts SOURCE_): that it is
 * the ground, opaque from the first; and once a frame the pair's heights, its last sample each way, and where the
 * window's corner is in the texels of its pictures and of its roads' frame's, which hold a sample at its own place
 * modulo their size (terrain.ts). The whole map's pair is not wrapped.
 */
export function tileRows(source: number): readonly UniformRow[] {
  return [
    row("uAlpha", SEND_1F, AT_LINK, 1, null, null, null, null),
    one("uSolid", AT_TILES, () => 0),
    floats("uField", SEND_4F, AT_TILES, (c, out) => field(c, out, source), frame),
    floats("uLast", SEND_2F, AT_TILES, (c, out) => {
      out[0] = c.ground.width[source]! - 1;
      out[1] = c.ground.height[source]! - 1;
    }, frame),
    floats("uWrap", SEND_2F, AT_TILES, (c, out) => {
      const window = source === SOURCE_WINDOW && c.p.groundWindow[0]! >= 0;
      out[0] = window ? c.p.groundWindow[1]! % c.ground.width[source]! : 0;
      out[1] = window ? c.p.groundWindow[2]! % c.ground.height[source]! : 0;
    }, frame),
    floats("uRoadWrap", SEND_2F, AT_TILES, (c, out) => {
      const window = source === SOURCE_WINDOW && c.p.groundWindow[0]! >= 0;
      out[0] = window ? (c.p.groundWindow[1]! / ROAD_STEP) % roadSamples(c.ground.width[source]!) : 0;
      out[1] = window ? (c.p.groundWindow[2]! / ROAD_STEP) % roadSamples(c.ground.height[source]!) : 0;
    }, frame),
  ];
}

/**
 * The uniforms a shell sets by code, because their values are its own and no packet's: the step's or cascade's
 * view-projection and where its see-through draws start; whether the finishes' maps are on the card, and how far the
 * textures it makes have come up; a finish pass's taps and extent, from the canvas's size; and the bounds and offset of
 * the level it binds.
 */
export const SHELL_UNIFORMS = ["uViewProj", "uFrom", "uWorldReady", "uTexgenReady", "uPass", "uExtent", "uCenter", "uHalf", "uOffset"] as const;
