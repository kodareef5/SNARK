// Missing panels and four hinge damage counters survive with the vehicle record.
import type { VehicleDefinition } from "../shared/sim/vehicle.ts";
import type { EntityRecord } from "./records.ts";

const PANEL_DAMAGE = 0x70616e;
const HINGE_STRENGTH = 60;

const doorMasks = new WeakMap<VehicleDefinition, Uint16Array>();

export function savedPanels(record: EntityRecord): number {
  const bytes = record.extra.get(PANEL_DAMAGE);
  return bytes ? bytes[0]! | (bytes[1]! << 8) : 0;
}

export function missingDoor(def: VehicleDefinition, door: number, missing: number): boolean {
  if (!missing) return false;
  let bits = doorMasks.get(def);
  if (!bits) {
    const panels = def.breakablePanels ?? [];
    bits = Uint16Array.from(def.doors, d => {
      const index = panels.findIndex(panel => panel.bone === d.bone);
      return index < 0 ? 0 : 1 << index;
    });
    doorMasks.set(def, bits);
  }
  return (bits[door]! & missing) !== 0;
}

export function damagePanel(record: EntityRecord, def: VehicleDefinition, index: number, points: number): number {
  const panels = def.breakablePanels, panel = panels?.[index];
  let missing = savedPanels(record);
  if (!panels || !panel || !(points > 0) || (missing & (1 << index))) return missing;
  const bytes = record.extra.get(PANEL_DAMAGE) ?? new Uint8Array(2 + def.doors.length);
  record.extra.set(PANEL_DAMAGE, bytes);
  const door = panel.door;
  if (door !== undefined && panel.bone === def.doors[door]!.bone) {
    const at = 2 + door;
    bytes[at] = Math.min(HINGE_STRENGTH, bytes[at]! + Math.ceil(points));
    if (bytes[at] < HINGE_STRENGTH) return missing;
    for (let i = 0; i < panels.length; i++) if (panels[i]!.door === door) missing |= 1 << i;
  } else missing |= 1 << index;
  bytes[0] = missing & 255;
  bytes[1] = missing >>> 8;
  return missing;
}
