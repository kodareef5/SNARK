// A vehicle at rest that nobody drives is stepped on its heartbeat, to find the ground gone from under it (server/urban.ts).
// Most heartbeats leave it exactly as they found it. Its step reads nothing but its own body and what it stands among: the
// ground, the structures and the resource nodes. So while the body is still the one such a heartbeat left, and none of those
// has changed shape since, the next heartbeat would leave it the same again, with the same report: it is taken from here and
// not worked out again. A heartbeat that changed anything is not kept.

import { CHUNK_SIZE } from "../shared/coords.ts";
import { Body, stepOut } from "../shared/sim/character.ts";
import { vehicleStep } from "../shared/sim/vehicle-body.ts";
import type { ChunkTable } from "../shared/world/structures.ts";
import type { ServerWorld } from "./world.ts";

const FIELDS = Object.keys(new Body()) as (keyof Body)[];

function same(a: Body, b: Body): boolean {
  for (const k of FIELDS) if (a[k] !== b[k]) return false;
  return true;
}

/** The node table of the chunk `dx`, `dz` from the one (x, z) is in, or null. A node is smaller than a chunk, so the nine round a body hold every node it can touch. */
function nodesAt(world: ServerWorld, x: number, z: number, dx: number, dz: number): ChunkTable | null {
  const nodes = world.nodes;
  if (!nodes) return null;
  const cx = Math.floor(x / CHUNK_SIZE) + dx, cz = Math.floor(z / CHUNK_SIZE) + dz;
  return cx >= 0 && cz >= 0 && cx < nodes.dims.chunksX && cz < nodes.dims.chunksZ ? (nodes.chunks[cz * nodes.dims.chunksX + cx] ?? null) : null;
}

export class RestingBeat {
  /** The body as the heartbeat being run began from it, and as the kept one began from it and left it. */
  private readonly from = new Body();
  private readonly body = new Body();
  private held = false;
  private readonly report = { ...vehicleStep };
  private landSpeed = 0;
  private shapes = 0;
  private terrain = 0;
  private readonly tables: (ChunkTable | null)[] = new Array(9).fill(null);
  private readonly tableShapes = new Float64Array(9);

  /** Whether the last heartbeat, answered or stepped, left the body as it found it. */
  get kept(): boolean {
    return this.held;
  }

  /** Whether a heartbeat from `b` would leave it as it is. If so, the step's report is set as that step sets it. */
  holds(world: ServerWorld, b: Body): boolean {
    if (!this.held || world.structs.shapes !== this.shapes || world.hf.changes.length !== this.terrain || !same(this.body, b)) return false;
    for (let k = 0; k < 9; k++) {
      const t = nodesAt(world, b.x, b.z, (k % 3) - 1, Math.floor(k / 3) - 1);
      if (t !== this.tables[k] || (t?.shape ?? 0) !== this.tableShapes[k]) return false;
    }
    Object.assign(vehicleStep, this.report);
    stepOut.landSpeed = this.landSpeed;
    return true;
  }

  /** Call with the body a heartbeat is about to step. */
  begin(b: Body): void {
    this.from.copy(b);
  }

  /** Call with the body as that heartbeat left it: kept if it changed nothing, else forgotten. */
  end(world: ServerWorld, b: Body): void {
    this.held = same(this.from, b);
    if (!this.held) return;
    this.body.copy(b);
    Object.assign(this.report, vehicleStep);
    this.landSpeed = stepOut.landSpeed;
    this.shapes = world.structs.shapes;
    this.terrain = world.hf.changes.length;
    for (let k = 0; k < 9; k++) {
      const t = nodesAt(world, b.x, b.z, (k % 3) - 1, Math.floor(k / 3) - 1);
      this.tables[k] = t;
      this.tableShapes[k] = t?.shape ?? 0;
    }
  }
}
