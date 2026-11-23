// What is drawn far away, as layers that hand over to each other by distance: the far city of the map's own buildings and
// its landmarks' far meshes, bases as blocks, the city past them as blocks from its tops, and trees and rocks past the near
// node field; and the far shadow of the city's outline. Each layer is a row of the frame's list (`rows`): it is brought up
// to date before anything draws, and draws after the near store, so that what hides what can leave its tiles out.

import type { Registry } from "../../../../shared/content/registry.ts";
import { landmarkFars } from "../../../../shared/pack/far.ts";
import type { Pack } from "../../../../shared/pack/pack.ts";
import { floatingKinds } from "../../../../shared/world/city.ts";
import type { Assets } from "../../assets/assets.ts";
import type { Casting } from "../casting.ts";
import type { BlocksSource, CityBlocks } from "../cityblocks.ts";
import type { Draws } from "../draws.ts";
import { CITY_BUFFER, FAR_BUFFER, FAR_MESH, FarBlocks, farColours } from "../far.ts";
import type { CitySource, FarCity } from "../farcity.ts";
import { FarLandmarks, LANDMARK_BUFFER } from "../farlandmarks.ts";
import { FarNodes, farLevelOf, type NodeLooks } from "../farnodes.ts";
import { FarShadow } from "../farshadow.ts";
import { DRAW_PULLED, DRAW_RANGED, FRAME, MAX_DRAWS, PASS_FAR, PASS_NEAR, type FramePacket } from "../packet.ts";
import type { Frame, PassRow } from "../pass.ts";
import type { RoofMap } from "../roofmap.ts";
import type { RenderWorld } from "../scene.ts";
import { HIDDEN } from "./near-store.ts";

const NEAR = 1 << PASS_NEAR;
const FAR = 1 << PASS_FAR;

/** What the layers read of the scene: its tables by kind, form and mesh, and which nodes it has hidden. */
export interface FarLooks {
  readonly meshOfKind: Uint16Array;
  readonly meshOfForm: Uint16Array;
  readonly sizeOfForm: Uint8Array;
  readonly colorOfForm: Uint8Array;
  readonly flatFlags: Uint16Array;
  readonly landmarkKinds: Uint8Array;
  /** The mesh that stands for a kind whose own no pack has. */
  readonly missing: number;
  /** The far store draws palms as their frond level, not their solid, for a bench's comparison (farLevelOf). */
  readonly farPalms: boolean;
  readonly hidden: (ref: number) => boolean;
}

export class FarLayers {
  /** Bases drawn as blocks where the near store does not hold their chunks whole, given a far source and the far mesh. */
  readonly far: FarBlocks | null;
  /** Nodes past the near node field, given a source of them. */
  readonly nodesFar: FarNodes | null;
  /** The map's own buildings where the near store does not hold their chunks whole, given a source of them. */
  city: FarCity | null = null;
  /** The world's statics the far city was made of. */
  private citySource: CitySource | null = null;
  /** The map's landmarks where the near store does not hold their pieces' chunks whole, with the far city. */
  landmarks: FarLandmarks | null = null;
  /** The city past what the far city and the far blocks draw, as blocks from its tops, given them and the far mesh. */
  blocks: CityBlocks | null = null;
  /** What the city's blocks are made from, until the late code (city-late.ts) has come to make them. */
  private blocksFrom: { tops: BlocksSource; colours: Uint8Array } | null;
  /** The far city and the city's blocks, once city-late.ts has loaded. Until then a scene draws neither. */
  static late: { FarCity: typeof FarCity; CityBlocks: typeof CityBlocks; RoofMap: typeof RoofMap } | null = null;
  /** Per content index, 1 for a kind that stands in the air with nothing under it, which casts no far shadow (city.ts floatingKinds). */
  private readonly floatingKinds: Uint8Array;
  readonly farMesh: number;
  private readonly farBounds: { center: readonly number[]; half: readonly number[] } | undefined;
  /** Past the cascades, the far map of the city's outline, with the far city, which makes the sky's openness too. */
  farShadow: FarShadow | null = null;
  /** Called when a far city is made, of the map's statics as they first come or as they are handed over again. */
  onCity: () => void = () => {};
  private readonly world: RenderWorld;
  private readonly assets: Assets;
  private readonly packet: FramePacket;
  private readonly put: Draws;
  private readonly casting: Casting;
  private readonly flatFlags: Uint16Array;
  private readonly landmarkKinds: Uint8Array;
  /** The pack's colours, four bytes each, which the map of what stands overhead takes the ground's colour from (roof.ts). */
  private readonly palette: Uint8Array;
  /** The layers' rows by name, in the order they are brought up to date and drawn in. */
  readonly rows: readonly PassRow[];

