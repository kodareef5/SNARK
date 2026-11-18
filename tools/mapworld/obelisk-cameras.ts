// Review cameras use metre offsets from a named site so a new cut or a different clear deck keeps the shot.
import { readHead, type MapHead } from "../../shared/world/mapfile.ts";

interface Camera {
  obelisk?: string;
  fromSpawn?: string;
  x?: number;
  z?: number;
  look?: [number, number, number?];
}

export function placeCamera<T extends Camera>(view: T, head: Pick<MapHead, "tideEyes" | "spawns">): T {
  if (!view.obelisk) return view;
  const eye = head.tideEyes?.find(e => e.name === view.obelisk);
  if (!eye) throw new Error(`Map has no authored obelisk at ${view.obelisk}`);
  const from = view.fromSpawn ? head.spawns.find(s => s.name === view.fromSpawn) : eye;
  if (!from) throw new Error(`Map has no camera spawn named ${view.fromSpawn}`);
  const look = view.look;
  return { ...view, x: from.x + (view.x ?? 0), z: from.z + (view.z ?? 0),
    ...(look ? { look: [eye.x + look[0], eye.z + look[1], look[2] ?? 0] } : {}) };
}

/** The tools opening the full server need just the head to place cameras. */
export async function placeFileCameras<T extends Camera>(views: T[], path: string): Promise<T[]> {
  if (!views.some(v => v.obelisk)) return views;
  const file = Bun.file(path);
  const prefix = new DataView(await file.slice(0, 16).arrayBuffer());
  const bytes = await file.slice(0, prefix.getUint32(12, true)).arrayBuffer();
  const head = readHead(new Uint8Array(bytes), false);
  return views.map(v => placeCamera(v, head));
}
