// The map events, drawn from the feed the server tells (mapevent/shown.ts) at the tick the remote bodies are shown at.
// Each part is drawn by the view of its type (mapevent/views.ts), never by its event's kind, so a kind a module adds is
// drawn by its parts. A piece is a draw of its own on one bone, as the supply drops' are; light and smoke are a cone
// drawn see-through. This file comes after the first frame (mapevent-late.ts).

import type { Assets } from "../../assets/assets.ts";
import { nearestColour } from "../../../../shared/pack/palette.ts";
import { newCraftPose } from "../../../../shared/sim/craft.ts";
import type { Frame, Pass } from "../pass.ts";
import { BONE_FLOATS, DRAW_PLAIN, DRAW_SKINNED, MAX_BONES, MAX_DRAWS, TRANSIENT_BUFFER } from "../packet.ts";
import type { MapEventsShown, ShownPart } from "../../mapevent/shown.ts";
import { PART_VIEWS, type PartView } from "../../mapevent/views.ts";

/** The stand-ins every pack has (tools/pack/mapevent.ts): a turned disc, its glow in colour region 0, and a cone. */
export const EVENT_DISC = "core:event_disc";
export const EVENT_CONE = "core:event_cone";
/** Craft whose places a frame keeps for the tests and the pictures (`placed`). */
export const PLACED_MOST = 16;

/** What the views draw with: the frame, a pose to work in, and a draw of a mesh on a turn of its own. */
export class EventKit {
  f!: Frame;
  readonly assets: Assets;
  readonly pose = newCraftPose();
  readonly disc: number;
  readonly cone: number;
  /** The turn the next draw stands on, as three columns: right, up and ahead. */
  readonly axes = new Float64Array(9);
  /** What the frame drew: craft, beams, smoke over a wreck, columns over a site, and draws of the packet in all. */
  craft = 0;
  beams = 0;
  smokes = 0;
  columns = 0;
  draws = 0;
  /** Where each craft drawn this frame is, in the world, three numbers each, in the order drawn. */
  readonly placed = new Float64Array(PLACED_MOST * 3);
  private readonly palette: Uint8Array;
  private readonly tints = new Map<number, number>();

  constructor(assets: Assets, palette: Uint8Array) {
    this.assets = assets;
    this.palette = palette;
    this.disc = assets.table.find(EVENT_DISC);
    this.cone = assets.table.find(EVENT_CONE);
  }

