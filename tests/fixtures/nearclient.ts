// A client's near city over a map of statics (client/core/render/nearcity.ts): the window of chunks it holds whole as it
// moves, what its card holds, and the rule of one owner a piece. The Miami slice and a small city of frames both stand on it.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { MESH_SLOT } from "../../client/core/render/nearcity.ts";
import { DRAW_CUTOUT, DRAW_RANGED, DRAW_TEXTURED, MAX_CASTERS, MAX_DRAWS, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { NODE_BUFFERS, Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { CHUNK_SIZE, chunkCx, chunkCz } from "../../shared/coords.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { mapHeightfield, type MapData, type MapStatic } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { FLOOR, building } from "./cityworld.ts";
import { farPack } from "./farworld.ts";
import { flatMap } from "./map.ts";
import { coreRegistry } from "./world.ts";

/**
 * A small city on flat ground, 9 by 9 chunks as the Miami slice is: frame buildings of two to four storeys in every
 * chunk, each under a roof plate, turned and set off their chunks' middles, some across a border. A few thousand pieces, where the slice has 28,000.
 */
export function smallCity(): MapData {
  const statics: MapStatic[] = [];
  for (let cz = 0; cz < 9; cz++) for (let cx = 0; cx < 9; cx++) {
    const k = cz * 9 + cx, [x, z, storeys, yaw] = [cx * CHUNK_SIZE + 20 + (k % 5) * 6, cz * CHUNK_SIZE + 24 + (k % 3) * 8, 2 + (k % 3), (k * 4100) % 16384];
    statics.push(...building(x, z, 0, storeys, 2, yaw));
    // A plate on its piers' tops: the chunk's tallest piece is one wide enough to be seen from over it.
    statics.push({ kind: FLOOR, x, y: storeys * 4 + 0.6, z, yaw });
    // Every other chunk has a second, on its east border.
    if (k % 2 === 0) statics.push(...building(cx * CHUNK_SIZE + 60, cz * CHUNK_SIZE + 12 + (k % 4) * 10, 0, 2, 1, 0));
  }
  return flatMap(9, { id: "test:small-city", statics });
}

/** Chunks either side of the camera's that a client holds whole (server/game.ts structRadius). */
const RADIUS = 3;

/** A map's city as a client on high holds it: the window round the camera's chunk whole, its statics put as a client puts the map's. */
export function nearClient(map: MapData) {
  const reg = coreRegistry();
  const pack = farPack();
  const dims = map.dims;
  const hf = mapHeightfield(map);
  const city = new CityStatics(dims, map.statics, reg);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const held = new Uint8Array(dims.chunksX * dims.chunksZ);
  const complete = (c: number): boolean => held[c] === 1;
  const scene = new Scene({ mapId: map.id, dims, hf, structs, far: { cells: new FarStore(), complete }, city: { statics: city, complete } }, reg, pack);
  scene.assets.tier = tierOf("high");
  scene.viewHeight = 540;
  scene.city!.makeMs = Infinity;
  const cam = new Camera();
  cam.aspect = 16 / 9;
  // What the card holds: each chunk's instances as last sent, and the levels of meshes on it.
  const slots = new Map<number, Uint16Array>();
  const onCard = new Set<number>();
  let now = 0;
  return {
    dims, hf, city, structs, scene, cam,
    /** Holds the chunks round (x, z) whole and lets go of the rest, as the server sends and drops them. */
    follow(x: number, z: number): void {
      const [cx, cz] = [Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)];
      for (const c of [...structs.held]) {
        if (Math.abs(chunkCx(dims, c) - cx) <= RADIUS && Math.abs(chunkCz(dims, c) - cz) <= RADIUS) continue;
        structs.dropChunk(c);
        held[c] = 0;
      }
      for (let j = Math.max(0, cz - RADIUS); j <= Math.min(dims.chunksZ - 1, cz + RADIUS); j++) {
        for (let i = Math.max(0, cx - RADIUS); i <= Math.min(dims.chunksX - 1, cx + RADIUS); i++) {
          const c = j * dims.chunksX + i;
          if (held[c] === 1) continue;
          held[c] = 1;
          for (let s = city.first[c]!; s < city.first[c + 1]!; s++) structs.put(c, s - city.first[c]!, city.kind[s]!, city.x[s]!, city.y[s]!, city.z[s]!, city.yaw[s]!, 0, reg.maxHp[city.kind[s]!]!, 1);
          structs.setVersion(c, 1);
        }
      }
    },
    frame(): FramePacket {
      scene.now = now += 1000 / 60;
      const p = scene.build(cam, null);
      for (const u of p.uploads) slots.set(u.buffer, u.slots);
      for (const id of p.drops) slots.delete(id);
      for (const s of p.assetDrops) onCard.delete(s);
      for (const u of p.assetUploads) onCard.add(u.slot);
      return p;
    },
    /** Where a frame breaks the rule of one owner a piece: a standing piece of a chunk it draws near that is in neither its instances nor its mesh, or in both; a mesh drawn that is not its chunk's or not on the card; a chunk drawn both near and far. */
    owners(p: FramePacket): string[] {
      const out: string[] = [];
      const drawn = new Set<number>();
      const ranged = (buffer: number, slot: number, flags: number): void => {
        if (buffer === TRANSIENT_BUFFER || buffer >= NODE_BUFFERS) return;
        drawn.add(buffer);
        if ((flags & DRAW_RANGED) === 0) return;
        if (slot !== scene.near!.chunk(buffer)?.mesh?.slot || !onCard.has(slot) || !slots.get(buffer)?.includes(MESH_SLOT)) out.push(`chunk ${buffer} draws a mesh not its own`);
      };
      for (let d = 0; d < p.drawCount; d++) ranged(p.drawBuffer[d]!, p.drawSlot[d]!, p.drawFlags[d]!);
      for (let e = 0; e < p.casterCount; e++) ranged(p.casterBuffer[e]!, p.casterSlot[e]!, p.casterFlags[e]!);
      for (const c of drawn) {
        if (scene.city!.isFar(c)) out.push(`chunk ${c} is drawn near and far`);
        const t = structs.chunks[c]!, given = slots.get(c)!, mine = scene.near!.chunk(c)?.mine;
        const meshed = given.includes(MESH_SLOT);
        const count = new Uint8Array(t.high);
        for (const s of given) if (s !== MESH_SLOT) count[s]!++;
        for (let s = 0; s < t.high; s++) {
          if (t.kind[s] === 0) continue;
          const n = count[s]! + (meshed && mine?.[s] === 1 ? 1 : 0);
          if (n !== 1) out.push(`chunk ${c} slot ${s} has ${n} owners`);
        }
      }
      return out;
    },
  };
}

/** Whether rows `a` and `b` agree in every column of the packet named for `kind` but their runs of indices, the marks, a caster's cascades, and the material a row does not read. */
export function alike(p: FramePacket, kind: "draw" | "caster", a: number, b: number): boolean {
  const flags = kind === "draw" ? p.drawFlags : p.casterFlags;
  const unread = kind === "draw" ? (flags[a]! & DRAW_TEXTURED) === 0 : (flags[a]! & DRAW_CUTOUT) === 0;
  for (const [name, column] of Object.entries(p)) {
    if (!name.startsWith(kind) || !ArrayBuffer.isView(column) || /FirstIndex|IndexCount|Joined|Cascades/.test(name) || (unread && name.endsWith("Material"))) continue;
    const values = column as unknown as ArrayLike<number>, width = values.length / (kind === "draw" ? MAX_DRAWS : MAX_CASTERS);
    for (let k = 0; k < width; k++) if (values[a * width + k] !== values[b * width + k]) return false;
  }
  return true;
}
