import { LAKE_SLOTS, LAKE_SLOT_SPAN } from "./lakes.ts";

/** Slots of meshes on the card start here, past the lakes' (lakes.ts). */
export const NEAR_SLOTS = LAKE_SLOTS + LAKE_SLOT_SPAN;
export const NEAR_SLOT_SPAN = 2 ** 29;
/** These generated meshes carry each source fixture's finish in bits 6–7 of the static vertex. */
export const nearMeshSlot = (slot: number): boolean => slot >= NEAR_SLOTS && slot < NEAR_SLOTS + NEAR_SLOT_SPAN;
/** A slot of a chunk's instances that no piece takes: the one instance at its corner its mesh is drawn with. */
export const MESH_SLOT = 0xffff;
