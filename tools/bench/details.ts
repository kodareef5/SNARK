// Rows for small details (client/core/details/): forty dodos landing at once 5 to 25 m off, and a hundred going down at
// once within 40 m, as a client sees them: its own work a frame (reading what they did, making the bursts, moving the
// particles and writing them into the packet), the particles alive and drawn, the draws, triangles and bytes sent, and
// the share of the screen the see-through dust covers. `bun tools/bench/details.ts` runs these alone.

import { CORE_CONTENT } from "../../content/core.ts";
import { Assets } from "../../client/core/assets/assets.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Details } from "../../client/core/details/details.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Characters } from "../../client/core/render/characters.ts";
import { DETAIL_FLOATS, FramePacket } from "../../client/core/render/packet.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { AnimState, CUE_LAND, CUE_TORPOR } from "../../shared/anim/pose.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { GEAR_COUNT } from "../../shared/sim/entities.ts";
import { buildProvingHeightfield } from "../../shared/world/proving.ts";
import { buildCorePack } from "../pack/build.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const at = (times: number[], q: number): number => {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
};

export function benchDetails(section: Section, record: Row): void {
  const reg = compileContent(CORE_CONTENT).registry!;
  const pack = parsePack(buildCorePack());
  const characters = new Characters(reg, pack, new Assets(reg, pack));
  const hf = buildProvingHeightfield();
  const dodo = reg.index.get("core:dodo")!;
  const [X, Z] = [256, 362];

  const run = (title: string, tier: string, birds: number, place: (k: number) => [number, number], set: (s: AnimState, t: number) => void, out: { section: Section; record: Row } = { section, record }): void => {
    out.section(title);
    const details = new Details(reg, pack.header.details, pack.palette, (k) => characters.creature(k));
    const p = new FramePacket();
    p.tier = tierOf(tier);
    const cam = new Camera();
    [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [X, hf.heightAt(X, Z) + 1.7, Z, 0, -0.1];
    cam.aspect = 19.5 / 9;
    cam.update();
    const r = new RemoteSample();
    const st = new AnimState();
    const spots = Array.from({ length: birds }, (_, k) => place(k));
    const times: number[] = [];
    let [alive, drawn, fill, bytes] = [0, 0, 0, 0];
    // Ten seconds at sixty frames a second, the occasion a second in.
    for (let f = 0; f < 600; f++) {
      const tick = 1000 + f * 0.5;
      const t = (tick - 1030) / TICK_RATE;
      r.count = 0;
      r.tick = tick;
      for (let k = 0; k < birds; k++) {
        st.unpack(0, 0);
        set(st, t);
        const n = r.count++;
        const [x, z] = spots[k]!;
        [r.id[n], r.kind[n], r.x[n], r.y[n], r.z[n], r.yaw[n], r.flags[n]] = [100 + k, dodo, x, hf.heightAt(x, z), z, k, st.grounded ? 1 : 0];
        r.colors.fill(0, n * 6, n * 6 + 6);
        r.gear.fill(0, n * GEAR_COUNT, (n + 1) * GEAR_COUNT);
        [r.span[n], r.grown[n], r.seat[n], r.hasLook[n]] = [0, 0, 0, 0];
        r.anim[n] = st.pack();
        r.cue[n] = st.packCue();
      }
      p.beginFrame();
      const t0 = performance.now();
      details.frame(p, cam, r, [], [], null, hf, p.tier, tick * (1000 / TICK_RATE));
      times.push(performance.now() - t0);
      alive = Math.max(alive, details.pool.count);
      drawn = Math.max(drawn, p.detailCount);
      fill = Math.max(fill, p.detailFill);
      bytes = Math.max(bytes, p.detailCount * DETAIL_FLOATS * 4);
    }
    const pool = p.tier.details.pool;
    out.record("details' own work a frame, median", at(times, 0.5), "ms", 0.25);
    out.record("details' own work a frame, worst of 600", at(times, 1), "ms", 2);
    out.record(`particles alive at most (the tier's pool ${pool})`, alive, "", pool);
    out.record("particles drawn at most: two triangles each, in two draws", drawn, "", pool);
    out.record("bytes of particles sent in a frame, at most", bytes / 1024, "KB", 160);
    out.record(`see-through dust's share of the screen at most (the tier's ${p.tier.details.fill})`, fill, "screens", p.tier.details.fill * 1.25);
    out.record("bursts thinned for the screen's fill", details.thinned, "particles");
  };

  // Forty in a ring 5 to 25 m ahead, all landing from a throw's height at once.
  const ahead = (k: number, near: number, far: number, n: number): [number, number] => {
    const a = (k / n) * 2.4 - 1.2;
    const d = near + ((k * 7) % n) * ((far - near) / n);
    return [X + Math.sin(a) * d, Z + Math.cos(a) * d];
  };
  const landing = (s: AnimState, t: number): void => {
    if (t < 0) s.grounded = false;
    else [s.cue, s.cueStart] = [CUE_LAND, 1030 & 255];
  };
  const down = (s: AnimState, t: number): void => {
    if (t >= 0) [s.out, s.cue, s.cueStart] = [true, CUE_TORPOR, 1030 & 255];
  };
  // Once unrecorded, so the rows are of code already compiled, as a client's is after its first minute.
  const quiet = { section: (_: string): void => {}, record: (): void => {} };
  run("", "medium", 40, (k) => ahead(k, 5, 25, 40), landing, quiet);
  for (const tier of ["medium", "lowpoly"]) {
    run(`Small details (${tier}): forty dodos landing at once, 5 to 25 m off`, tier, 40, (k) => ahead(k, 5, 25, 40), landing);
    run(`Small details (${tier}): a hundred dodos going down at once within 40 m`, tier, 100, (k) => ahead(k, 2, 40, 100), down);
  }
}

if (import.meta.main) {
  benchDetails(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(76)} ${value.toFixed(value < 10 ? 3 : 1).padStart(10)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
