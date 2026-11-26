// Each city's hidden hangar, where its one jet is parked (planning/workstreams/jet.md): written by
// `bun tools/vehicles/hangars.ts --write` from the built maps, far from where survivors rise, on open level ground.
// x and z in metres on the map, yaw in radians, the way the jet's nose points.

export interface HangarSite {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

export const HANGARS: Readonly<Record<string, HangarSite>> = {
  "core:miami": { name: "Homestead Annex", x: 15796, z: 6836, yaw: -1.399 },
  "core:tampa": { name: "MacDill Annex", x: 1012, z: 500, yaw: 0.751 },
  "core:san-francisco": { name: "Moffett Annex", x: 1780, z: 3188, yaw: 0.909 },
  "core:los-angeles": { name: "Edwards Annex", x: 6388, z: 15732, yaw: 2.912 },
  "core:las-vegas": { name: "Groom Annex", x: 12596, z: 15604, yaw: -2.604 },
};
