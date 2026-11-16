// The accepted walkable marina, with an independent identity and save for the sail controls.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { writeMap, type MapData } from "../../shared/world/mapfile.ts";
import { koruCourse } from "../koru/course.ts";

export const KORU_SAILS_MAP = "preview:koru-sails-marina";

export function koruSailsCourse(): MapData {
  const map = koruCourse();
  return { ...map, id: KORU_SAILS_MAP, spawns: map.spawns.map(spawn => ({ ...spawn, name: "Koru sail controls" })) };
}

export function writeKoruSailsCourse(path = "var/koru-sails-preview/marina.snmp"): string {
  const out = resolve(path); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, writeMap(koruSailsCourse())); return out;
}

if (import.meta.main) console.log(writeKoruSailsCourse(process.argv[2]));
