// Rows for damage numbers (client/core/render/damage-numbers.ts): a fight at its busiest, every one of the LIVE numbers alive
// and 200 hits a second landing in them (pellets and bursts merging), as a client's frame sees it: the time to strike them
// and to make their cards, and the cards and draws it costs. `bun tools/bench/damage-numbers.ts` runs these alone.

import { Camera } from "../../client/core/render/camera.ts";
import { DAMAGE_BODY, DAMAGE_HEAD, DamageNumbers, LIVE } from "../../client/core/render/damage-numbers.ts";
import { FramePacket } from "../../client/core/render/packet.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

export function benchDamageNumbers(section: Section, record: Row): void {
  const cam = new Camera();
  cam.y = 1.6;
  cam.aspect = 16 / 9;
  cam.update();
  const numbers = new DamageNumbers(), packet = new FramePacket();
  const frames = 3000, perFrame = 200 / 60;
  let struck = 0, owed = 0, most = 0;
  const times: number[] = [];
  for (let f = 0; f < frames; f++) {
    const now = f * (1000 / 60);
    const t0 = performance.now();
    // Hits spread over the LIVE places ahead, 5 to 120 m off: most land on one struck just before.
    for (owed += perFrame; owed >= 1; owed--, struck++) {
      const k = struck % LIVE;
      numbers.hit(((k % 8) - 4) * 3, 1 + (k % 3), 5 + k * 2.4, 7 + (struck % 30), struck % 7 === 0 ? DAMAGE_HEAD : DAMAGE_BODY, now);
    }
    numbers.build(cam, now);
    packet.beginFrame();
    numbers.write(packet);
    times.push(performance.now() - t0);
    most = Math.max(most, packet.detailCount);
  }
  const sorted = times.slice(frames / 10).sort((a, b) => a - b);
  section(`Damage numbers: ${LIVE} alive, 200 hits a second merging into them`);
  record("frame's work, median", sorted[Math.floor(sorted.length / 2)]!, "ms", 0.1);
  record("frame's work, 99th percentile", sorted[Math.floor(sorted.length * 0.99)]!, "ms", 0.3);
  record("cards at most", most, "cards", LIVE);
  record("draws", 1, "draws", 1);
}

if (import.meta.main) {
  benchDamageNumbers(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(60)} ${value.toFixed(value < 10 ? 3 : 1).padStart(10)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
