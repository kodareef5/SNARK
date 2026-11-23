/** All attachment points are in metres from the centre of the pod's floor. */
export const AIR_FRAME = {
  halfWidth: 1.2,
  halfLength: 3.9,
  height: 1.92,
  jawX: 1.17,
  jawY: 1.65,
  jawZ: 3.52,
  carrierY: 3.85,
  rotorZ: 3.84,
  rotorRadius: 3.55,
  roofX: -1.15,
  roofY: 1.85,
  roofAngle: (Math.PI * 5) / 6,
  sideX: 1.16,
  sideY: 0.3,
  sideAngle: (-Math.PI * 95) / 180,
  bayY: 0.95,
  deck: 1.3,
  axle: [-3.75, -2.5],
  wheel: 0.51,
} as const;
export const airBayZ = (bay: number): number => (bay - 2.5) * 1.1;
export const AIR_PIECES = [
  "carrier",
  "rotor",
  "clamp",
  "pod",
  "roof",
  "side",
  "drone",
  "chassis",
  "wheel",
  "feet",
  "indicator",
  "marker",
] as const;
export type AirPiece = (typeof AIR_PIECES)[number];
export const airMesh = (piece: AirPiece): string => "core:air_support/" + piece;
