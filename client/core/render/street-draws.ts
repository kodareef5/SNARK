// Resolve the authored finish once per material or mesh and put each draw's optical inputs in the frame.
import { crownedSpokes, fixtureKind, CHANNEL, EXHAUST, LENS } from "../../../content/street-finishes.ts";
import { MATERIAL_EXHAUST, MATERIAL_LENS, type PackHeader } from "../../../shared/pack/pack.ts";
import { nearMeshSlot } from "./nearcity.ts";
import { DRAW_EMISSIVE, DRAW_CUTOUT, DRAW_TEXTURED, type FramePacket } from "./packet.ts";
import { StreetMaterials, wheelBoneMask } from "./street-finish.ts";
import { OPTICS_CUT, glassSet } from "./vehicle-glass.ts";

interface DrawArt {
  meshes: readonly { id: string; rig?: number }[];
  materials?: readonly { id: string; flags?: number }[];
}
export class StreetDraws {
  private readonly materials: StreetMaterials;
  private readonly fixtures: Uint8Array;
  private readonly spokes: Uint8Array;
  private readonly wheels: Uint32Array;
  /** Each material's glass set (vehicle-glass.ts), 0 for none, 255 until its id has come. */
  private readonly glass: Uint8Array;
  private readonly art: DrawArt;
  constructor(art: DrawArt, rigs: PackHeader["rigs"]) {
    this.art = art;
    this.materials = new StreetMaterials(art.materials?.length ?? 0, art.meshes);
    this.fixtures = Uint8Array.from(art.meshes, mesh => fixtureKind(mesh.id));
    this.spokes = Uint8Array.from(art.meshes, mesh => Number(crownedSpokes.has(mesh.id)));
    this.wheels = Uint32Array.from(rigs ?? [], rig => wheelBoneMask(rig.names));
    this.glass = new Uint8Array(art.materials?.length ?? 0).fill(255);
  }
  write(p: FramePacket): void {
    for (let d = 0; d < p.drawCount; d++) {
      const mesh = p.drawMesh[d]!;
      p.drawFixture[d] = nearMeshSlot(p.drawSlot[d]!) ? -1 : this.fixtures[mesh] ?? 0;
      if ((p.drawFlags[d]! & DRAW_TEXTURED) === 0) continue;
      // The mesh's rig index and the material ID arrive with their individual manifest pages.
      const wheels = this.wheels[this.art.meshes[mesh]?.rig ?? -1] ?? 0;
      p.drawWheelBones[d] = wheels;
      const m = p.drawMaterial[d]!;
      const material = this.art.materials?.[m];
      // A material that holds a vehicle's glass is drawn cut out, so that its panes may cover a share of a pixel; one
      // not cut out of itself is marked so (OPTICS_CUT), for `?off=glass` to draw it as it was.
      let glass = this.glass[m] ?? 0;
      if (glass === 255) glass = material?.id ? (this.glass[m] = glassSet(material.id)) : 0;
      p.drawOptics[d] = (wheels ? this.spokes[mesh]! : 0) + 2 * glass;
      if (glass && (p.drawFlags[d]! & DRAW_CUTOUT) === 0) {
        p.drawFlags[d]! |= DRAW_CUTOUT;
        p.drawOptics[d]! |= OPTICS_CUT;
      }
      const flags = material?.flags ?? 0;
      // An instrument's own light wears its atlas for the strip alone, and is drawn as energy in a channel.
      p.drawStreetMaterial[d] = (p.drawFlags[d]! & DRAW_EMISSIVE) !== 0 ? CHANNEL : flags & MATERIAL_EXHAUST ? EXHAUST : flags & MATERIAL_LENS ? LENS
        : this.materials.code(m, material?.id ?? "", mesh, wheels !== 0);
    }
  }
}
