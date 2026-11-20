// Resolve the authored finish once per material or mesh and put each draw's optical inputs in the frame.
import { crownedSpokes, fixtureKind, LENS } from "../../../content/street-finishes.ts";
import { MATERIAL_LENS, type PackHeader } from "../../../shared/pack/pack.ts";
import { nearMeshSlot } from "./nearcity.ts";
import { DRAW_TEXTURED, type FramePacket } from "./packet.ts";
import { StreetMaterials, wheelBoneMask } from "./street-finish.ts";

interface DrawArt {
  meshes: readonly { id: string; rig?: number }[];
  materials?: readonly { id: string; flags?: number }[];
}
export class StreetDraws {
  private readonly materials: StreetMaterials;
  private readonly fixtures: Uint8Array;
  private readonly spokes: Uint8Array;
  private readonly wheels: Uint32Array;
  private readonly art: DrawArt;
  constructor(art: DrawArt, rigs: PackHeader["rigs"]) {
    this.art = art;
    this.materials = new StreetMaterials(art.materials?.length ?? 0, art.meshes);
    this.fixtures = Uint8Array.from(art.meshes, mesh => fixtureKind(mesh.id));
    this.spokes = Uint8Array.from(art.meshes, mesh => Number(crownedSpokes.has(mesh.id)));
    this.wheels = Uint32Array.from(rigs ?? [], rig => wheelBoneMask(rig.names));
  }
  write(p: FramePacket): void {
    for (let d = 0; d < p.drawCount; d++) {
      const mesh = p.drawMesh[d]!;
      p.drawFixture[d] = nearMeshSlot(p.drawSlot[d]!) ? -1 : this.fixtures[mesh] ?? 0;
      if ((p.drawFlags[d]! & DRAW_TEXTURED) === 0) continue;
      // The mesh's rig index and the material ID arrive with their individual manifest pages.
      const wheels = this.wheels[this.art.meshes[mesh]?.rig ?? -1] ?? 0;
      p.drawWheelBones[d] = wheels;
      p.drawSpokeCrown[d] = wheels ? this.spokes[mesh]! : 0;
      const m = p.drawMaterial[d]!;
      const material = this.art.materials?.[m];
      p.drawStreetMaterial[d] = ((material?.flags ?? 0) & MATERIAL_LENS) !== 0 ? LENS : this.materials.code(m, material?.id ?? "", mesh, wheels !== 0);
    }
  }
}
