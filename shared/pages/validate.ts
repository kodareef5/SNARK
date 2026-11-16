// The public snapshot is an allowlist. It is deliberately smaller than any server save or announcement.

export const PUBLIC_SETTINGS = [
  "ServerPVE", "DifficultyOffset", "OverrideOfficialDifficulty", "XPMultiplier",
  "TamingSpeedMultiplier", "HarvestAmountMultiplier", "DinoCountMultiplier",
  "DayCycleSpeedScale", "DayTimeSpeedScale", "NightTimeSpeedScale",
  "PlayerCharacterFoodDrainMultiplier", "PlayerCharacterWaterDrainMultiplier",
  "PlayerCharacterStaminaDrainMultiplier", "DinoCharacterFoodDrainMultiplier",
  "BabyMatureSpeedMultiplier", "EggHatchSpeedMultiplier", "MatingIntervalMultiplier",
  "CropGrowthSpeedMultiplier", "ResourcesRespawnPeriodMultiplier", "GlobalSpoilingTimeMultiplier",
  "HarvestXPMultiplier", "CraftXPMultiplier", "KillXPMultiplier",
] as const;
export type PublicSetting = typeof PUBLIC_SETTINGS[number];
export interface PublicServerSnapshot {
  id: string;
  label: string;
  mapId: string;
  sampledAt: string;
  players: string[];
  capacity: number;
  settings: Partial<Record<PublicSetting, number | boolean>>;
  stats: { uptimeSeconds?: number; tickMilliseconds?: number; saveMilliseconds?: number };
}
export interface PublicSnapshot { version: 1; servers: PublicServerSnapshot[] }

const settingNames = new Set<string>(PUBLIC_SETTINGS);
const own = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);
const fail = (path: string, reason: string): never => { throw new Error(`public snapshot ${path}: ${reason}`); };

function record(value: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(path, "expected an object");
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return fail(path, "expected plain data");
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, "field is not public");
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return fail(path, `expected 1 to ${max} printable characters`);
  return value;
}
function number(value: unknown, path: string, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) return fail(path, `expected a ${integer ? "whole " : ""}number from 0 to ${max}`);
  return value;
}
function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail(path, `expected at most ${max} entries`);
  return value;
}

/** Returns freshly projected public data. No unknown input field is silently retained. */
export function validatePublicSnapshot(value: unknown): PublicSnapshot {
  const root = record(value, "root", ["version", "servers"]);
  if (root.version !== 1) fail("version", "unsupported version");
  const ids = new Set<string>();
  const servers = list(root.servers, "servers", 64).map((value, i): PublicServerSnapshot => {
    const path = `servers[${i}]`;
    const s = record(value, path, ["id", "label", "mapId", "sampledAt", "players", "capacity", "settings", "stats"]);
    const id = text(s.id, `${path}.id`, 64);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id)) fail(`${path}.id`, "expected a unique public slug");
    ids.add(id);
    const label = text(s.label, `${path}.label`, 100);
    const mapId = text(s.mapId, `${path}.mapId`, 160);
    if (!/^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/.test(mapId)) fail(`${path}.mapId`, "expected a namespaced map ID");
    const sampledAt = text(s.sampledAt, `${path}.sampledAt`, 32);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(sampledAt) || !Number.isFinite(Date.parse(sampledAt))) fail(`${path}.sampledAt`, "expected a UTC capture time");
    const normalized = sampledAt.includes(".") ? sampledAt : sampledAt.replace("Z", ".000Z");
    if (new Date(sampledAt).toISOString() !== normalized) fail(`${path}.sampledAt`, "invalid calendar time");
    const players = list(s.players, `${path}.players`, 10000).map((p, n) => text(p, `${path}.players[${n}]`, 80));
    const capacity = number(s.capacity, `${path}.capacity`, 10000, true);
    if (players.length > capacity) fail(`${path}.players`, "roster exceeds capacity");
    const rawSettings = record(s.settings, `${path}.settings`, PUBLIC_SETTINGS);
    const settings: Partial<Record<PublicSetting, number | boolean>> = {};
    for (const [key, v] of Object.entries(rawSettings)) {
      if (!settingNames.has(key)) fail(`${path}.settings.${key}`, "field is not public");
      if (key === "ServerPVE") {
        if (typeof v !== "boolean") fail(`${path}.settings.${key}`, "expected a switch");
        settings.ServerPVE = v as boolean;
      } else settings[key as PublicSetting] = number(v, `${path}.settings.${key}`, 1000000);
    }
    const rawStats = record(own(s, "stats") ? s.stats : {}, `${path}.stats`, ["uptimeSeconds", "tickMilliseconds", "saveMilliseconds"]);
    const stats: PublicServerSnapshot["stats"] = {};
    if (own(rawStats, "uptimeSeconds")) stats.uptimeSeconds = number(rawStats.uptimeSeconds, `${path}.stats.uptimeSeconds`, 3155760000);
    if (own(rawStats, "tickMilliseconds")) stats.tickMilliseconds = number(rawStats.tickMilliseconds, `${path}.stats.tickMilliseconds`, 3600000);
    if (own(rawStats, "saveMilliseconds")) stats.saveMilliseconds = number(rawStats.saveMilliseconds, `${path}.stats.saveMilliseconds`, 3600000);
    return { id, label, mapId, sampledAt: normalized, players, capacity, settings, stats };
  });
  return { version: 1, servers };
}
