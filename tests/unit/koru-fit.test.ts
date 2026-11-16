import { expect, test } from "bun:test";
import { KORU_LAYOUT } from "../../content/landmarks/koru.ts";
import { actualKoruFit, auditKoruFit, auditKoruPoseAt, type KoruFitExtreme } from "../../tools/art/koru-fit.ts";

const sideways: KoruFitExtreme = { value: 0, mesh: "", sex: "m", speed: 4.5, direction: 11, pitch: 25, phase: 31 / 32 };
const tall = { ...sideways, direction: 5, pitch: 23, phase: .625 };

test("the actual dressed survivor witness needs the wider yacht doorway", () => {
  const fit = actualKoruFit(sideways);
  expect(fit.maximum[0]!).toBeCloseTo(.6784451, 5);
  expect(fit.maximum[0]!).toBeGreaterThan(.6); // The previous 1.2 m aperture cut through a legal glove vertex.
  expect(fit.maximum[0]!).toBeLessThan(KORU_LAYOUT.clearances.doorWidth / 2);
  expect(fit.witnesses[3]).toContain("armor/hide/hands vertex203 profile34");
});

test("limiting head-look and strafe poses enclose both sexes over the full creator interval", () => {
  const bounds = auditKoruFit({ phases: 32, continuousPhase: false, motion: [
    { speed: 0, direction: 0, pitch: 0 }, sideways, tall, { speed: 7.2, direction: 4, pitch: -31 },
  ] });
  expect(bounds.vertices).toBeGreaterThan(27000); expect(bounds.poses).toBe(256);
  expect(bounds.minimum[0]!.value).toBeGreaterThan(-KORU_LAYOUT.clearances.doorWidth / 2);
  expect(bounds.maximum[0]!.value).toBeLessThan(KORU_LAYOUT.clearances.doorWidth / 2);
  expect(bounds.maximum[1]!.value).toBeLessThan(KORU_LAYOUT.clearances.doorHeight);
  expect(Math.max(bounds.stairUp.value, bounds.stairDown.value)).toBeLessThan(2.7);
});

test("full posed vertices clear authored room jambs and stair landing guards at the limiting native poses", () => {
  const cases = [
    { pose: sideways, profile: 34 }, { pose: sideways, profile: 41 },
    { pose: { ...sideways, sex: "f" }, profile: 2 },
    { pose: { ...sideways, speed: 7.2, direction: 4, pitch: -31, phase: 13 / 32 }, profile: 31 },
    { pose: tall, profile: 41 },
  ];
  let points = 0;
  const check = (feet: readonly number[], yaw: number, label: string) => {
    for (const c of cases) {
      const fit = auditKoruPoseAt(c.pose, c.profile, feet, yaw); points += fit.points;
      if (fit.collisions.length) throw new Error(`${label}: ${JSON.stringify(fit.collisions.slice(0, 3))}`);
    }
  };
  for (const room of KORU_LAYOUT.rooms.filter(r => r.enclosed)) check(room.entry, room.entrySide[0]! % 2 ? Math.PI / 2 : 0, room.id);
  for (const door of KORU_LAYOUT.doors) {
    const closed = KORU_LAYOUT.modules.find(m => m.id === door.id)!, box = closed.boxes[0]!;
    check([closed.origin[0]! + box.at[0]!, closed.origin[1]!, closed.origin[2]! + box.at[2]!], 0, door.id);
  }
  for (const stair of KORU_LAYOUT.stairs) {
    check(stair.route[3]!, 0, `${stair.id} landing approach`);
    check(stair.route[4]!, Math.PI / 2, `${stair.id} landing turn`);
  }
  expect(points).toBeGreaterThan(1_000_000);
});
