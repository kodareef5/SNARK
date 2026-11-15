// Opt-in diagnostics for a native probe or a developer inspecting prediction. No timers or browser objects.
import type { Body } from "../../shared/sim/character.ts";
import type { App } from "./app.ts";
import { DRAW_TEXTURED } from "./render/packet.ts";

export interface PredictionDifference {
  tick: number;
  simulated: number;
  margin: number;
  driving: number;
  distance: number;
  input: readonly number[];
  fields: { name: string; predicted: number | boolean; authoritative: number | boolean }[];
}

export class PredictionTrace {
  enabled = false;
  readonly differences: PredictionDifference[] = [];
  dropped = 0;
  adopted = 0;
  furthestAhead = 0;
  longestFrameMs = 0;
  framesOver100ms = 0;
  catchupBatches = 0;
  skippedTicks = 0;

  frame(elapsed: number, sampled: number, skipped: number): void {
    if (!this.enabled) return;
    this.longestFrameMs = Math.max(this.longestFrameMs, elapsed);
    if (elapsed > 100) this.framesOver100ms++;
    if (sampled > 4) this.catchupBatches++;
    this.skippedTicks += skipped;
  }

  adopt(tick: number, simulated: number): void {
    if (!this.enabled) return;
    this.adopted++;
    this.furthestAhead = Math.max(this.furthestAhead, tick - simulated);
  }

  record(tick: number, simulated: number, margin: number, driving: number, predicted: Body, authoritative: Body, input: readonly number[]): void {
    if (!this.enabled) return;
    const fields: PredictionDifference["fields"] = [];
    for (const name of Object.keys(authoritative) as (keyof Body)[]) {
      const a = predicted[name], b = authoritative[name];
      if ((typeof a === "number" || typeof a === "boolean") && (typeof b === "number" || typeof b === "boolean") && a !== b) fields.push({ name, predicted: a, authoritative: b });
    }
    if (this.differences.length === 64) { this.differences.shift(); this.dropped++; }
    this.differences.push({ tick, simulated, margin, driving, distance: Math.hypot(predicted.x - authoritative.x, predicted.y - authoritative.y, predicted.z - authoritative.z), input, fields });
  }
}

/** Called only by an explicit probe request. A timeout can still describe a running page and its residency. */
export function probeProgress(app: App) {
  const s = app.session, r = app.scene?.assets.residency;
  const packet = app.scene?.packet, materials = new Set<string>();
  if (packet) for (let i = 0; i < packet.drawCount; i++) {
    if (packet.drawFlags[i]! & DRAW_TEXTURED) materials.add(app.scene!.assets.table.materials[packet.drawMaterial[i]!]!.id);
  }
  return {
    session: s.state, tick: s.simTick, snapshot: s.latestSnapshot, driving: s.driving,
    stats: { ...s.stats }, prediction: s.prediction,
    position: [s.own.x, s.own.y, s.own.z], speed: Math.hypot(s.own.vx, s.own.vz),
    tier: app.scene?.assets.tier.name, assets: r ? { ...r.stats, flying: r.flying, waiting: r.waiting, ledger: r.ledger, textures: r.textureState() } : null,
    draw: packet ? { count: packet.drawCount, triangles: packet.triangles, lit: packet.lit, materials: [...materials] } : null,
  };
}
