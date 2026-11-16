// Player settings change nothing on the server. The shell persists the small set of interface preferences.

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
  /** Every sound but voice chat, then each bus of them (client/core/sound/packet.ts): a multiple of the default. */
  masterVolume = 1;
  /** Effects: creatures, steps, fighting, building. */
  soundVolume = 1;
  ambienceVolume = 1;
  musicVolume = 1;
  interfaceVolume = 1;
  /** The talk key toggles the microphone instead of being held. */
  toggleTalk = false;
  minimap = true;
  diagnostics = false;
  vitalLabels = false;
  minimapZoom = -1;
  padGlyphs = 0;
  /** Transient screen state; excluded from saved preferences. */
  tab = 0;
  revision = 0;

  changed(): void { this.revision++; }

  interfacePreferences(): string {
    const saved: Record<string, unknown> = { version: 1, tier: this.tier, snapshotBytes: this.snapshotBytes };
    for (const key of SAVED_FLAGS) saved[key] = this[key];
    for (const [key] of SAVED_NUMBERS) saved[key] = this[key];
    return JSON.stringify(saved);
  }

  restoreInterface(text: string | null): void {
    try {
      const saved = JSON.parse(text ?? "{}");
      if (!saved || Array.isArray(saved) || (saved.version !== undefined && saved.version !== 1)) return;
      for (const key of SAVED_FLAGS) if (typeof saved[key] === "boolean") this[key] = saved[key];
      for (const [key, lo, hi] of SAVED_NUMBERS) if (Number.isFinite(saved[key])) this[key] = Math.max(lo, Math.min(hi, saved[key]));
      this.minimapZoom = Math.round(this.minimapZoom);
      this.padGlyphs = Math.round(this.padGlyphs);
      if (["lowpoly", "medium", "high", "ultra"].includes(saved.tier)) this.tier = saved.tier;
      if (SNAPSHOT_BYTES.includes(saved.snapshotBytes)) this.snapshotBytes = saved.snapshotBytes;
    } catch {}
  }
}

const SAVED_FLAGS = ["minimap", "diagnostics", "vitalLabels", "damageNumbers", "toggleTalk", "steady"] as const;
const SAVED_NUMBERS = [["sensitivity", .2, 3], ["fov", 50, 100], ["voiceVolume", 0, 2], ["masterVolume", 0, 2], ["soundVolume", 0, 2], ["ambienceVolume", 0, 2], ["musicVolume", 0, 2], ["interfaceVolume", 0, 2], ["minimapZoom", -1, 3], ["padGlyphs", 0, 1]] as const;

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
  readonly range?: { readonly min: number; readonly max: number; readonly step: number; get(s: Settings): number; set(s: Settings, value: number): void };
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

type NumericSetting = "masterVolume" | "soundVolume" | "ambienceVolume" | "musicVolume" | "interfaceVolume" | "voiceVolume" | "sensitivity" | "fov";
function range(label: string, key: NumericSetting, min: number, max: number, step: number): SettingRow {
  const set = (s: Settings, value: number): void => { if (Number.isFinite(value)) s[key] = Number(clamp(min+Math.round((value-min)/step)*step,min,max).toFixed(4)); };
  return { label, value: s => key === "fov" ? `${s[key]} degrees` : `${Math.round(s[key]*100)}%`, step: (s,by)=>set(s,s[key]+by*step), range: { min,max,step,get:s=>s[key],set } };
}
const volume = (label: string, key: NumericSetting): SettingRow => range(label,key,0,VOLUME_MAX,.1);

const TIER_LABEL: Readonly<Record<Tier["name"], string>> = { lowpoly: "low poly", medium: "medium", high: "high", ultra: "ultra" };

export const SETTING_ROWS: readonly SettingRow[] = [
  { label: "Damage numbers", value: (s) => (s.damageNumbers ? "on" : "off"), step: (s) => void (s.damageNumbers = !s.damageNumbers) },
  range("Mouse sensitivity","sensitivity",SENSITIVITY_MIN,SENSITIVITY_MAX,.1),
  range("Field of view","fov",FOV_MIN,FOV_MAX,5),
  volume("Voice volume","voiceVolume"),
  { label: "Talk key (B)", value: (s) => (s.toggleTalk ? "on and off" : "hold"), step: (s) => void (s.toggleTalk = !s.toggleTalk) },
  volume("Master volume", "masterVolume"),
  volume("Effects volume", "soundVolume"),
  volume("Ambience volume", "ambienceVolume"),
  volume("Music volume", "musicVolume"),
  volume("Interface volume", "interfaceVolume"),
  { label: "Keep all assets", value: (s) => s.kept, step: (s) => void (s.download = true) },
  { label: "Graphics", value: (s) => TIER_LABEL[s.tier], step: (s, by) => {
      // A tier not offered here is above those that are.
      const [list, at] = [offeredTiers(s.touchFirst), offeredTiers(s.touchFirst).findIndex((t) => t.name === s.tier)];
      s.tier = (at < 0 ? list.at(-1)! : list[clamp(at + by, 0, list.length - 1)]!).name;
    } },
  { label: "Steady frame", value: (s) => (s.steady ? "automatic" : "off"), step: (s) => void (s.steady = !s.steady) },
  { label: "Connection", value: (s) => `${Math.round((s.snapshotBytes * TICK_RATE) / 1000)} KB/s`, step: (s, by) => void (s.snapshotBytes = SNAPSHOT_BYTES[clamp(SNAPSHOT_BYTES.indexOf(s.snapshotBytes) + by, 0, SNAPSHOT_BYTES.length - 1)]!) },
  { label: "Minimap", value: (s) => s.minimap ? "on" : "off", step: (s) => void (s.minimap = !s.minimap) },
  { label: "Status labels", value: (s) => s.vitalLabels ? "on" : "off", step: (s) => void (s.vitalLabels = !s.vitalLabels) },
  { label: "Diagnostics", value: (s) => s.diagnostics ? "on" : "off", step: (s) => void (s.diagnostics = !s.diagnostics) },
];

const megabytes = (bytes: number): string => (bytes >= 1048576 * 10 ? `${Math.round(bytes / 1048576)} MB` : `${(bytes / 1048576).toFixed(1)} MB`);

/** What is kept of the assets between visits, for the settings screen. */
export function keptLine(cache: { used: number; mode: "disk" | "memory" | "none"; filling: number } | null): string {
  if (!cache || cache.mode === "none") return "all here";
  if (cache.filling > 0) return `${cache.filling} to fetch`;
  return cache.mode === "disk" ? `${megabytes(cache.used)} kept` : "not kept";
}
