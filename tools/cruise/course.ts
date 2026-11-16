// A separate deep-water cruise port, built around the authored ship's actual gangway landing.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CRUISE_LAYOUT, cruisePoint, cruiseStatics } from "../../content/landmarks/cruise.ts";
import { KORU_LAYOUT, koruPoint, koruStatics } from "../../content/landmarks/koru.ts";
import { ruinKind } from "../../content/ruins.ts";
import { defaultPalette, nearestColour } from "../../shared/pack/palette.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { mapHeightfield, writeMap, type MapData, type MapStatic } from "../../shared/world/mapfile.ts";
import { assertCruiseMap } from "./preflight.ts";

export const CRUISE_COURSE = {
  id: "preview:cruise-port", water: 0,
  vessel: { x: 2048, y: 0, z: 2048, yaw: 0 },
  // A genuine hill above the terminal, facing the whole ship from 400 m broadside.
  spawn: { x: 2456, z: 2024, yaw: 49152 },
  scenic: { x: 2448, z: 2200, yaw: 45056 },
  quayX: 2188,
  koru: { x: 2118, y: 0, z: 1705, yaw: 0 },
  utility: { x: 2164, z: 1740, yaw: 0 },
  terraces: [2448, 2368, 2288],
} as const;

export interface CruisePortPlacement {
  readonly statics: readonly MapStatic[];
  /** The ship-authored shore end of its gangway, in world metres; port pavement meets it exactly. */
  readonly landing: readonly [number, number, number];
}

export function cruiseKoruPoint(local: readonly number[]): readonly [number, number, number] {
  const p = CRUISE_COURSE.koru; return koruPoint(p.x, p.y, p.z, p.yaw, local);
}

/** The 4 km sea approach accommodates a real 2 km distant view without taking the spectator off-map. */
export function cruisePort(placement: CruisePortPlacement): MapData {
  const hf = new Heightfield({ chunksX: 64, chunksZ: 64 }, TERRAIN_CELL, -96, 1 / 128), c = CRUISE_COURSE;
  const [landingX, deck, landingZ] = placement.landing, k = c.koru;
  if (!(landingX > c.vessel.x && landingX < c.quayX && deck > 0 && deck < 32)) throw new Error("Cruise gangway must meet the port side quay above water and below 32 m");
  const statics: MapStatic[] = [...placement.statics, ...koruStatics(k.x, k.y, k.z, k.yaw)];
  const palette = defaultPalette(), sand = nearestColour(palette, 171, 159, 134), stone = nearestColour(palette, 170, 167, 154), grass = nearestColour(palette, 109, 128, 95);
  const quayY = (z: number) => 3.75 + (deck - 3.75) * Math.max(0, Math.min(1, (z - 1800) / 100));
  // The real arrival eye must see the waterline over the real quay, not merely fit it into the frustum.
  const nearestHullX = c.vessel.x + CRUISE_LAYOUT.dimensions.waterlineBeam / 2;
  const arrivalFloor = Math.max(deck + 16, (deck + 1.2) * (c.spawn.x - nearestHullX) / (c.quayX - nearestHullX));
  const hill = (x: number, z: number) => quayY(z) + (arrivalFloor - deck) * Math.max(0, Math.min(1, (x - c.quayX - 12) / (c.spawn.x - c.quayX - 12)));
  const terraces = c.terraces.map(x => ({ x, z: landingZ, y: Math.round(hill(x, landingZ) / hf.stepY) * hf.stepY }));
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) {
    const x = i * hf.cell, z = j * hf.cell, quay = quayY(z);
    let y = x >= c.quayX ? quay : Math.max(-24, quay - (c.quayX - x) * 1.5);
    if (x >= c.quayX) y = hill(x, z);
    if (x > 2490) y += 15 * (1 - Math.exp(-(x - 2490) / 160)) * (.6 + .4 * Math.sin(z / 185) ** 2);
    // Distant headlands stay outside the ship's arrival cone and leave the western harbour mouth open.
    if ((z < 1100 || z > 2900) && x > 1950) y = Math.max(y, 18 * Math.max(0, 1 - Math.abs(x - 2200) / 400) - 3);
    // Native flagstone terraces sit on flat ground, with a continuous terrain approach on each side.
    for (const terrace of terraces) {
      const edge = Math.max(Math.abs(x - terrace.x) - 6, Math.abs(z - terrace.z) - 6, 0);
      const blend = Math.max(0, 1 - edge / 8);
      y += (terrace.y - y) * blend;
    }
    hf.setSample(i, j, y);
    hf.tint[j * hf.nx + i] = y < 0 ? sand : x < c.quayX + 25 || Math.abs(z - landingZ) < 3 ? stone : grass;
  }
  const add = (kind: string, x: number, y: number, z: number, yaw = 0) => statics.push({ kind, x, y, z, yaw });
  const floor = (x: number, y: number, z: number, timber = false) => add(timber ? "core:ceiling_wood" : "core:ceiling_stone", x, y - .125, z);
  const pile = (x: number, z: number, top: number) => {
    for (let y = top - 3; y + 3 > hf.heightAt(x, z) - .5; y -= 6) add(ruinKind("pier8"), x, y - 1, z);
  };
  const pier = (landing: readonly [number, number, number]) => {
    const [x0, y, z] = landing;
    for (let x = x0 + 1.5; x < c.quayX + 3; x += 3) floor(x, y, z);
    for (let x = x0 + 3; x < c.quayX; x += 12) for (const side of [-1, 1]) pile(x, z + side * 1.12, y - .2);
  };
  for (const terrace of terraces) {
    for (let dx = -4.5; dx <= 4.5; dx += 3) for (let dz = -4.5; dz <= 4.5; dz += 3) floor(terrace.x + dx, terrace.y + .03125, terrace.z + dz);
    // Paving has a three-centimetre curb above terrain to avoid coincident ground faces.
    // The arrival terrace stays open to the full ship silhouette; lower terraces have side rails.
    // Their twelve-metre walking axis stays open.
    for (const side of [-1, 1]) {
      if (terrace.x !== c.terraces[0]) add("core:koru_rail_sun_fore", terrace.x, terrace.y + .55, terrace.z + side * 6.08);
      const z = terrace.z + side * 9;
      add(ruinKind("zcounter", "limestone"), terrace.x + 3, hf.heightAt(terrace.x + 3, z) + .35, z);
      add(ruinKind("zshrub"), terrace.x + 3, hf.heightAt(terrace.x + 3, z) + .85, z);
    }
  }
  // The shared source supplies the boards and their fronts; this separate port owns their placements.
  // The first board is outside the arrival silhouette cone, with the boarding axis kept open.
  const portSigns = new Map(CRUISE_LAYOUT.portSigns.map(sign => [sign.id, sign]));
  for (const [id, x, z, yaw] of [
    ["core:cruise_port_arrival", c.terraces[0], landingZ - 10, 49152],
    ["core:cruise_port_boarding", c.quayX + 14, landingZ - 4.3, 49152],
    ["core:cruise_port_lower_berths", c.quayX + 8, landingZ - 26, 32768],
  ] as const) {
    const sign = portSigns.get(id);
    if (!sign?.groundOrigin || sign.front.join(",") !== "0,0,-1") throw new Error(`Cruise port sign contract changed: ${id}`);
    add(id, x, hf.heightAt(x, z), z, yaw);
  }
  pier(placement.landing);
  const koruLanding = cruiseKoruPoint(KORU_LAYOUT.docking.shoreLanding); pier(koruLanding);
  // Restrained terminal waterfront. Its two boarding axes remain clear of railings and furniture.
  for (let z = 1610; z <= 2290; z += 4) {
    const y = quayY(z);
    add(ruinKind("wall4", "limestone"), c.quayX - .2, y - 1.4, z, 16384);
    if (Math.abs(z - landingZ) > 5 && Math.abs(z - koruLanding[2]) > 5 && Math.abs(z - 1755) > 5) add(ruinKind("sill4", "limestone"), c.quayX + .4, y + .45, z, 16384);
  }
  for (let z = 1640; z <= 2260; z += 40) {
    if (Math.abs(z - landingZ) < 10) continue;
    add(ruinKind("zcounter", "clay"), c.quayX + 14, hf.heightAt(c.quayX + 14, z) + .5, z, 16384);
  }
  // The ordinary utility motorboat has a dry lower pier and a native stair back to the quay.
  for (let z = 1728; z <= 1749; z += 3) floor(2167, .75, z, true);
  add("core:stairs_wood", 2167, 2.25, 1752);
  for (let x = 2167; x < c.quayX + 3; x += 3) floor(x, 3.75, 1755);
  for (const z of [1731, 1746]) pile(2168.1, z, .6);
  const map: MapData = { id: c.id, dims: hf.dims, minY: hf.minY, stepY: hf.stepY, seaLevel: c.water, heights: hf.heights, tint: hf.tint, statics, nodes: [],
    spawns: [{ name: "Cruise terminal", ...c.spawn }] };
  assertCruiseMap(map); return map;
}

