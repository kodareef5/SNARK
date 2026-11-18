import { LOOK_BYTES, validLook } from "../../shared/anim/look.ts";
export interface EntrySurvivor {
  id: number;
  name: string;
  level: number;
  xp?: number;
  lastLogin?: number | null;
  playMs?: number | null;
  dead: boolean;
  x?: number;
  z?: number;
  look: number[] | null;
}
export interface Remembered extends EntrySurvivor {
  world: string;
  server: string;
  map: string;
  played: number;
}
export interface Launch {
  intent: "create" | "resume";
  name: string;
  look?: number[];
  spawn?: number;
  password: string;
  request?: string;
}
export const launchKey = (path: string) => "snark.launch." + path.replace(/(?:index|play)\.html$/, "");
export const savedName = (s: unknown): s is string => typeof s==="string" && /^[A-Za-z0-9 _-]{1,24}$/.test(s);
export const validName = (s: string) => savedName(s) && s.trim() === s;
export function readLaunch(input: string | null): Launch | null {
  try {
    const a = JSON.parse(input ?? "null");
    if (!a || !savedName(a.name) || typeof a.password !== "string") return null;
    if (a.intent === "resume") return { intent: a.intent, name: a.name, password: a.password };
    if (
      a.intent !== "create" || !validName(a.name) ||
      !Array.isArray(a.look) ||
      a.look.length !== LOOK_BYTES || !a.look.every((b:unknown)=>typeof b==="number" && Number.isInteger(b) && b>=0 && b<=255) ||
      !validLook(Uint8Array.from(a.look)) ||
      !Number.isInteger(a.spawn) ||
      a.spawn < 0 ||
      a.spawn > 254
    )
      return null;
    return {
      intent: a.intent,
      name: a.name,
      password: a.password,
      look: a.look,
      spawn: a.spawn,
      ...(/^[a-f0-9]{32}$/.test(a.request) ? { request: a.request } : {}),
    };
  } catch {
    return null;
  }
}
