// Resolve native foot calibration by the same content slots as the renderer. Hit capsules retain canonical proportions;
// only their seated ankle height follows the visible rider's actual look and footwear support correction.
import { HUMAN, SLOT_FEET, humanRest } from "../shared/anim/human.ts";
import { LOOK_SEX, SEX_IDS } from "../shared/anim/look.ts";
import { RiderSoles } from "../shared/anim/rider-soles.ts";
import type { Registry } from "../shared/content/registry.ts";
import { fillSlot, slotsOf } from "../shared/content/slots.ts";
import type { PackRig } from "../shared/pack/pack.ts";
import { GEAR_WORN } from "../shared/sim/entities.ts";
import type { EntityRecord } from "./records.ts";

interface Foot { rest: Float32Array; points: readonly number[] }
interface Body { bare: Foot; worn: Map<number, Foot> }
export class SeatedSoles {
  private readonly bodies = new Map<number, Body>();
  private readonly cache = new WeakMap<EntityRecord, RiderSoles>();

  constructor(reg: Registry, rigs: readonly PackRig[]) {
    const meshes = new Map<string, Foot>();
    for (const rig of rigs) {
      if (rig.skeleton !== HUMAN.id) continue;
      const rest = humanRest(rig.rest);
      for (const support of rig.soles ?? []) meshes.set(support.mesh, { rest, points: support.points });
    }
    if (meshes.size === 0) return;
    const slots = slotsOf(reg.defs.filter(d => d !== null)), has = (_: unknown, id: string): boolean => meshes.has(id);
    for (let kind = 0; kind < reg.defs.length; kind++) {
      const d = reg.defs[kind];
      if (d?.type !== "species" || d.skeleton !== HUMAN.id) continue;
      for (let sex = 0; sex < SEX_IDS.length; sex++) {
        const use = slots.find(u => u.owner === d.id && u.slot === "body" && u.key === `${SEX_IDS[sex]}/feet`);
        const bare = use ? meshes.get(fillSlot(use, has).id) : undefined;
        if (!bare) continue;
        const body = `${d.mesh}_${SEX_IDS[sex]}`.replace(/^[^:]*:/, ""), worn = new Map<number, Foot>();
        for (let item = 0; item < reg.defs.length; item++) {
          const def = reg.defs[item];
          if (def?.type !== "item" || def.wear?.slot !== "feet") continue;
          const use = slots.find(u => u.owner === def.id && u.slot === "worn" && u.key === body);
          const foot = use ? meshes.get(fillSlot(use, has).id) : undefined;
          if (foot) worn.set(item, foot);
        }
        this.bodies.set(kind * 2 + sex, { bare, worn });
      }
    }
  }

  of(rec: EntityRecord, gear: Uint16Array | undefined): Float64Array | null {
    const sex = rec.look?.[LOOK_SEX] ?? 0, body = this.bodies.get(rec.kind * 2 + (sex < 2 ? sex : 0));
    if (!body) return null;
    const foot = body.worn.get(gear?.[GEAR_WORN + SLOT_FEET] ?? 0) ?? body.bare;
    let cached = this.cache.get(rec);
    if (!cached) this.cache.set(rec, cached = new RiderSoles());
    return cached.update(foot.points, foot.rest, rec.look);
  }
}
