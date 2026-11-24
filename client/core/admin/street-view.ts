import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../../shared/coords.ts";
import { squareOf, type MapHead, type MapPart } from "../../../shared/world/mapfile.ts";
import type { MapWindow } from "./view.ts";

/** Order only the sectors in view, nearest the middle first when a large view cannot fetch them all. */
export function streetsInView(head: Pick<MapHead, "dims" | "parts">, view: MapWindow, limit: number): MapPart[] {
  const west = view.worldX(0), east = view.worldX(view.width);
  const north = view.worldZ(0), south = view.worldZ(view.height);
  return head.parts.flatMap((part) => {
    if (part.kind !== "streets") return [];
    const sq = squareOf(head.dims, SECTOR_CHUNKS, part.col, part.row);
    if (!sq || sq.cx0 * CHUNK_SIZE > west || sq.cx1 * CHUNK_SIZE < east || sq.cz0 * CHUNK_SIZE > north || sq.cz1 * CHUNK_SIZE < south) return [];
    const dx = (sq.cx0 + sq.cx1) * CHUNK_SIZE / 2 - view.x;
    const dz = (sq.cz0 + sq.cz1) * CHUNK_SIZE / 2 - view.z;
    return [{ part, distance: dx * dx + dz * dz }];
  }).sort((a, b) => a.distance - b.distance).slice(0, limit).map(({ part }) => part);
}
