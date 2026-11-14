// Player settings. They change nothing on the server and last only while the page is open.

import { DEFAULT_TIER, TIERS, type Tier } from "./assets/tiers.ts";

export class Settings {
  /** How much detail is drawn (client/core/assets/tiers.ts). */
  tier: Tier["name"] = DEFAULT_TIER;
  /** Applies only if the server allows it. */
  damageNumbers = true;
  /** A multiple of the default. */
  sensitivity = 1;
  /** Vertical, in degrees. */
  fov = 70;
  /** A multiple of the default. */
  voiceVolume = 1;
  /** The talk key toggles the microphone instead of being held. */
  toggleTalk = false;
}

export const VOLUME_MAX = 2;

export const SENSITIVITY_MIN = 0.2;
export const SENSITIVITY_MAX = 3;
export const FOV_MIN = 50;
export const FOV_MAX = 100;

export interface SettingRow {
  readonly label: string;
  value(s: Settings): string;
  step(s: Settings, by: number): void;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

const TIER_LABEL: Readonly<Record<Tier["name"], string>> = { lowpoly: "low poly", medium: "medium", high: "high", ultra: "ultra" };

export const SETTING_ROWS: readonly SettingRow[] = [
  { label: "Damage numbers", value: (s) => (s.damageNumbers ? "on" : "off"), step: (s) => void (s.damageNumbers = !s.damageNumbers) },
  { label: "Mouse sensitivity", value: (s) => `${Math.round(s.sensitivity * 100)}%`, step: (s, by) => void (s.sensitivity = clamp(Math.round((s.sensitivity + by * 0.1) * 10) / 10, SENSITIVITY_MIN, SENSITIVITY_MAX)) },
  { label: "Field of view", value: (s) => `${s.fov} degrees`, step: (s, by) => void (s.fov = clamp(s.fov + by * 5, FOV_MIN, FOV_MAX)) },
  { label: "Voice volume", value: (s) => `${Math.round(s.voiceVolume * 100)}%`, step: (s, by) => void (s.voiceVolume = clamp(Math.round((s.voiceVolume + by * 0.1) * 10) / 10, 0, VOLUME_MAX)) },
  { label: "Talk key (B)", value: (s) => (s.toggleTalk ? "on and off" : "hold"), step: (s) => void (s.toggleTalk = !s.toggleTalk) },
  { label: "Graphics", value: (s) => TIER_LABEL[s.tier], step: (s, by) => void (s.tier = TIERS[clamp(TIERS.findIndex((t) => t.name === s.tier) + by, 0, TIERS.length - 1)]!.name) },
];
