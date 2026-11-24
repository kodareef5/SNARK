import { chunkAt, type MapDims } from "../../shared/coords.ts";

export type Actor = readonly [kind: string, x: number, z: number, yaw: number, pose?: string, altitude?: number, on?: number, saddle?: string, wear?: "hide" | "cloth" | "meridian"];
export type Prop = readonly [kind: string, x: number, z: number, yaw?: number, lift?: number];
export type View = readonly [x: number, height: number, z: number, yaw: number, pitch: number, fov: number];

export interface SceneBrief {
  route: string;
  caption: string;
  alt: string;
  hour: number;
  view: View;
  actors: readonly Actor[];
  props?: readonly Prop[];
  plants?: readonly Prop[];
  landmark?: string;
  absoluteHeight?: boolean;
  eyeSeconds?: number;
  time?: number;
  city?: boolean;
}

export type Position = readonly [x: number, z: number, yaw: number];

export function photoPoint([x, z, heading]: Position, dx: number, dz: number): [number, number] {
  const a = heading * Math.PI / 180;
  return [x + dx * Math.cos(a) + dz * Math.sin(a), z - dx * Math.sin(a) + dz * Math.cos(a)];
}

export function photoChunks(dims: MapDims, shot: SceneBrief, position: Position): number[] {
  const camera = photoPoint(position, shot.view[0], shot.view[2]);
  const chunks = new Set([chunkAt(dims, position[0], position[1]), chunkAt(dims, ...camera)]);
  for (const [, x, z] of [...shot.actors, ...(shot.props ?? []), ...(shot.plants ?? [])]) {
    chunks.add(chunkAt(dims, ...photoPoint(position, x, z)));
  }
  return [...chunks];
}

export interface PhotoStatus {
  near: boolean;
  whole: boolean;
  left: number;
  roads: number;
  frames: number;
  quiet: number;
  frozen: number;
  milliseconds: number;
  errors: number[];
  city: number;
}

export function photoReady(shot: SceneBrief, status: PhotoStatus): boolean {
  return status.near && status.whole && status.left === 0 && status.roads === 0 && status.frames >= 24
    && status.quiet >= 6 && status.milliseconds >= 3200 && (!shot.city || status.city > 0);
}