  constructor(world: RenderWorld, reg: Registry, pack: Pack, assets: Assets, packet: FramePacket, put: Draws, casting: Casting, from: FarLooks) {
    this.world = world;
    this.assets = assets;
    this.packet = packet;
    this.put = put;
    this.casting = casting;
    this.flatFlags = from.flatFlags;
    this.landmarkKinds = from.landmarkKinds;
    this.floatingKinds = floatingKinds(reg);
    this.palette = pack.palette;
    const table = assets.table;
    const far = (this.farMesh = table.find(FAR_MESH));
    this.farBounds = far >= 0 ? assets.manifest.meshes[far] : undefined;
    // A build works the colours out from every piece. Without them, they are worked out from the pieces the pack holds.
    const shown = (k: number): number => (from.meshOfKind[k] === from.missing || from.meshOfKind[k] === HIDDEN ? -1 : (pack.meshIndex.get(assets.manifest.meshes[from.meshOfKind[k]!]!.id) ?? -1));
    const listed = assets.manifest.farColours;
    const colours = this.farBounds && (world.far || world.tops) ? (listed ? Uint8Array.from(listed) : farColours(reg, pack, shown)) : null;
    this.far = world.far && colours ? new FarBlocks(world.far, world.dims, world.hf, far, this.farBounds!, colours) : null;
    this.blocksFrom = world.tops && colours ? { tops: world.tops, colours } : null;
    this.makeBlocks();
    const last = (mesh: number): ReturnType<NodeLooks["last"]> => assets.residency.heldGeometry(mesh, farLevelOf(assets.manifest.meshes[mesh]!.id, table.tris[mesh]!, from.farPalms));
    const looks: NodeLooks = { meshOfForm: from.meshOfForm, sizeOfForm: from.sizeOfForm, colorOfForm: from.colorOfForm, side: table.side, low: table.low, high: table.high, tris: table.tris, last, known: (mesh) => assets.known(mesh) };
    if (world.farNodes) world.farNodes.hidden = from.hidden;
    this.nodesFar = world.farNodes ? new FarNodes(world.farNodes, world.far?.cells ?? null, world.dims, reg, looks) : null;
    this.rows = [
      [
        "far city",
        {
          // The map's statics handed over again: the far city is made of them, taking over what it can of the one before.
          update: (f) => {
            if (this.city && this.world.city !== this.citySource) this.startCity(this.city);
            if (this.city ?? this.startCity()) this.farCity(f);
          },
          draw: (f) => void this.city?.draw(f.cam, f.alongGround(f.tier.reach.city), this.drawCity, f.hider),
        },
      ],
      [
        "far shadow",
        {
          update: (f) => {
            const cam = f.cam, p = this.packet, sun = p.cascadeCount > 0 ? this.casting.sunAt : null;
            this.farShadow?.update(p, this.assets.residency, cam.x, cam.y, cam.z, sun, f.now, this.casting.sunCasts ? sun : null);
          },
        },
      ],
      [
        "far bases",
        {
          update: (f) => {
            this.packet.frame[FRAME.fade] = f.tier.fade;
            this.far?.update(this.packet, this.assets.residency, f.cam.x, f.cam.z, f.tier.reach.bases);
          },
          draw: (f) => void this.far?.draw(f.cam, f.tier.reach.bases, f.tier.fade, this.drawFar, f.hider),
        },
      ],
      [
        "city blocks",
        {
          update: (f) => {
            this.makeBlocks();
            this.blocks?.update(this.packet, this.assets.residency, f.cam, this.blocksView(f), this.city ? this.citySource!.statics : null, this.city);
          },
          draw: (f) => void this.blocks?.draw(f.cam, this.blocksView(f), this.shown, this.drawCity, f.hider),
        },
      ],
      [
        "far nodes",
        {
          update: (f) => void this.nodesFar?.update(this.packet, this.assets.residency, f.cam.x, f.cam.z, f.tier, f.cam.zoom > 1 ? f.focusX : NaN, f.focusZ),
          draw: (f) => void this.nodesFar?.draw(f.cam, this.drawFarNodes, f.hider),
        },
      ],
    ];
  }

