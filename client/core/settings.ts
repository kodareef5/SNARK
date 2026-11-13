// What a player may set for themselves. Nothing here changes what the server
// does or what anyone else sees; it is kept by the client for as long as the
// page is open.

export class Settings {
  /** Show the damage of one's own hits as numbers over where they landed, if the server allows it. */
  damageNumbers = true;
  /** How far a movement of the mouse turns the view, as a multiple of the usual. */
  sensitivity = 1;
  /** The field of view, top to bottom, degrees. */
  fov = 70;
}

export const SENSITIVITY_MIN = 0.2;
export const SENSITIVITY_MAX = 3;
export const FOV_MIN = 50;
export const FOV_MAX = 100;

/** One row of the settings screen: what it is called, what it says now, and what a step down or up does. */
export interface SettingRow {
  readonly label: string;
  value(s: Settings): string;
  step(s: Settings, by: number): void;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const SETTING_ROWS: readonly SettingRow[] = [
  { label: "Damage numbers", value: (s) => (s.damageNumbers ? "on" : "off"), step: (s) => void (s.damageNumbers = !s.damageNumbers) },
  { label: "Mouse sensitivity", value: (s) => `${Math.round(s.sensitivity * 100)}%`, step: (s, by) => void (s.sensitivity = clamp(Math.round((s.sensitivity + by * 0.1) * 10) / 10, SENSITIVITY_MIN, SENSITIVITY_MAX)) },
  { label: "Field of view", value: (s) => `${s.fov} degrees`, step: (s, by) => void (s.fov = clamp(s.fov + by * 5, FOV_MIN, FOV_MAX)) },
];
