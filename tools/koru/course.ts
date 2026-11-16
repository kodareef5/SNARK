// A genuine marina around the authored Koru assembly: terrain, ordinary structures, palms and navigable water.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ruinKind } from "../../content/ruins.ts";
import { CHUNK_SIZE, chunkAt, chunkCount, type MapDims } from "../../shared/coords.ts";
import { defaultPalette, nearestColour } from "../../shared/pack/palette.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { writeMap, type MapData, type MapStatic, type NodeList } from "../../shared/world/mapfile.ts";

export const KORU_COURSE = {
  id: "preview:koru-marina", water: 0,
  vessel: { x: 1024, y: 0, z: 1024, yaw: 0 },
  // 128 m off the vessel: its full hull and all three masts fit an ordinary starting view.
  spawn: { x: 1152, z: 1000, yaw: 49152 },
  scenic: { x: 1158, z: 1126, yaw: 40960 },
  utility: { x: 1056, z: 1060, yaw: 0 },
} as const;

/** The assembled statics and the shore end of its gangway, both from the single authored layout. */
export interface MarinaPlacement {
  readonly statics: readonly MapStatic[];
  readonly landing: readonly [number, number, number];
}

/** Listed native nodes retain their ordinary meshes, foliage, collision and harvest semantics. */
function palms(dims: MapDims): NodeList {
  const points: { x: number; z: number; yaw: number }[] = [];
  for (let z = 916; z <= 1132; z += 18) points.push({ x: 1104, z, yaw: (z * 997) & 65535 });
  for (let z = 930; z <= 1120; z += 38) points.push({ x: 1132 + (z % 3) * 3, z, yaw: (z * 743) & 65535 });
  points.sort((a, b) => chunkAt(dims, a.x, a.z) - chunkAt(dims, b.x, b.z));
  const first = new Uint32Array(chunkCount(dims) + 1), kind = new Uint8Array(points.length);
  const x = new Uint16Array(points.length), z = new Uint16Array(points.length), yaw = new Uint16Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!, chunk = chunkAt(dims, p.x, p.z); first[chunk + 1]!++;
    x[i] = Math.round((p.x % CHUNK_SIZE) * 1024); z[i] = Math.round((p.z % CHUNK_SIZE) * 1024); yaw[i] = p.yaw;
  }
  for (let c = 0; c < chunkCount(dims); c++) first[c + 1]! += first[c]!;
  return { kinds: ["core:palm"], first, kind, x, z, yaw };
}

/** 2 km gives actual room for the native near-row/far-city handover without moving the review camera off-map. */
export function marinaCourse(placement: MarinaPlacement): MapData {
  const hf = new Heightfield({ chunksX: 32, chunksZ: 32 }, 2, -64, 1 / 256), statics: MapStatic[] = [...placement.statics];
  const [landingX, deck, landingZ] = placement.landing, palette = defaultPalette();
  const sand = nearestColour(palette, 170, 157, 127), stone = nearestColour(palette, 166, 163, 151), grass = nearestColour(palette, 112, 126, 93);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) {
    const x = i * hf.cell, z = j * hf.cell;
    // A level arrival promenade and steep quay edge; the whole yacht remains over genuine deep water.
    const edge = 1080 + (z < 880 || z > 1170 ? 38 * Math.sin(z / 145) : 0);
    let y = x >= edge ? deck : Math.max(-18, deck - (edge - x) * 1.5);
    if (x > 1148) y += 14 * (1 - Math.exp(-(x - 1148) / 120)) * (.55 + .45 * Math.sin(z / 118) ** 2);
    // Low headlands frame the harbour while leaving its western sea approach open.
    if ((z < 640 || z > 1400) && x > 760) {
      const ridge = Math.max(0, 22 - Math.abs(x - 955) * .055) * Math.min(1, Math.max(0, (Math.abs(z - 1020) - 380) / 130));
      y = Math.max(y, ridge - 3);
    }
    hf.setSample(i, j, y);
    hf.tint[j * hf.nx + i] = y < 0 ? sand : x < 1116 && z > 882 && z < 1166 ? stone : grass;
  }
  const add = (kind: string, x: number, y: number, z: number, yaw = 0) => statics.push({ kind, x, y, z, yaw });
  const floor = (x: number, y: number, z: number, wood = false) => add(wood ? "core:ceiling_wood" : "core:ceiling_stone", x, y - .125, z);
  const pile = (x: number, z: number, top: number) => {
    const low = hf.heightAt(x, z) - .5;
    for (let y = top - 3; y + 3 > low; y -= 6) add(ruinKind("pier8"), x, y - 1, z);
  };

  // An unobstructed 3 m pier meets the gangway end exactly. Its first tile begins at that authored endpoint.
  for (let x = landingX + 1.5; x < 1083; x += 3) floor(x, deck, landingZ);
  for (let x = landingX + 3; x < 1080; x += 9) for (const side of [-1, 1]) pile(x, landingZ + side * 1.12, deck - .2);
  // Quiet pale-stone waterfront, timber seating and native palms; the approach axis remains clear.
  for (let z = 918; z <= 1128; z += 4) {
    add(ruinKind("wall4", "limestone"), 1079.8, deck - 1.4, z, 16384);
    if (Math.abs(z - landingZ) > 8 && Math.abs(z - 1073) > 6) add(ruinKind("sill4", "limestone"), 1080.4, deck + .45, z, 16384);
  }
  for (let z = 934; z <= 1120; z += 30) {
    if (Math.abs(z - landingZ) < 10) continue;
    add(ruinKind("zcounter", "clay"), 1094, deck + .5, z, 16384);
    add(ruinKind("zshrub"), 1104, deck, z + 6);
  }

  // A lower floating finger pier serves the ordinary 6.8 m launch, a physical scale comparison a player may use.
  const lowDeck = deck - 3;
  for (let z = 1048; z <= 1069; z += 3) floor(1059, lowDeck, z, true);
  add("core:stairs_wood", 1059, lowDeck + 1.5, 1072);
  for (let x = 1059; x <= 1080; x += 3) floor(x, deck, 1075);
  for (const z of [1050, 1067]) pile(1060.1, z, lowDeck - .15);
  // Mooring posts stay clear of both the pier route and the tender's stern ladder.
  for (const z of [1050, 1066]) add(ruinKind("pier4"), 1060.2, lowDeck - 1.7, z);

  return { id: KORU_COURSE.id, dims: hf.dims, minY: hf.minY, stepY: hf.stepY, seaLevel: KORU_COURSE.water,
    heights: hf.heights, tint: hf.tint, statics, nodes: [palms(hf.dims)], spawns: [{ name: "Koru marina", ...KORU_COURSE.spawn }] };
}

export function writeMarinaCourse(path: string, placement: MarinaPlacement): string {
  const out = resolve(path); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, writeMap(marinaCourse(placement))); return out;
}
