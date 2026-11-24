// Player settings change nothing on the server. The shell persists the small set of interface preferences.

import { TICK_RATE } from "../../shared/coords.ts";
import { DEFAULT_TIER, offeredTiers, startingTier, type Start, type Tier } from "./assets/tiers.ts";
import { RESOLUTIONS } from "./render/post.ts";

export const DEFAULT_ROAD_FINISH = 1;
export const DEFAULT_FINISH_GLOSS = 1.35;
const ROAD_FINISHES = ["Original", "Dry asphalt", "Dry + deeper shade"] as const;

export class Settings {
  /** How much detail is drawn (client/core/assets/tiers.ts). */
  tier: Tier["name"] = DEFAULT_TIER;
  /** The player chose the tier in the settings, or the game chose it short of the card's memory: only then is it saved, and the device's start leaves it. */
  chosen = false;
  /**
   * "Steady frame: automatic": under the tier chosen, the game may draw coarser levels, thinner crowns, the far shadows
   * every other frame, far trees less far, fewer pixels, and at the last fewer small details, to keep 60 frames a second
   * (client/core/governor.ts). It never changes the tier. Off draws the tier exactly.
   */
  steady = true;
  /**
   * "Render resolution": the pixels the scene is drawn at where the frame has a light target, the finish taking them up
   * to the canvas (render/post.ts RESOLUTIONS): the game's choice, the canvas's own, or a share of them a side. And the
   * share the game's choice comes to on this canvas and tier, which the app writes each frame for the row to show.
   */
  resolution = 0;
  autoShare = 1;
  finishGloss = DEFAULT_FINISH_GLOSS;
  roadFinish = DEFAULT_ROAD_FINISH;
  /** A touch-first device, which draws a tier as its touch rule says and is offered the tiers it allows (tiers.ts). The shell sets it. */
  touchFirst = false;
  /** The byte budget of a snapshot the server is asked for, one of SNAPSHOT_BYTES. A server may allow less. */
  snapshotBytes = 1100;
  /**
   * The player pressed "Download all" on the Storage tab: the game keeps everything the chosen tier needs on this
   * device, and on later visits fetches what an update changed. `keepPaused` holds that back until Resume.
   */
  keepAll = false;
  keepPaused = false;
  /** Applies only if the server allows it. */
  damageNumbers = true;
  /** A blow of the viewer's own turns its view a little, and one that lands kicks it (sight.ts). */
  viewKick = true;
  /** A multiple of the default. */
  sensitivity = 1;
  /**
   * "Zoom sensitivity": through a sight the look slows on the tangent of the view's half (optics.ts lookScale), so a point
   * on screen moves as far under the mouse at any zoom; this weighs the narrowed part of it, 1 for none.
   */
  zoomSensitivity = 1;
  /** Vertical, in degrees. */
  fov = 70;
  /** A multiple of the default. */
  voiceVolume = 1;
  /**
   * Nothing is heard, voice chat included, until the player asks for sound: a page that plays by itself is unwelcome
   * in a browser. The interface offers to unmute while this is set (ui/menu.ts unmuteButton), and the choice is saved.
   */
  muted = true;
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
  /** The heading tape at the top of the screen. */
  compass = true;
  /** The view a survivor rises in: from behind, or from the eye. V changes it, and it is kept. */
  thirdPerson = true;
  diagnostics = true;
  /** The debug bar at the screen's foot (debug/debug.ts): F3, `/debug` or the Interface tab turn it on, and it is kept. */
  debug = false;
  vitalLabels = false;
  minimapZoom = -1;
  padGlyphs = 0;
  /** Transient screen state; excluded from saved preferences. `page` is of the tab's rows, where a short canvas cannot show them all. */
  tab = 0;
  page = 0;
  revision = 0;

  changed(): void { this.revision++; }

  /** The tier the device starts on (tiers.ts startingTier), where none was chosen. */
  start(d: Omit<Start, "touchFirst">): void {
    if (!this.chosen) this.tier = startingTier({ ...d, touchFirst: this.touchFirst });
  }

  interfacePreferences(): string {
    const saved: Record<string, unknown> = { version: 2, ...(this.chosen ? { tier: this.tier } : {}), snapshotBytes: this.snapshotBytes };
    for (const key of SAVED_FLAGS) saved[key] = this[key];
    for (const [key] of SAVED_NUMBERS) saved[key] = this[key];
    return JSON.stringify(saved);
  }

  restoreInterface(text: string | null): void {
    try {
      const saved = JSON.parse(text ?? "{}");
      if (!saved || Array.isArray(saved) || saved.version !== 2) return;
      for (const key of SAVED_FLAGS) if (typeof saved[key] === "boolean") this[key] = saved[key];
      for (const [key, lo, hi] of SAVED_NUMBERS) if (Number.isFinite(saved[key])) this[key] = Math.max(lo, Math.min(hi, saved[key]));
      this.minimapZoom = Math.round(this.minimapZoom);
      this.padGlyphs = Math.round(this.padGlyphs);
      this.roadFinish = Math.round(this.roadFinish);
      this.resolution = Math.round(this.resolution);
      if (["lowpoly", "medium", "high", "ultra"].includes(saved.tier)) [this.tier, this.chosen] = [saved.tier, true];
      if (SNAPSHOT_BYTES.includes(saved.snapshotBytes)) this.snapshotBytes = saved.snapshotBytes;
    } catch {}
  }
}

