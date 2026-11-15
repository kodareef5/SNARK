// Player settings. They change nothing on the server and last only while the page is open.

import { TICK_RATE } from "../../shared/coords.ts";
import { DEFAULT_TIER, offeredTiers, type Tier } from "./assets/tiers.ts";

export class Settings {
  /** How much detail is drawn (client/core/assets/tiers.ts). */
  tier: Tier["name"] = DEFAULT_TIER;
  /**
   * "Steady frame: automatic": under the tier chosen, the game may draw the far shadows every other frame, fewer pixels,
   * shadows and far trees less far, and at the last no sun shadows, to keep 60 frames a second (client/core/governor.ts).
   * It never changes the tier. Off draws the tier exactly.
   */
  steady = true;
  /** A touch-first device, which draws a tier as its touch rule says and is offered the tiers it allows (tiers.ts). The shell sets it. */
  touchFirst = false;
  /** The byte budget of a snapshot the server is asked for, one of SNAPSHOT_BYTES. A server may allow less. */
  snapshotBytes = 1100;
  /** What is kept of the assets between visits, in words. The app writes it each frame. */
  kept = "";
  /** Set by the settings screen to ask for every asset to be fetched and kept. The app takes it. */
  download = false;
  /** Applies only if the server allows it. */
  damageNumbers = true;
  /** A multiple of the default. */
  sensitivity = 1;
  /** Vertical, in degrees. */
  fov = 70;
  /** A multiple of the default. */
  voiceVolume = 1;
  /** The world's sounds, a multiple of the default. */
  soundVolume = 1;
  /** The talk key toggles the microphone instead of being held. */
  toggleTalk = false;
}

export const VOLUME_MAX = 2;

export const SENSITIVITY_MIN = 0.2;
export const SENSITIVITY_MAX = 3;
export const FOV_MIN = 50;
export const FOV_MAX = 100;
/** With a snapshot every tick they are 18, 33 and 66 KB a second. */
export const SNAPSHOT_BYTES: readonly number[] = [600, 1100, 2200];

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
  { label: "Sound volume", value: (s) => `${Math.round(s.soundVolume * 100)}%`, step: (s, by) => void (s.soundVolume = clamp(Math.round((s.soundVolume + by * 0.1) * 10) / 10, 0, VOLUME_MAX)) },
  { label: "Keep all assets", value: (s) => s.kept, step: (s) => void (s.download = true) },
  { label: "Graphics", value: (s) => TIER_LABEL[s.tier], step: (s, by) => {
      // A tier not offered here is above those that are.
      const [list, at] = [offeredTiers(s.touchFirst), offeredTiers(s.touchFirst).findIndex((t) => t.name === s.tier)];
      s.tier = (at < 0 ? list.at(-1)! : list[clamp(at + by, 0, list.length - 1)]!).name;
    } },
  { label: "Steady frame", value: (s) => (s.steady ? "automatic" : "off"), step: (s) => void (s.steady = !s.steady) },
  { label: "Connection", value: (s) => `${Math.round((s.snapshotBytes * TICK_RATE) / 1000)} KB/s`, step: (s, by) => void (s.snapshotBytes = SNAPSHOT_BYTES[clamp(SNAPSHOT_BYTES.indexOf(s.snapshotBytes) + by, 0, SNAPSHOT_BYTES.length - 1)]!) },
];

const megabytes = (bytes: number): string => (bytes >= 1048576 * 10 ? `${Math.round(bytes / 1048576)} MB` : `${(bytes / 1048576).toFixed(1)} MB`);

/** What is kept of the assets between visits, for the settings screen. */
export function keptLine(cache: { used: number; mode: "disk" | "memory" | "none"; filling: number } | null): string {
  if (!cache || cache.mode === "none") return "all here";
  if (cache.filling > 0) return `${cache.filling} to fetch`;
  return cache.mode === "disk" ? `${megabytes(cache.used)} kept` : "not kept";
}
