// A road vehicle's wear story (client/core/render/wear.ts) comes from its colour regions: every client is sent the same,
// and a world saved and started again gives each car the same.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wearOf } from "../../client/core/render/wear.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

const KINDS = ["core:compact", "core:compact", "core:compact", "core:panel_van", "core:panel_van", "core:veloce"];

/** Each road vehicle's story as each of two clients draws it, by its record. */
function stories(h: Harness): Map<number, number[]> {
  const sessions = ["one", "two"].map((name) => h.join(name));
  h.run(800);
  const out = new Map<number, number[]>();
  for (const session of sessions) {
    const remote = new RemoteSample();
    session.sampleRemote(remote);
    for (const rec of h.host.records.byPid.values()) {
      if (!KINDS.includes(h.reg.ids[rec.kind]!)) continue;
      const at = remote.id.indexOf(h.host.records.entOf.get(rec.pid)!);
      expect(at).toBeGreaterThanOrEqual(0);
      out.set(rec.pid, [...(out.get(rec.pid) ?? []), wearOf(remote.colors, at * 6)]);
    }
  }
  return out;
}

test("two clients draw each parked car with one story, the cars do not all share one, and a restart keeps every car's", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-wear-")), dbPath = join(dir, "world.db");
  const map = writeMap(flatMap(2, { vehicles: KINDS.map((kind, k) => ({ kind, id: `car-${k}`, x: 52 + (k % 3) * 8, z: 56 + Math.floor(k / 3) * 9, yaw: 0 })) }));
  let h: Harness | null = null;
  try {
    h = new Harness({}, 3, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath, map });
    const before = stories(h);
    expect(before.size).toBe(KINDS.length);
    for (const [one, two] of before.values()) expect(one).toBe(two!);
    expect(new Set([...before.values()].map(([s]) => s)).size).toBeGreaterThan(1);
    h.host.shutdown();
    h = new Harness({}, 9, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath, map });
    const after = stories(h);
    expect([...after.entries()].sort()).toEqual([...before.entries()].sort());
  } finally {
    h?.host.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