  /** The city's blocks' reach: a tier that draws no far city draws none of its blocks either. */
  private blocksView(f: Frame): number {
    return f.tier.reach.city > 0 && f.tier.city.levels.length > 0 ? f.view : 0;
  }

  /** The city's blocks, made once the late code has come: at once where it already has, as in tests and tools. */
  private makeBlocks(): void {
    if (this.blocks || !this.blocksFrom || !FarLayers.late) return;
    this.blocks = new FarLayers.late.CityBlocks(this.blocksFrom.tops, this.world.dims, this.world.hf, this.farMesh, this.blocksFrom.colours, this.landmarkKinds);
    this.blocksFrom = null;
  }

  /**
   * The far city once the world has the map's statics, which the far blocks then leave their cells to; or, given the far
   * city `before` of statics handed over before, of those the world has now.
   */
  startCity(before: FarCity | null = null): FarCity | null {
    const source = this.world.city;
    if (!source || !this.farBounds || !FarLayers.late) return null;
    this.citySource = source;
    this.city = new FarLayers.late.FarCity(source, this.world.dims, this.world.hf, this.farMesh, this.farBounds, this.landmarkKinds, before);
    this.farShadow = new FarShadow(source.statics, this.world.hf, this.city, source.maker ?? null, source.complete, this.landmarkKinds, this.floatingKinds);
    this.farShadow.roof = new FarLayers.late.RoofMap();
    this.farShadow.roof.palette = this.palette;
    this.far?.leaveTo(this.city);
    const placed = this.world.landmarks ?? [];
    if (placed.length > 0) this.landmarks = new FarLandmarks(source, this.world.dims, placed, landmarkFars(this.assets.manifest));
    this.onCity();
    return this.city;
  }

  /**
   * The map's buildings to the tier's reach, in place of chunks the near store does not hold whole, faded over the last
   * of it: what is on the card, and the landmarks' far meshes. The buildings are drawn once the near store is.
   */
  private farCity(f: Frame): void {
    const cam = f.cam;
    const p = this.packet;
    const tier = this.assets.tier;
    p.frame[FRAME.fade] = tier.fade;
    // Through a sight its tiles in the window reach as far as the view ends (D1088).
    this.city!.view = f.view;
    this.city!.update(p, this.assets.residency, cam, tier.city.levels, f.alongGround(tier.reach.city), tier.fade, this.world.structs, this.world.far?.cells ?? null);
    // A landmark is drawn to the end of the view, as the city's blocks leave its cells to it.
    this.landmarks?.draw(p, cam, this.assets, f.view, tier.fade, this.drawLandmark);
  }

  /** Who draws a chunk's buildings other than the city's blocks this frame (cityblocks.ts Shown). */
  private readonly shown = (chunk: number): number => {
    if (this.world.far?.complete(chunk) ?? this.world.city?.complete(chunk)) return -1;
    const city = this.city?.shows(chunk) ?? 0, far = this.far?.shows(chunk) ?? 0;
    return city < 0 || far < 0 ? -1 : city || far;
  };

  /** A tile of far blocks, `near` metres off: one instance of its own level, gone at the tier's reach where it reaches into the fade (far.ts). */
  private readonly drawFar = (slot: number, triangles: number, ox: number, oy: number, oz: number, passes: number, fade: number, near: number): void => {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.put.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    this.put.nearOf[d] = near;
    p.drawMesh[d] = this.far!.mesh;
    p.drawLod[d] = 0;
    p.drawSlot[d] = slot;
    p.drawBuffer[d] = FAR_BUFFER;
    p.drawFirst[d] = 0;
    p.drawInstances[d] = 1;
    p.drawFlags[d] = 0;
    p.drawOffset[d * 3] = ox;
    p.drawOffset[d * 3 + 1] = oy;
    p.drawOffset[d * 3 + 2] = oz;
    p.drawFade[d] = fade;
    this.put.passOf[d] = passes;
    p.drawCount = d + 1;
    this.put.doubled += copies - 1;
    p.triangles += triangles * copies;
  };

