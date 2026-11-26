// Sun shadows for a frame. `fit` fits the cascades to the view, for the sun or the moon, and `fitLamp` the one street lamp
// that lights; from then on a pass asks which of them a box casts into (`castBox`), and puts what casts in the packet's
// caster list (`cast`). The ground's own casters are the terrain's (terrain.ts), counted here.

import type { Assets } from "../assets/assets.ts";
import type { Camera } from "./camera.ts";
import type { BodyShadows, CastFn, Characters } from "./characters.ts";
import type { Hiding } from "./hide.ts";
import { LAMP_ACROSS, LAMP_BIT, LAMP_RANGE, LampView, lampFrame } from "./lamp.ts";
import type { Pass } from "./pass.ts";
import { CAST_AT, DRAW_CUTOUT, DRAW_ONE_BONE, DRAW_PIECE, DRAW_RANGED, DRAW_SIZED, DRAW_SKINNED, DRAW_TEXTURED, DRAW_TWO_SIDED, LAMP_AT, MAX_CASCADES, MAX_CASTERS, TILE_CASTS, TILE_QUADS, TRANSIENT_BUFFER, type FramePacket } from "./packet.ts";
import { Cascades, MAX_REACH, reach } from "./shadow.ts";
import { shadowLayer } from "./shadowtext.ts";
import type { StreetLamps } from "./street-lamps.ts";
import { moonCasts } from "./surface.ts";
import type { CastTest, TerrainLod } from "./terrain.ts";

/** The one run of a level cast flat: no material, and all its indices. */
const FLAT: readonly number[] = [-1, 0, 0];
/** What of a draw's flags a caster keeps: how its vertices are placed. */
const CAST_FLAGS = DRAW_SKINNED | DRAW_ONE_BONE | DRAW_SIZED | DRAW_PIECE;

/** What casting reads of the pack's meshes and materials, each made once by the scene. */
export interface CastLooks {
  readonly materialFlags: Uint8Array;
  readonly bentFlags: Uint32Array;
  readonly trisOfMesh: readonly (readonly number[])[];
  readonly radiusOfMesh: Float32Array;
  /** Per mesh, a standing tree's levels that cut out its leaves, a bit each; 0 for any other mesh. */
  readonly foliageOf: Uint16Array;
}

