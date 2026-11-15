import type { SpeciesDef } from "../../shared/content/defs.ts";

/** A real humanoid creature using the existing survivor art and equipment slots. */
export const CIVILIAN: SpeciesDef = {
  type: "species", class: "civilian", id: "core:civilian", mesh: "core:human", skeleton: "human",
  color: 8, radius: 0.3, height: 1.8, eyeHeight: 1.62,
  walkSpeed: 2.5, sprintMul: 1.6, jumpSpeed: 5, strafe: true,
  equips: true, slots: 12, fists: 8, temper: "flees", torporDrain: 4,
  stats: { health: [100, 0, 0.1], stamina: [100, 0, 0.1], weight: [80, 0, 0.1], torpidity: [120, 0, 0] },
};