  /** The palette colour nearest 0xRRGGBB, a colour region's dye. */
  tint(rgb: number): number {
    let at = this.tints.get(rgb);
    if (at === undefined) this.tints.set(rgb, (at = nearestColour(this.palette, (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255)));
    return at;
  }

  /** Whether a mesh can be drawn now without waiting for it. */
  held(mesh: number): boolean {
    return mesh >= 0 && this.assets.held(mesh) !== 0;
  }

  /** Says the coarsest level of a mesh is wanted, for something `distance` metres off. */
  wantCoarsest(mesh: number, distance: number): void {
    if (mesh >= 0) this.assets.want(mesh, this.assets.table.error[mesh]!.length - 1, distance);
  }

  /** Keeps the place of a craft drawn. */
  place(x: number, y: number, z: number): void {
    if (this.craft >= PLACED_MOST) return;
    const at = this.craft * 3;
    this.placed[at] = x;
    this.placed[at + 1] = y;
    this.placed[at + 2] = z;
  }

  /** Sets the turn of the next draw: its up along (ux, uy, uz), turned `around` radians about it from facing +Z. */
  turn(ux: number, uy: number, uz: number, around: number): void {
    const a = this.axes;
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    let fx = Math.sin(around);
    let fz = Math.cos(around);
    // Ahead is the turn's +Z made square to up; along a nearly level up, +X stands in.
    const along = fx * ux + fz * uz;
    fx -= ux * along;
    let fy = -uy * along;
    fz -= uz * along;
    let fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
    if (fl < 1e-6) {
      fx = uy;
      fy = -ux;
      fz = 0;
      fl = Math.sqrt(fx * fx + fy * fy) || 1;
    }
    fx /= fl;
    fy /= fl;
    fz /= fl;
    // Right is up crossed with ahead.
    a[0] = uy * fz - uz * fy;
    a[1] = uz * fx - ux * fz;
    a[2] = ux * fy - uy * fx;
    a[3] = ux;
    a[4] = uy;
    a[5] = uz;
    a[6] = fx;
    a[7] = fy;
    a[8] = fz;
  }

  /**
   * Draws `mesh` with its origin at camera-relative (x, y, z) on the turn `turn` set, `wide` times its size across and
   * `tall` times along its up, in colour region 0's dye. Its box is `reach` about the point `mid` of its height up from
   * its origin. `fade` thins a see-through draw. Returns whether it is in the packet.
   */
  put(mesh: number, x: number, y: number, z: number, wide: number, tall: number, reach: number, mid: number, dye: number, flags: number, fade = 0): boolean {
    const f = this.f, p = f.packet, a = this.axes;
    if (mesh < 0 || p.transientCount >= p.transientIds.length || p.drawCount + f.put.doubled >= Math.min(f.tier.budget.draws, MAX_DRAWS) || p.boneCount >= Math.min(f.tier.bones, MAX_BONES)) return false;
    const cx = x + a[3]! * tall * mid, cy = y + a[4]! * tall * mid, cz = z + a[5]! * tall * mid;
    const x0 = cx - reach, y0 = cy - reach, z0 = cz - reach, x1 = cx + reach, y1 = cy + reach, z1 = cz + reach;
    if (!f.cam.boxVisible(x0, y0, z0, x1, y1, z1)) return false;
    const scale = wide > tall ? wide : tall;
    const distance = Math.max(1, Math.sqrt(cx * cx + cy * cy + cz * cz) - reach) / Math.max(1e-3, scale);
    const level = this.assets.choose(this.assets.table.error[mesh]!, distance, -1);
    this.assets.wantTextured(mesh, level, distance);
    const bone = p.boneCount++, b = bone * BONE_FLOATS, bones = p.bones;
    bones[b] = a[0]! * wide;
    bones[b + 1] = a[3]! * tall;
    bones[b + 2] = a[6]! * wide;
    bones[b + 3] = x;
    bones[b + 4] = a[1]! * wide;
    bones[b + 5] = a[4]! * tall;
    bones[b + 6] = a[7]! * wide;
    bones[b + 7] = y;
    bones[b + 8] = a[2]! * wide;
    bones[b + 9] = a[5]! * tall;
    bones[b + 10] = a[8]! * wide;
    bones[b + 11] = z;
    const first = p.transientCount++;
    f.transient.setSkinned(first, bone, dye);
    p.transientIds[first] = 0;
    const before = p.drawCount;
    f.put.fade = fade;
    f.put.draw(mesh, level, TRANSIENT_BUFFER, first, 1, 0, 0, 0, DRAW_PLAIN | DRAW_SKINNED | flags, f.cam.passes(x0, y0, z0, x1, y1, z1));
    f.put.fade = 0;
    this.draws += p.drawCount - before;
    return p.drawCount > before;
  }
}

export class MapEventPass implements Pass {
  /** The events told and the tick to draw them at. The scene sets it (Scene.mapEventsShown). */
  shown: MapEventsShown | null = null;
  readonly kit: EventKit;
  /** The events the meshes were last found for. */
  private found: MapEventsShown | null = null;

  constructor(assets: Assets, palette: Uint8Array) {
    this.kit = new EventKit(assets, palette);
  }

  /** What the last frame drew (EventKit). */
  get craft(): number { return this.kit.craft; }
  get beams(): number { return this.kit.beams; }
  get smokes(): number { return this.kit.smokes; }
  get columns(): number { return this.kit.columns; }
  get draws(): number { return this.kit.draws; }
  get placed(): Float64Array { return this.kit.placed; }

  /** The art each part may draw with is wanted, from the moment it is told of. */
  update(f: Frame): void {
    const shown = this.shown;
    if (!shown) return;
    const k = this.kit;
    k.f = f;
    if (this.found !== shown) {
      this.found = shown;
      for (let i = 0; i < shown.parts.length; i++) view(shown.parts[i]!).find(k, shown.parts[i]!);
    }
    for (let i = 0; i < shown.parts.length; i++) view(shown.parts[i]!).want(k, shown.parts[i]!, shown.tick);
  }

  draw(f: Frame): void {
    const k = this.kit;
    k.craft = k.beams = k.smokes = k.columns = k.draws = 0;
    const shown = this.shown;
    if (!shown || this.found !== shown) return;
    k.f = f;
    for (let i = 0; i < shown.parts.length; i++) view(shown.parts[i]!).draw(k, shown.parts[i]!, shown.tick);
  }
}

const view = (part: ShownPart): PartView<ShownPart> => PART_VIEWS[part.type] as PartView<ShownPart>;
