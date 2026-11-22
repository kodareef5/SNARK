// Water: the sea as tiles of one flat mesh, and the lakes, each a tile of its own (../lakes.ts). On a lit tier, seen from
// above, both are drawn with their waves and their depth (../water.ts), from the frame block's sea part, which is set here.

import type { Registry } from "../../../../shared/content/registry.ts";
import { WATER_COLOR } from "../../../../shared/pack/palette.ts";
import type { Assets } from "../../assets/assets.ts";
import type { Draws } from "../draws.ts";
import { FAR_MESH } from "../far.ts";
import { LAKE_BUFFER, Lakes } from "../lakes.ts";
import { DRAW_BLEND, DRAW_WATER, MAX_DRAWS, MAX_WATER_TILES, PASS_FAR, PASS_NEAR, TRANSIENT_BUFFER, type FramePacket } from "../packet.ts";
import type { Frame, Pass } from "../pass.ts";
import type { RenderWorld } from "../scene.ts";
import { WATER_TILE } from "../shading.ts";
import type { TerrainLod } from "../terrain.ts";
import { WaterTrails } from "../water-trails.ts";
import { WATER_ASKED, WATER_MATERIAL, seaFrame } from "../water.ts";

const WATER_MESH = "core:water";
const NEAR = 1 << PASS_NEAR;
const FAR = 1 << PASS_FAR;

export class Water implements Pass {
  private readonly mesh: number;
  /** The material whose pictures the sea draws, or -1 where the pack has none. */
  private readonly material: number;
  /** Water on its own surfaces apart from the sea, and the sea round those whose beds go under it (lakes.ts), given the far mesh. */
  private readonly lakes: Lakes | null;
  private readonly trails: WaterTrails;
  private readonly packet: FramePacket;
  private readonly put: Draws;
  private readonly terrain: TerrainLod;
  /** Whether the lakes are drawn with their waves this frame, and whether any was. */
  private lakesLit = false;
  private lakesWaved = false;

  constructor(world: RenderWorld, reg: Registry, assets: Assets, packet: FramePacket, put: Draws, terrain: TerrainLod) {
    const table = assets.table;
    this.lakes = world.hf.water && table.find(FAR_MESH) >= 0 ? new Lakes(world.hf, world.hf.water, table.find(FAR_MESH)) : null;
    this.mesh = table.find(WATER_MESH);
    this.material = table.materials.findIndex((m) => m.id === WATER_MATERIAL);
    this.trails = new WaterTrails(reg);
    this.packet = packet;
    this.put = put;
    this.terrain = terrain;
  }

  /** After a lost graphics context. */
  reset(): void {
    this.lakes?.reset();
  }

  /**
   * See-through draws go as made, and the sea is made first of them, so that a yacht's wires show over it. The lakes are
   * brought up to date here too, as they always were, so what they put on the card comes after the far layers'.
   */
  draw(f: Frame): void {
    const p = f.packet, cam = f.cam, hf = f.world.hf, sea = hf.seaLevel;
    const lit = p.lit && !f.plainSky && !f.under;
    let waves = sea > -Infinity && this.mesh >= 0 && this.sea(f, sea, lit);
    if (this.lakes) waves = this.showLakes(f, lit) || waves;
    if (!waves) return;
    seaFrame(p.frame, hf, this.terrain.size, p.groundWindow, cam.x, cam.z, f.now / 1000, cam.y);
    this.trails.frame(p.frame, hf, cam, f.own, f.remote, f.now / 1000, f.tier.waterMarks);
    if (this.material >= 0) f.assets.residency.material(this.material, WATER_ASKED.pixels, WATER_ASKED.distance);
  }