  /** A run of a far city tile's chunks at one of its levels, or of a tile of the city's blocks, `near` metres off: one instance, gone or come at `fade` (farcity.ts). */
  private readonly drawCity = (slot: number, firstIndex: number, indexCount: number, ox: number, oy: number, oz: number, passes: number, fade: number, near: number): void => {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.put.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    this.put.nearOf[d] = near;
    p.drawMesh[d] = this.farMesh;
    p.drawLod[d] = 0;
    p.drawSlot[d] = slot;
    p.drawBuffer[d] = CITY_BUFFER;
    p.drawFirst[d] = 0;
    p.drawInstances[d] = 1;
    p.drawFlags[d] = DRAW_RANGED;
    p.drawFirstIndex[d] = firstIndex;
    p.drawIndexCount[d] = indexCount;
    p.drawFade[d] = fade;
    p.drawOffset[d * 3] = ox;
    p.drawOffset[d * 3 + 1] = oy;
    p.drawOffset[d * 3 + 2] = oz;
    this.put.passOf[d] = passes;
    p.drawCount = d + 1;
    this.put.doubled += copies - 1;
    p.triangles += (indexCount / 3) * copies;
  };

  /** A run of a landmark's far mesh: its one instance, gone at `fade` (farlandmarks.ts), in its own colours as its flat draws are. */
  private readonly drawLandmark = (mesh: number, level: number, instance: number, firstIndex: number, indexCount: number, ox: number, oy: number, oz: number, passes: number, fade: number): void => {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.put.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    this.put.nearOf[d] = Math.hypot(ox, oy, oz);
    p.drawMesh[d] = mesh;
    p.drawLod[d] = level;
    p.drawSlot[d] = this.assets.residency.slot(mesh, level);
    p.drawBuffer[d] = LANDMARK_BUFFER;
    p.drawFirst[d] = instance;
    p.drawInstances[d] = 1;
    p.drawFlags[d] = DRAW_RANGED | this.flatFlags[mesh]!;
    p.drawFirstIndex[d] = firstIndex;
    p.drawIndexCount[d] = indexCount;
    p.drawFade[d] = fade;
    p.drawOffset[d * 3] = ox;
    p.drawOffset[d * 3 + 1] = oy;
    p.drawOffset[d * 3 + 2] = oz;
    this.put.passOf[d] = passes;
    p.drawCount = d + 1;
    this.put.doubled += copies - 1;
    p.triangles += (indexCount / 3) * copies;
  };

  /** A run of far nodes of every mesh, `near` metres off, each its mesh's row of the atlas (farnodes.ts), gone at its row's reach. */
  private readonly drawFarNodes = (slot: number, mesh: number, indices: number, buffer: number, first: number, count: number, ox: number, oy: number, oz: number, passes: number, hand: number, reach: number, near: number): void => {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.put.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    this.put.nearOf[d] = near;
    p.drawMesh[d] = mesh;
    p.drawLod[d] = 0;
    p.drawSlot[d] = slot;
    p.drawBuffer[d] = buffer;
    p.drawFirst[d] = first;
    p.drawInstances[d] = count;
    // An instance's vertices: the renderer reads them from the slot, and a count (bench-run.ts) from here.
    p.drawIndexCount[d] = indices;
    p.drawFlags[d] = DRAW_PULLED;
    p.drawOffset[d * 3] = ox;
    p.drawOffset[d * 3 + 1] = oy;
    p.drawOffset[d * 3 + 2] = oz;
    p.drawFade[d] = reach;
    p.drawHand[d] = hand;
    this.put.passOf[d] = passes;
    p.drawCount = d + 1;
    this.put.doubled += copies - 1;
    p.triangles += (indices / 3) * count * copies;
  };
}
