/** A shot is a camera and lighting preset on a named, locally rendered set. Distances are metres and angles degrees. */
export const CAMERA_FIELDS = {
  side: ["Truck", -16, 16, 0.05],
  back: ["Dolly", -8, 32, 0.05],
  height: ["Height", -3, 16, 0.05],
  pan: ["Pan", -180, 180, 0.25],
  tilt: ["Tilt", -65, 75, 0.25],
  lens: ["Field of view", 28, 94, 0.5],
  hour: ["Sun hour", 0, 23.95, 0.05],
} as const;
export type CameraField = keyof typeof CAMERA_FIELDS;
export interface TitleShot {
  id: string;
  name: string;
  set: "wynwood-shore";
  camera: Record<CameraField, number>;
}
export const OPENING_SHOT: TitleShot = {
  id: "red-tide",
  name: "Red tide at Wynwood",
  set: "wynwood-shore",
  camera: { side: -1.55, back: 1.8, height: 0.05, pan: 8, tilt: 13, lens: 68, hour: 18.35 },
};
export function validShot(value: unknown): value is TitleShot {
  if (!value || typeof value !== "object") return false;
  const s = value as TitleShot;
  if (
    s.set !== OPENING_SHOT.set ||
    typeof s.id !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,47}$/.test(s.id) ||
    typeof s.name !== "string" ||
    !s.name.trim() ||
    s.name.length > 80 ||
    !s.camera ||
    typeof s.camera !== "object"
  )
    return false;
  return (Object.keys(CAMERA_FIELDS) as CameraField[]).every((k) => {
    const [, lo, hi] = CAMERA_FIELDS[k];
    return Number.isFinite(s.camera[k]) && s.camera[k] >= lo && s.camera[k] <= hi;
  });
}