export class Casting {
  /** Sun shadows: the cascades fitted this frame, and past them the far map of the city's outline, with the far city, which makes the sky's openness too. */
  readonly cascades = new Cascades();
  /**
   * Whether anything casts this frame, how far the light the cascades are cast from climbs (its unit vector's y, as
   * `sunAt`, which is the sun's by day and the moon's by night), whether that light is the sun, and frames fitted, for a
   * cascade drawn every other frame.
   */
  on = false;
  sunY = 1;
  sunCasts = false;
  fitted = 0;
  /** Whether the moon casts through the cascades by night where the tier's shadows say it may, which a bench turns off every other frame (`?ab=moon`). */
  moonShadows = true;
  /** The lowest a receiver in any cascade's sphere can be. A caster's shadow reaches as far as its top stands over this. */
  floor = 0;
  /** Metres past where a caster's shadow falls that a lookup of it may reach (shadeHidden). */
  shadeSlack = 0;
  /** Metres from the camera past which nothing casts into a cascade: as far as a cascade's cube reaches, and MAX_REACH on. */
  castRange = 0;
  readonly sunAt = new Float64Array(3);
  /** A mesh's level and mask pairs from `Cascades.entries`: one for each cascade and one for the lamp's map, at most. */
  readonly pairs = new Uint8Array((MAX_CASCADES + 1) * 2);
  /** The camera of the frame being built. */
  camera: Camera | null = null;
  /**
   * The cascades something in a camera-relative box casts into: those it can shade, its shadow reaching as far along the
   * light as its top stands over the floor, while that shadow can fall in view.
   */
  readonly castBox: CastTest = (minX, minY, minZ, maxX, maxY, maxZ) => this.castsBy(minX, minY, minZ, maxX, maxY, maxZ, -1);
  /** The same for the ground, which casts into the cascades alone: under the street lamp it is what receives. */
  readonly groundCasts: CastTest = (minX, minY, minZ, maxX, maxY, maxZ) => this.castsBy(minX, minY, minZ, maxX, maxY, maxZ, -1) & ~LAMP_BIT;
  /** The street lamp that lights this frame, seen from its lens (lamp.ts). */
  readonly lamp = new LampView();
  /** The ground's casters, chosen once the far layers are up to date and counted once they have drawn: a row of the frame's list. */
  readonly ground: Pass = {
    update: (f) => {
      if (this.on && !this.terrain.casters(f.cam, this.packet, f.view, this.groundCasts)) this.packet.casterDropped++;
    },
    draw: () => {
      if (this.on) this.groundCast();
    },
  };
  readonly bodyShadows: BodyShadows = {
    body: (x, y, z, r) => {
      const lamp = this.lamp.sphere(x, y, z, r);
      if (this.cascades.count === 0 || Math.hypot(x, y, z) - r > this.castRange) return lamp;
      const stretch = this.stretch(x - r, z - r, x + r, z + r, y + r);
      return (this.inView(x - r, y - r, z - r, x + r, y + r, z + r, stretch) ? this.cascades.sphereMask(x, y, z, r, stretch) : 0) | lamp;
    },
    mesh: (mesh) => this.cascades.fits(this.radiusOfMesh[mesh]!),
  };
  /**
   * The characters' casters: in each cascade the coarsest held level within what its filter blurs, but none finer than
   * the held level nearest the one the view draws.
   */
  readonly castBody: CastFn = (mesh, lod, first, count, flags, cascades, standIn) => {
    const view = this.assets.heldLevel(mesh, lod);
    if (view < 0) return;
    const out = this.pairs;
    const n = this.cascades.entries(cascades, this.assets.table.error[mesh]!, this.assets.held(mesh), out);
    let left = cascades;
    for (let e = 0; e < n; e++) {
      if (out[e * 2]! <= view) continue;
      this.cast(mesh, out[e * 2]!, TRANSIENT_BUFFER, first, count, standIn, 0, 0, flags, out[e * 2 + 1]!);
      left &= ~out[e * 2 + 1]!;
    }
    if (left !== 0) this.cast(mesh, view, TRANSIENT_BUFFER, first, count, standIn, 0, 0, flags, left);
  };
  private castFrame = 0;
  private readonly leafyOf: Uint16Array;
  private readonly leafyFrame: Int32Array;
  private readonly packet: FramePacket;
  private readonly assets: Assets;
  private readonly terrain: TerrainLod;
  private readonly hiding: Hiding;
  private characters!: Characters;
  private lamps!: StreetLamps;
  private readonly materialFlags: Uint8Array;
  private readonly bentFlags: Uint32Array;
  private readonly trisOfMesh: readonly (readonly number[])[];
  private readonly radiusOfMesh: Float32Array;
  private readonly foliageOf: Uint16Array;

  constructor(packet: FramePacket, assets: Assets, terrain: TerrainLod, hiding: Hiding, looks: CastLooks) {
    this.packet = packet;
    this.assets = assets;
    this.terrain = terrain;
    this.hiding = hiding;
    this.materialFlags = looks.materialFlags;
    this.bentFlags = looks.bentFlags;
    this.trisOfMesh = looks.trisOfMesh;
    this.radiusOfMesh = looks.radiusOfMesh;
    this.foliageOf = looks.foliageOf;
    this.leafyOf = new Uint16Array(looks.foliageOf.length);
    this.leafyFrame = new Int32Array(looks.foliageOf.length).fill(-1);
  }

  /** The bodies, which are told each frame whether they cast, and the street lamps, one of which may light: both made after this. */
  join(characters: Characters, lamps: StreetLamps): void {
    this.characters = characters;
    this.lamps = lamps;
  }

