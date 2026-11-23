// What a frame drew: its draws, triangles and instances by the step they are drawn in and by the store that made them,
// and the twenty draws with the most triangles. A loop over the frame's draws, a few thousand at most, made a few times
// a second while the Frame tab shows and once for a save.

import type { FramePacket } from "../render/packet.ts";
import { BEND_BUFFERS, DRAW_BLEND, DRAW_NEAR, TRANSIENT_BUFFER } from "../render/packet.ts";
import { FAR_BUFFER } from "../render/far.ts";
import { FAR_NODE_BUFFERS } from "../render/farnodes.ts";
import { NODE_BUFFERS } from "../render/scene.ts";

/** The steps a draw is drawn in, by render/packet.ts STEP_. */
export const STEP_NAMES = ["near", "far", "far see-through", "near see-through", "body"] as const;

export interface Count { name: string; draws: number; triangles: number; instances: number }
export interface Census {
  shot: number;
  steps: Count[];
  stores: Count[];
  largest: { mesh: string; level: number; instances: number; triangles: number; store: string; step: string }[];
}

/** The store whose instance buffer `buffer` is (render/scene.ts and the far stores number them so). */
export function storeOf(buffer: number): string {
  if (buffer === TRANSIENT_BUFFER) return "bodies and things";
  if (buffer >= BEND_BUFFERS) return "bent pieces";
  if (buffer >= FAR_NODE_BUFFERS) return "far nodes";
  if (buffer === FAR_BUFFER) return "far blocks";
  if (buffer === FAR_BUFFER + 1) return "far city";
  if (buffer === FAR_BUFFER + 2) return "lakes";
  if (buffer === FAR_BUFFER + 3) return "landmarks";
  if (buffer >= FAR_BUFFER) return "far";
  if (buffer >= NODE_BUFFERS) return "nodes";
  return "pieces and statics";
}

/** The step draw `d` is drawn in (render/packet.ts stepOf). */
function stepOf(p: FramePacket, d: number): number {
  const flags = p.drawFlags[d]!;
  if ((flags & DRAW_NEAR) !== 0) return 4;
  return (flags & DRAW_BLEND) !== 0 ? 3 - p.drawPass[d]! : p.drawPass[d]!;
}

/** The census of the frame `p` at picture `shot`, a mesh's triangles at each level from `tris` and its id from `ids`. */
export function census(p: FramePacket, shot: number, tris: readonly (readonly number[])[], ids: (mesh: number) => string): Census {
  const steps = new Map<string, Count>(), stores = new Map<string, Count>();
  const add = (map: Map<string, Count>, name: string, triangles: number, instances: number): void => {
    const c = map.get(name) ?? map.set(name, { name, draws: 0, triangles: 0, instances: 0 }).get(name)!;
    c.draws++;
    c.triangles += triangles;
    c.instances += instances;
  };
  const each: { d: number; triangles: number }[] = [];
  for (let d = 0; d < p.drawCount; d++) {
    const instances = p.drawInstances[d]!, indices = p.drawIndexCount[d]!;
    const triangles = Math.round((indices > 0 ? indices / 3 : (tris[p.drawMesh[d]!]?.[p.drawLod[d]!] ?? 0)) * Math.max(1, instances));
    add(steps, STEP_NAMES[stepOf(p, d)] ?? "?", triangles, instances);
    add(stores, storeOf(p.drawBuffer[d]!), triangles, instances);
    each.push({ d, triangles });
  }
  // The ground's tiles are not draws, and are told as one.
  if (p.tileCount > 0) stores.set("ground tiles", { name: "ground tiles", draws: p.tileCount, triangles: 0, instances: p.tileCount });
  each.sort((a, b) => b.triangles - a.triangles);
  const largest = each.slice(0, 20).map(({ d, triangles }) => ({ mesh: ids(p.drawMesh[d]!), level: p.drawLod[d]!, instances: p.drawInstances[d]!, triangles, store: storeOf(p.drawBuffer[d]!), step: STEP_NAMES[stepOf(p, d)] ?? "?" }));
  const sorted = (m: Map<string, Count>): Count[] => [...m.values()].sort((a, b) => b.triangles - a.triangles);
  return { shot, steps: sorted(steps), stores: sorted(stores), largest };
}
