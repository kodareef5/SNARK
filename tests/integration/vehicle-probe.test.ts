import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { VehicleSelfcheck } from "../../client/core/vehicle-selfcheck.ts";
import { PROBE_BODY, PROBE_CREATURE } from "../../shared/world/proving.ts";
import { prepareDriveProbe } from "../../tools/probe-drive.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

function probeScene(): Harness {
  const h = new Harness({}, 1, 60, { dev: true, startingCreatures: 0, wakeRadius: -1 });
  h.host.spawnCreature("core:grazer", PROBE_CREATURE.x, PROBE_CREATURE.z, 1);
  h.host.spawnCreature("core:survivor", PROBE_BODY.x, PROBE_BODY.z, 1);
  return h;
}

function browser(h: Harness) {
  const app = new App(h.join("probe", {}, { manual: true }), h.reg, corePack()), drive = new VehicleSelfcheck();
  const frame = (now: number) => { drive.step(app, now); app.frame(now, 800, 457); drive.observe(app); };
  return { app, drive, frame };
}

test("an early arriving survivor still blocks an NPC's pending entry at the probe's real driver door", async () => {
  const h = probeScene();
  try {
    let page: ReturnType<typeof browser> | undefined;
    // Reproduce the original race without weakening the live door/corridor policy: the survivor arrives while
    // the fixture's ordinary 600 ms entry action is still pending. Preparation now reports the cancellation.
    await expect(prepareDriveProbe(h.host, async ms => {
      page ??= browser(h);
      h.run(ms, page.frame);
    })).rejects.toThrow("seat entry was cancelled");
    const { app, drive, frame } = page!;
    h.run(600, frame);
    const driver = [...h.host.records.byPid.values()].find(r => r.kind === h.reg.index.get("core:civilian"))!;
    expect(h.host.urban.occupancy.seatOf(driver.pid)).toBeNull();
    expect(h.world.ents.seatSlot[h.host.records.entOf.get(driver.pid)!]).toBe(0);
    expect(drive.data.target).toBeGreaterThanOrEqual(0);
    expect(drive.data.focused).toBe(false);
    expect(drive.data.attempts).toBe(0);
    expect(app.session.driving).toBe(-1);
    expect([app.session.own.x, app.session.own.z]).toEqual([h.world.spawn.x, h.world.spawn.z]);
  } finally { h.host.shutdown(); }
});

for (const joinDelay of [0, 2000]) test(`the prepared drive probe carjacks and drives through native controls after a ${joinDelay} ms browser load`, async () => {
  const h = probeScene();
  try {
    const { car, driver } = await prepareDriveProbe(h.host, async ms => { h.run(ms); });
    const ents = h.world.ents, owner = h.host.records.byPid.get(ents.pid[car]!)!.team;
    expect(ents.seatSlot[driver]).toBe(1);
    expect(h.host.urban.occupancy.pending(ents.pid[driver]!)).toBeNull();
    h.run(joinDelay);
    const { app, drive, frame } = browser(h);
    for (let waited = 0; waited < 9000 && !drive.data.finished; waited += 100) h.run(100, frame);
    expect(drive.data.finished).toBe(true);
    expect(drive.data.timedOut).toBe(false);
    expect(drive.data.target).toBe(car);
    expect(drive.data.focused).toBe(true);
    expect(drive.data.attempts).toBe(1);
    expect(app.session.driving).toBe(car);
    expect(drive.data.maxDoor).toBeGreaterThan(.7);
    expect(drive.data.maxSpeed).toBeGreaterThan(10);
    expect(drive.data.maxRide).toBeGreaterThan(.01);
    expect(drive.data.maxGear).toBeGreaterThanOrEqual(2);
    expect(drive.data.hud).toBe(true);
    expect(drive.data.correctionsAtFinish).toBe(drive.data.correctionsAtTakeover);
    expect(drive.data.clockJumps).toBe(0);
    expect(h.host.urban.incidents).toHaveLength(1);
    expect(ents.seatSlot[driver]).toBe(0);
    expect(h.host.records.byPid.get(ents.pid[car]!)!.team).toBe(owner);
    expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});