  /**
   * Fits the shadow cascades to the view, for the light they are cast from (sky.ts `castLight`: the sun, or by night the
   * moon where the tier's shadows say it casts and `moonShadows` is on) while it casts at all, and finds the floor: the
   * ground under each cascade's sphere, but no lower than the sphere reaches.
   */
  fit(cam: Camera): void {
    const p = this.packet;
    const c = this.cascades;
    const setup = p.tier.shadows;
    this.castFrame++;
    this.on = false;
    this.characters.shadows = null;
    this.sunCasts = false;
    if (p.lit && moonCasts(p.frame) && !(setup.moon && this.moonShadows)) p.frame[CAST_AT + 3] = 0;
    if (!p.lit || setup.cascades <= 0 || p.frame[CAST_AT + 3]! <= 0) {
      c.clear();
      return;
    }
    for (let k = 0; k < 3; k++) this.sunAt[k] = p.frame[CAST_AT + k]!;
    this.sunCasts = !moonCasts(p.frame);
    this.camera = cam;
    c.fit(cam, this.sunAt[0]!, this.sunAt[1]!, this.sunAt[2]!, setup, this.fitted++);
    p.cascadeCount = c.count;
    p.cascadesDrawn = c.drawn;
    c.write(p.cascades, p.spheres);
    if (c.drawn === 0) return;
    let floor = Infinity;
    let range = 0;
    for (let i = 0; i < c.count; i++) {
      const x = c.sphere[i * 4]!, y = c.sphere[i * 4 + 1]!, z = c.sphere[i * 4 + 2]!, r = c.sphere[i * 4 + 3]!;
      floor = Math.min(floor, Math.max(cam.y + y - r, this.terrain.lowest(cam.x + x - r, cam.z + z - r, cam.x + x + r, cam.z + z + r)));
      // The cube is snapped less than a texel from the sphere's middle.
      range = Math.max(range, Math.hypot(x, y, z) + (c.half[i]! + c.texel[i]!) * Math.sqrt(3));
    }
    this.floor = floor;
    this.castRange = range + MAX_REACH;
    let texel = 0;
    for (let i = 0; i < c.count; i++) texel = Math.max(texel, c.texel[i]!);
    // A cascade drawn every other frame is looked up a frame later from another place: no caster of it is left out.
    this.shadeSlack = setup.everyOther ? Infinity : texel * (c.blur + 1);
    this.sunY = this.sunAt[1]!;
    this.on = true;
    this.characters.shadows = this.bodyShadows;
  }

  /**
   * The street lamp that lights this frame (street-lamps.ts, lamp.ts), after the cascades are fitted: its view from the
   * lens and its part of the frame block, its map's bit among the maps drawn, so that what stands in its view casts into
   * it; and the matrices the shell draws the maps with, the cascades' and the lamp's. A lamp none of whose light can be
   * seen (all of it falls within LAMP_ACROSS of its lens across and LAMP_RANGE under it) draws nothing: its card is out
   * of sight with it.
   */
  fitLamp(cam: Camera): void {
    const p = this.packet, c = this.cascades, lamp = this.lamp, lamps = this.lamps, setup = p.tier.shadows;
    const x = lamps.lens[0]!, y = lamps.lens[1]!, z = lamps.lens[2]!;
    p.maps.set(p.cascades);
    if (!p.lit || !setup.lamp || setup.cascades <= 0 || lamps.shows <= 0 || !cam.boxVisible(x - LAMP_ACROSS, y - LAMP_RANGE, z - LAMP_ACROSS, x + LAMP_ACROSS, y, z + LAMP_ACROSS)) {
      lamp.off();
      c.lampTexel = 0;
      lampFrame(p.frame, null, lamps.way, 0, -1);
      return;
    }
    lamp.set(x, y, z, setup.size);
    lampFrame(p.frame, lamps.lens, lamps.way, lamps.shows, shadowLayer(MAX_CASCADES, setup.cascades));
    p.frame.set(lamp.matrix, LAMP_AT + 8);
    p.maps.set(lamp.matrix, MAX_CASCADES * 16);
    c.lampTexel = lamp.texel;
    c.drawn |= LAMP_BIT;
    p.cascadesDrawn = c.drawn;
    this.on = true;
    this.characters.shadows = this.bodyShadows;
  }

  /**
   * How far along the light the shadow of a camera-relative box whose top is `top` can reach: as far as the top stands
   * over the floor, or over the lowest ground where a shadow that long could fall, whichever is the shorter.
   */
  stretch(minX: number, minZ: number, maxX: number, maxZ: number, top: number): number {
    const p = this.packet;
    const most = reach(top + p.camY - this.floor, this.sunY);
    const sx = -this.sunAt[0]! * most, sz = -this.sunAt[2]! * most;
    const low = this.terrain.lowest(p.camX + Math.min(minX, minX + sx), p.camZ + Math.min(minZ, minZ + sz), p.camX + Math.max(maxX, maxX + sx), p.camZ + Math.max(maxZ, maxZ + sz));
    return low > this.floor ? reach(top + p.camY - low, this.sunY) : most;
  }