  /**
   * Tiles of one flat mesh over the map, drawn last because they are see-through, but for those the lakes draw. With
   * `lit` the sea runs on past the map to the end of the view, and is drawn with its waves and its depth (water.ts);
   * seen from under water, or in a plain sky, it is as it always was. Whether it drew with its waves.
   */
  private sea(f: Frame, sea: number, lit: boolean): boolean {
    const p = f.packet, cam = f.cam;
    const hf = f.world.hf;
    const first = p.transientCount;
    let n = 0;
    const half = WATER_TILE / 2;
    const r = Math.ceil(f.view / WATER_TILE);
    const cx = Math.floor(cam.x / WATER_TILE), cz = Math.floor(cam.z / WATER_TILE);
    const ix0 = lit ? cx - r : 0, iz0 = lit ? cz - r : 0;
    const ix1 = lit ? cx + r : Math.ceil(hf.sizeX / WATER_TILE) - 1, iz1 = lit ? cz + r : Math.ceil(hf.sizeZ / WATER_TILE) - 1;
    // The box round every tile drawn, for its depth ranges.
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let tz = iz0; tz <= iz1; tz++) {
      for (let tx = ix0; tx <= ix1; tx++) {
        const x = tx * WATER_TILE + half - cam.x;
        const z = tz * WATER_TILE + half - cam.z;
        const y = sea - cam.y;
        if (this.lakes?.holed(tx, tz) || !cam.boxVisible(x - half, y - 0.1, z - half, x + half, y + 0.1, z + half)) continue;
        if (n === MAX_WATER_TILES) {
          p.dropped++;
          continue;
        }
        f.transient.set(first + n, x, y, z, 0, WATER_COLOR);
        p.transientIds[first + n] = 0;
        n++;
        x0 = Math.min(x0, x - half);
        z0 = Math.min(z0, z - half);
        x1 = Math.max(x1, x + half);
        z1 = Math.max(z1, z + half);
      }
    }
    if (n === 0) return false;
    const d = p.drawCount;
    f.put.draw(this.mesh, 0, TRANSIENT_BUFFER, first, n, 0, 0, 0, lit ? DRAW_BLEND | DRAW_WATER : DRAW_BLEND, cam.passes(x0, sea - cam.y - 0.1, z0, x1, sea - cam.y + 0.1, z1));
    p.transientCount = first + n;
    if (!lit || p.drawCount === d) return false;
    p.drawMaterial[d] = this.material;
    return true;
  }

  /** The lakes' tiles to the end of the view, each a draw as the sea's is. Whether any drew with its waves. */
  private showLakes(f: Frame, lit: boolean): boolean {
    const cam = f.cam;
    this.lakes!.update(f.packet, f.assets.residency, cam.x, cam.z, f.view);
    this.lakesLit = lit;
    this.lakesWaved = false;
    this.lakes!.draw(cam, f.view, this.drawLake);
    return this.lakesWaved;
  }

  /** A lake tile, a draw as the sea's is. */
  private readonly drawLake = (slot: number, triangles: number, ox: number, oy: number, oz: number, passes: number): void => {
    const p = this.packet;
    const d = p.drawCount;
    const copies = passes === (NEAR | FAR) ? 2 : 1;
    if (d + this.put.doubled + copies > MAX_DRAWS) {
      p.dropped++;
      return;
    }
    this.put.nearOf[d] = 0;
    p.drawMesh[d] = this.lakes!.mesh;
    p.drawLod[d] = 0;
    p.drawSlot[d] = slot;
    p.drawBuffer[d] = LAKE_BUFFER;
    p.drawFirst[d] = 0;
    p.drawInstances[d] = 1;
    p.drawFlags[d] = this.lakesLit ? DRAW_BLEND | DRAW_WATER : DRAW_BLEND;
    p.drawOffset[d * 3] = ox;
    p.drawOffset[d * 3 + 1] = oy;
    p.drawOffset[d * 3 + 2] = oz;
    p.drawMaterial[d] = this.material;
    this.put.passOf[d] = passes;
    p.drawCount = d + 1;
    this.put.doubled += copies - 1;
    p.triangles += triangles * copies;
    this.lakesWaved ||= this.lakesLit;
  };
}