/** World-space feet from the authentic shore spawn, over native terrain, to the authored gangway. */
export function cruisePortApproach(map: MapData, landing: readonly [number, number, number]): readonly (readonly [number, number, number])[] {
  const c = CRUISE_COURSE, hf = mapHeightfield(map);
  return [[c.spawn.x, hf.heightAt(c.spawn.x, c.spawn.z), c.spawn.z], [c.quayX + 12, landing[1], landing[2]], [c.quayX + 1, landing[1], landing[2]], landing];
}

export function writeCruisePort(path: string, placement: CruisePortPlacement): string {
  const out = resolve(path); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, writeMap(cruisePort(placement))); return out;
}


export function cruiseWorldPoint(local: readonly number[]): readonly [number, number, number] {
  const p = CRUISE_COURSE.vessel; return cruisePoint(p.x, p.y, p.z, p.yaw, local);
}

export function cruiseCourse(): MapData {
  const p = CRUISE_COURSE.vessel;
  return cruisePort({ statics: cruiseStatics(p.x, p.y, p.z, p.yaw), landing: cruiseWorldPoint(CRUISE_LAYOUT.docking.shoreLanding) });
}

export function cruiseApproach(map = cruiseCourse()): readonly (readonly [number, number, number])[] {
  const route = cruisePortApproach(map, cruiseWorldPoint(CRUISE_LAYOUT.docking.shoreLanding)), hf = mapHeightfield(map), z = CRUISE_COURSE.spawn.z;
  return [route[0]!, ...CRUISE_COURSE.terraces.map(x => [x, hf.heightAt(x, z), z] as const), ...route.slice(1), cruiseWorldPoint(CRUISE_LAYOUT.docking.shipLanding), cruiseWorldPoint(CRUISE_LAYOUT.docking.arrival)];
}

export function writeCruiseCourse(path = "var/cruise-preview/port.snmp"): string {
  const out = resolve(path); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, writeMap(cruiseCourse())); return out;
}

if (import.meta.main) console.log(writeCruiseCourse(process.argv[2]));