  /**
   * As `castBox`, the box's shadow reaching `stretch` metres along the light, or as far as `stretch()` finds where that is
   * under 0; and the lamp's map where the box stands in the lamp's view.
   */
  castsBy(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, stretch: number): number {
    const lamp = this.lamp.box(minX, minY, minZ, maxX, maxY, maxZ);
    const dx = Math.max(minX, -maxX, 0), dy = Math.max(minY, -maxY, 0), dz = Math.max(minZ, -maxZ, 0);
    if (this.cascades.count === 0 || dx * dx + dy * dy + dz * dz > this.castRange * this.castRange) return lamp;
    if (stretch < 0) stretch = this.stretch(minX, minZ, maxX, maxZ, maxY);
    return (this.inView(minX, minY, minZ, maxX, maxY, maxZ, stretch) ? this.cascades.mask(minX, minY, minZ, maxX, maxY, maxZ, Infinity, stretch) : 0) | lamp;
  }

  /**
   * Whether the shadow of a camera-relative box, swept `stretch` metres away from the sun, can fall in view: on what is
   * in the view, and once the frame knows what hides what, on what is not wholly hidden.
   */
  private inView(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, stretch: number): boolean {
    const sx = -this.sunAt[0]! * stretch, sy = -this.sunAt[1]! * stretch, sz = -this.sunAt[2]! * stretch;
    const x0 = Math.min(minX, minX + sx), y0 = Math.min(minY, minY + sy), z0 = Math.min(minZ, minZ + sz);
    const x1 = Math.max(maxX, maxX + sx), y1 = Math.max(maxY, maxY + sy), z1 = Math.max(maxZ, maxZ + sz);
    return this.camera!.boxVisible(x0, y0, z0, x1, y1, z1) && !this.shadeHidden(x0, y0, z0, x1, y1, z1);
  }

  /**
   * Whether the picture of what hides what hides all a caster's shadow can fall on, a camera-relative box swept from the
   * sun as far as it reaches, and round that as far as a lookup reaches past where its shadow falls: the filter's taps and
   * the half texel it is moved along a receiver's normal, in the coarsest cascade's texels.
   */
  shadeHidden(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    const e = this.shadeSlack;
    return e < Infinity && this.hiding.hidesOver(x0 - e, y0 - e, z0 - e, x1 + e, y1 + e, z1 + e);
  }

  /**
   * A standing tree's levels (`foliageOf`) that cut its leaves out and can be cut out in a depth map now, a bit each,
   * which a sharp enough map casts it at (shadow.ts LEAF_BLUR, D953); 0 for any other mesh, or while none can.
   */
  leafy(mesh: number): number {
    if (this.foliageOf[mesh] === 0) return 0;
    // What is on the card does not change within a frame: found once a frame for each mesh.
    if (this.leafyFrame[mesh] === this.castFrame) return this.leafyOf[mesh]!;
    let ok = 0;
    for (let l = 0, m = this.foliageOf[mesh]! & this.assets.held(mesh); m !== 0; l++, m >>>= 1) if ((m & 1) !== 0 && this.assets.heldCutouts(mesh, l)) ok |= 1 << l;
    this.leafyFrame[mesh] = this.castFrame;
    return (this.leafyOf[mesh] = ok);
  }