const SAVED_FLAGS = ["minimap", "compass", "thirdPerson", "diagnostics", "debug", "vitalLabels", "damageNumbers", "viewKick", "toggleTalk", "steady", "muted", "keepAll", "keepPaused"] as const;
const SAVED_NUMBERS = [["sensitivity", .2, 3], ["zoomSensitivity", .5, 1.5], ["fov", 50, 100], ["voiceVolume", 0, 2], ["masterVolume", 0, 2], ["soundVolume", 0, 2], ["ambienceVolume", 0, 2], ["musicVolume", 0, 2], ["interfaceVolume", 0, 2], ["minimapZoom", -1, 3], ["padGlyphs", 0, 1], ["finishGloss", 0.5, 2], ["roadFinish", 0, 2], ["resolution", 0, RESOLUTIONS.length - 1]] as const;

export const VOLUME_MAX = 2;

export const SENSITIVITY_MIN = 0.2;
export const SENSITIVITY_MAX = 3;
export const ZOOM_SENSITIVITY_MIN = 0.5;
export const ZOOM_SENSITIVITY_MAX = 1.5;
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

type NumericSetting = "masterVolume" | "soundVolume" | "ambienceVolume" | "musicVolume" | "interfaceVolume" | "voiceVolume" | "sensitivity" | "zoomSensitivity" | "fov" | "finishGloss";
function range(label: string, key: NumericSetting, min: number, max: number, step: number): SettingRow {
  const set = (s: Settings, value: number): void => { if (Number.isFinite(value)) s[key] = Number(clamp(min+Math.round((value-min)/step)*step,min,max).toFixed(4)); };
  return { label, value: s => key === "fov" ? `${s[key]} degrees` : `${Math.round(s[key]*100)}%`, step: (s,by)=>set(s,s[key]+by*step), range: { min,max,step,get:s=>s[key],set } };
}
const volume = (label: string, key: NumericSetting): SettingRow => range(label,key,0,VOLUME_MAX,.1);

const TIER_LABEL: Readonly<Record<Tier["name"], string>> = { lowpoly: "low poly", medium: "medium", high: "high", ultra: "ultra" };

/** The row of "Download all", which the Storage tab shows as its buttons. */
export const DOWNLOAD_ROW = 10;

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
  // The Storage tab draws this one as its own buttons (ui/storage.ts): Download all, Pause, Resume.
  { label: "Download all", value: (s) => (!s.keepAll ? "off" : s.keepPaused ? "paused" : "on"), step: (s) => {
      s.keepPaused = s.keepAll && !s.keepPaused;
      s.keepAll = true;
    } },
  { label: "Graphics", value: (s) => TIER_LABEL[s.tier], step: (s, by) => {
      // A tier not offered here is above those that are.
      const [list, at] = [offeredTiers(s.touchFirst), offeredTiers(s.touchFirst).findIndex((t) => t.name === s.tier)];
      s.tier = (at < 0 ? list.at(-1)! : list[clamp(at + by, 0, list.length - 1)]!).name;
      s.chosen = true;
    } },
  { label: "Steady frame", value: (s) => (s.steady ? "automatic" : "off"), step: (s) => void (s.steady = !s.steady) },
  { label: "Connection", value: (s) => `${Math.round((s.snapshotBytes * TICK_RATE) / 1000)} KB/s`, step: (s, by) => void (s.snapshotBytes = SNAPSHOT_BYTES[clamp(SNAPSHOT_BYTES.indexOf(s.snapshotBytes) + by, 0, SNAPSHOT_BYTES.length - 1)]!) },
  { label: "Minimap", value: (s) => s.minimap ? "on" : "off", step: (s) => void (s.minimap = !s.minimap) },
  { label: "Status labels", value: (s) => s.vitalLabels ? "on" : "off", step: (s) => void (s.vitalLabels = !s.vitalLabels) },
  { label: "Diagnostics", value: (s) => (s.diagnostics ? "numbers" : "off"), step: (s) => void (s.diagnostics = !s.diagnostics) },
  { label: "Sound", value: (s) => s.muted ? "off" : "on", step: (s) => void (s.muted = !s.muted) },
  range("Finish gloss", "finishGloss", 0.5, 2, 0.05),
  { label: "Road finish", value: s => ROAD_FINISHES[s.roadFinish]!, step: (s, by) => void (s.roadFinish = clamp(s.roadFinish + by, 0, 2)) },
  { label: "Compass", value: (s) => s.compass ? "on" : "off", step: (s) => void (s.compass = !s.compass) },
  { label: "Render resolution", value: (s) => RESOLUTIONS[s.resolution]!.label + (s.resolution === 0 && s.autoShare < 1 ? `, ${Math.round(s.autoShare * 100)}%` : ""), step: (s, by) => void (s.resolution = clamp(s.resolution + by, 0, RESOLUTIONS.length - 1)) },
  // Shown in the Input group (ui/settings.ts SETTING_GROUPS) after the mouse's own.
  range("Zoom sensitivity","zoomSensitivity",ZOOM_SENSITIVITY_MIN,ZOOM_SENSITIVITY_MAX,.05),
  { label: "Debug bar", value: (s) => (s.debug ? "on" : "off"), step: (s) => void (s.debug = !s.debug) },
  // Shown in the Input group, after the zoom's.
  { label: "View kick", value: (s) => (s.viewKick ? "on" : "off"), step: (s) => void (s.viewKick = !s.viewKick) },
];

/** `/debug` in chat or the console: the debug bar on or off. Returns what the console says. */
export function toggleDebug(s: Settings): string {
  s.debug = !s.debug;
  s.changed();
  return s.debug ? "debug bar on: F3 opens its drawer" : "debug bar off";
}