  /**
   * Puts `count` instances of a held level into the caster list for `cascades`. A level with cut-out or two-sided
   * sections is a caster for each section, cut out where the card holds what that reads; any other is its whole level.
   */
  cast(mesh: number, level: number, buffer: number, first: number, count: number, ox: number, oy: number, oz: number, flags: number, cascades: number): void {
    if (level < 0) return;
    const runs = this.assets.table.sections[mesh]![level] ?? FLAT;
    let split = false;
    for (let k = 0; k < runs.length; k += 3) split ||= runs[k]! >= 0 && (this.materialFlags[runs[k]!]! & (DRAW_CUTOUT | DRAW_TWO_SIDED)) !== 0;
    const cutouts = split && this.assets.heldCutouts(mesh, level);
    this.assets.keep(mesh, level, cutouts);
    const slot = this.assets.residency.slot(mesh, level);
    flags = (flags & CAST_FLAGS) | this.bentFlags[mesh]!;
    if (!split) return this.caster(mesh, level, slot, buffer, first, count, ox, oy, oz, flags, 0, 0, 0, cascades);
    for (let k = 0; k < runs.length; k += 3) {
      const m = this.materialFlags[runs[k]!]! & (cutouts ? DRAW_TEXTURED | DRAW_TWO_SIDED | DRAW_CUTOUT : DRAW_TEXTURED | DRAW_TWO_SIDED);
      this.caster(mesh, level, slot, buffer, first, count, ox, oy, oz, flags | m, runs[k]!, runs[k + 1]!, runs[k + 2]!, cascades);
    }
  }

  caster(mesh: number, level: number, slot: number, buffer: number, first: number, count: number, ox: number, oy: number, oz: number, flags: number, material: number, firstIndex: number, indexCount: number, cascades: number): void {
    const p = this.packet;
    const n = p.casterCount;
    if (n === MAX_CASTERS) {
      p.casterDropped++;
      return;
    }
    p.casterMesh[n] = mesh;
    p.casterLod[n] = level;
    p.casterSlot[n] = slot;
    p.casterBuffer[n] = buffer;
    p.casterFirst[n] = first;
    p.casterInstances[n] = count;
    p.casterOffset[n * 3] = ox;
    p.casterOffset[n * 3 + 1] = oy;
    p.casterOffset[n * 3 + 2] = oz;
    p.casterFlags[n] = flags;
    p.casterMaterial[n] = material;
    p.casterFirstIndex[n] = firstIndex;
    p.casterIndexCount[n] = indexCount;
    p.casterCascades[n] = cascades;
    p.casterCount = n + 1;
    const maps = this.maps(cascades);
    p.castDraws += maps;
    p.castTriangles += ((flags & (DRAW_TEXTURED | DRAW_RANGED)) !== 0 ? indexCount / 3 : this.trisOfMesh[mesh]![level]!) * count * maps;
  }

  /** The cascades of a caster's bits, counted. */
  maps(cascades: number): number {
    return (cascades & 1) + ((cascades >> 1) & 1) + ((cascades >> 2) & 1) + ((cascades >> 3) & 1) + ((cascades >> 4) & 1);
  }

  /** Moves caster `from` of the frame to `to`, an earlier one or the same. */
  moveCaster(from: number, to: number): void {
    if (from === to) return;
    const p = this.packet;
    p.casterMesh[to] = p.casterMesh[from]!;
    p.casterLod[to] = p.casterLod[from]!;
    p.casterSlot[to] = p.casterSlot[from]!;
    p.casterBuffer[to] = p.casterBuffer[from]!;
    p.casterFirst[to] = p.casterFirst[from]!;
    p.casterInstances[to] = p.casterInstances[from]!;
    p.casterOffset.copyWithin(to * 3, from * 3, from * 3 + 3);
    p.casterFlags[to] = p.casterFlags[from]!;
    p.casterMaterial[to] = p.casterMaterial[from]!;
    p.casterFirstIndex[to] = p.casterFirstIndex[from]!;
    p.casterIndexCount[to] = p.casterIndexCount[from]!;
    p.casterCascades[to] = p.casterCascades[from]!;
  }

  /** Counts what the ground casts: its tiles into each cascade, a draw for each pair of tiles it reads from a cascade casts from. */
  groundCast(): void {
    const p = this.packet;
    let draws = 0;
    for (let t = 0; t < p.tileCount; t++) {
      const casts = (p.tilePass[t]! / TILE_CASTS) & 15;
      if (casts === 0) continue;
      p.castTriangles += ((casts & 1) + ((casts >> 1) & 1) + ((casts >> 2) & 1) + (casts >> 3)) * TILE_QUADS * TILE_QUADS * 2;
      draws |= casts << (p.tileSource[t * 4 + 3]! * 4);
    }
    for (; draws !== 0; draws &= draws - 1) p.castDraws++;
  }
}
