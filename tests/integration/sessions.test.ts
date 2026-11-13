import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSample } from "../../client/core/session.ts";
import { OP_ADMIN } from "../../server/console.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { handleIndex } from "../../shared/ids.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import {
  CMD_TEXT,
  C_COMMAND,
  PROTOCOL_VERSION,
  REJECT_DENIED,
  REJECT_KICKED,
  RESULT_BUSY,
  RESULT_OK,
  SESSION_ALIVE,
  SESSION_SPECTATING,
  writeCommand,
  writeHello,
} from "../../shared/net/protocol.ts";
import { CH_RELIABLE } from "../../shared/net/transport.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_SPRINT } from "../../shared/sim/character.ts";
import { hourOfDay } from "../../shared/sim/clock.ts";
import { Harness, testKey } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-sessions-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a spectator sees what a player there would see, and nobody sees it", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  const bo = h.join("bo");
  h.run(500);
  const ents = h.world.ents;
  expect(ents.count).toBe(2);

  // Without cheats, spectating is refused and nothing changes.
  expect(h.say(bo, "spectate")[0]).toContain("denied");
  expect(bo.sessionState).toBe(SESSION_ALIVE);
  expect(h.say(bo, "enablecheats")).toEqual(["cheats enabled"]);
  const eb = h.ent(bo);
  const left = { x: ents.x[eb]!, y: ents.y[eb]!, z: ents.z[eb]! };

  h.say(bo, "spectate");
  expect(bo.sessionState).toBe(SESSION_SPECTATING);
  expect(bo.ownHandle).toBe(0);
  expect(ents.count).toBe(1);
  const seen = new RemoteSample();
  ada.sampleRemote(seen);
  expect(seen.count).toBe(0);
  bo.sampleRemote(seen);
  expect(seen.count).toBe(1);
  expect(seen.id[0]).toBe(handleIndex(ada.ownHandle));

  // It flies up and away faster than anything walks, yet never faster than one step allows:
  // the camera is a body stepped by the server from inputs, not a position the client sends.
  const settled = bo.stats.corrections;
  const c = h.client(bo)!;
  const p = h.pilots[1]!;
  p.moveZ = 1;
  p.pitch = 0.6;
  p.buttons = BTN_SPRINT;
  let maxStep = 0;
  let px = c.body.x;
  let py = c.body.y;
  let pz = c.body.z;
  h.run(2000, () => {
    maxStep = Math.max(maxStep, Math.hypot(c.body.x - px, c.body.y - py, c.body.z - pz));
    px = c.body.x;
    py = c.body.y;
    pz = c.body.z;
  });
  p.moveZ = 0;
  p.buttons = 0;
  h.run(500);
  expect(maxStep).toBeGreaterThan(1.5);
  expect(maxStep).toBeLessThan(2.001); // 60 m/s at 30 steps a second
  expect(c.body.y).toBeGreaterThan(left.y + 40);
  // Predicted exactly, like any body.
  expect(bo.own.equals(c.body)).toBe(true);
  expect(bo.stats.corrections).toBe(settled);
  ada.sampleRemote(seen);
  expect(seen.count).toBe(0);
  expect(h.server.playerCount).toBe(2);

  // Returning puts the body back where it was left.
  expect(h.say(bo, "stopspectating")).toEqual(["back in your body"]);
  expect(bo.sessionState).toBe(SESSION_ALIVE);
  const back = h.ent(bo);
  expect(back).toBeGreaterThanOrEqual(0);
  expect(ents.x[back]).toBe(left.x);
  expect(ents.z[back]).toBe(left.z);
  expect(Math.abs(ents.y[back]! - left.y)).toBeLessThan(0.01);
  ada.sampleRemote(seen);
  expect(seen.count).toBe(1);
  expect(h.host.records.byPid.size).toBe(2);
});

test("joining as a spectator is refused unless the server lets anyone spectate", () => {
  const h = new Harness();
  const eve = h.join("eve", {}, { spectate: true });
  h.run(300);
  expect(eve.state).toBe("closed");
  expect(eve.closeReason).toBe(REJECT_DENIED);
  expect(h.server.playerCount).toBe(0);

  const open = new Harness({ spectators: "anyone" });
  open.join("ada");
  const cam = open.join("cam", {}, { spectate: true });
  open.run(500);
  expect(cam.state).toBe("active");
  expect(cam.sessionState).toBe(SESSION_SPECTATING);
  expect(open.world.ents.count).toBe(1);
  expect(open.host.records.byPid.size).toBe(1); // a camera has no survivor record
  const seen = new RemoteSample();
  cam.sampleRemote(seen);
  expect(seen.count).toBe(1);
  expect(open.server.playerCount).toBe(2);
});

test("the console obeys admins, refuses everyone else, and never moves the world clock", () => {
  const db = join(dir, "console.db");
  const h = new Harness({}, 1, 60, { dbPath: db, adminPassword: "hunter2" });
  const ada = h.join("ada");
  const bo = h.join("bo");
  h.run(500);

  expect(h.say(ada, "help").join(" ")).toContain("enablecheats <password>");
  expect(h.say(ada, "help").join(" ")).not.toContain("kick");
  expect(h.say(ada, "nonsense")[0]).toContain("unknown command");
  expect(h.say(ada, "settime 6")[0]).toContain("denied");
  expect(h.say(ada, "kick bo")[0]).toContain("denied");
  expect(h.world.dayOffset).toBe(0);
  expect(bo.state).toBe("active");

  expect(h.say(ada, "enablecheats wrong")).toEqual(["wrong password"]);
  expect(h.say(ada, "enablecheats hunter2")).toEqual(["cheats enabled"]);
  expect(ada.admin).toBe(true);
  expect(bo.admin).toBe(false);
  expect(h.say(ada, "help").join(" ")).toContain("kick <name>");

  const tick = h.world.tick;
  expect(h.say(ada, "settime 6:30")).toEqual(["time is 06:30"]);
  expect(h.world.tick - tick).toBeLessThan(12); // only the 300 ms that passed
  expect(Math.abs(hourOfDay(h.world.tick, h.world.dayOffset) - 6.5)).toBeLessThan(0.01);
  expect(bo.dayOffset).toBe(h.world.dayOffset);
  expect(h.say(bo, "time")).toEqual(["06:30"]);
  expect(h.say(ada, "who").sort()).toEqual(["ada  alive  admin", "bo  alive"]);
  expect(h.say(bo, "pos")[0]).toMatch(/^x 2\d\d\.\d\d  y -?\d+\.\d\d  z 2\d\d\.\d\d  alive$/);

  // Three wrong passwords end the session.
  h.say(bo, "enablecheats a");
  h.say(bo, "enablecheats b");
  expect(bo.state).toBe("active");
  h.say(bo, "enablecheats c");
  expect(bo.state).toBe("closed");
  expect(bo.closeReason).toBe(REJECT_DENIED);

  const cy = h.join("cy");
  h.run(300);
  expect(h.say(ada, "kick cy")).toEqual(["kicked cy"]);
  expect(cy.state).toBe("closed");
  expect(cy.closeReason).toBe(REJECT_KICKED);

  // The operator needs no password.
  expect(h.host.exec("settime 12")).toBe("time is 12:00");
  expect(h.say(ada, "save")[0]).toContain("saved at tick");
  const offset = h.world.dayOffset;
  h.host.shutdown();

  // Admin commands are journalled; the password never is. The time of day is saved.
  const store = new WorldStore(db, h.reg);
  const lines = store
    .journal()
    .filter((j) => j.op === OP_ADMIN)
    .map((j) => new TextDecoder().decode(j.data));
  expect(lines).toEqual(["ada\tsettime 6:30", "ada\tkick cy", "(operator)\tsettime 12", "ada\tsave"]);
  expect(Number(store.meta("day_offset"))).toBe(offset);
  store.close();
});

test("a flood of commands is answered busy, never dropped silently, and runs in order", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  const results: number[] = [];
  ada.onResult = (_seq, code) => results.push(code);
  for (let i = 0; i < 30; i++) ada.text("pos");
  h.run(1000);
  expect(results.length).toBe(30);
  expect(results.filter((c) => c === RESULT_OK).length).toBe(1);
  expect(results.every((c) => c === RESULT_OK || c === RESULT_BUSY)).toBe(true);
  expect(ada.state).toBe("active");
  expect(h.say(ada, "pos").length).toBe(1);
});

test("a hostile command stream changes nothing and cannot crash the server", () => {
  const h = new Harness({}, 1, 60, { adminPassword: "pw" });
  const honest = h.join("honest");
  h.run(300);
  const structures = h.world.structs.count;
  const rng = new Rng(99);
  const w = new BitWriter(600);
  const lines = ["settime 3", "kick honest", "save", "spectate", "stopspectating", 'help "', "who", "pos x y z", "\u0000\u0000", "".padEnd(60, "€")];
  let end = h.net.connect();
  let seq = 0;
  let reconnects = 0;
  const hello = (): void => {
    end = h.net.connect();
    seq = 0;
    w.reset();
    writeHello(w, PROTOCOL_VERSION, h.reg.hash, `mallory${reconnects++}`, 0, testKey("mallory"));
    end.send(CH_RELIABLE, w.bytes());
  };
  hello();
  for (let i = 0; i < 600; i++) {
    if (!end.open) hello();
    for (let burst = 1 + rng.int(40); burst > 0; burst--) {
      w.reset();
      const kind = rng.int(6);
      if (kind <= 1) {
        // Well-formed: the next sequence number and a console line.
        seq = (seq + 1) & 0xffff;
        writeCommand(w, seq, CMD_TEXT);
        w.string(lines[rng.int(lines.length)]!);
      } else if (kind === 2) {
        // The right sequence, any op, random arguments.
        seq = (seq + 1) & 0xffff;
        writeCommand(w, seq, rng.int(256));
        for (let n = rng.int(30); n > 0; n--) w.u8(rng.int(256));
      } else if (kind === 3) {
        // A replayed or skipped sequence number.
        writeCommand(w, rng.int(65536), CMD_TEXT);
        w.string("settime 3");
      } else if (kind === 4) {
        w.bits(C_COMMAND, 4);
        w.bits(rng.int(256), 8);
      } else {
        for (let n = rng.int(500); n > 0; n--) w.u8(rng.int(256));
      }
      end.send(CH_RELIABLE, w.bytes());
    }
    h.run(1000 / 30);
  }
  expect(reconnects).toBeGreaterThan(3);
  expect(h.server.stats.commands).toBeGreaterThan(50);
  expect(h.server.stats.malformed).toBeGreaterThan(50);
  expect(h.world.dayOffset).toBe(0);
  expect(h.world.structs.count).toBe(structures);
  expect(h.server.clients.some((c) => c?.admin)).toBe(false);
  expect(h.server.clients.every((c) => !c || c.state === SESSION_ALIVE)).toBe(true);
  expect(honest.state).toBe("active");
  expect(honest.stats.corrections).toBe(0);
  expect(h.ent(honest)).toBeGreaterThanOrEqual(0);
});

test("a body lingers after a disconnect, and only the same device can take it over", () => {
  const h = new Harness();
  const ada = h.join("ada");
  h.pilots[0]!.moveZ = 1;
  h.run(1500);
  const ents = h.world.ents;
  const e = h.ent(ada);
  const handle = ada.ownHandle;
  ada.close();
  h.run(1000);
  expect(h.server.playerCount).toBe(0);
  expect(ents.resolve(handle)).toBe(e);
  // Nobody is steering it: it stopped where its connection ended.
  const z = ents.z[e]!;
  h.run(500);
  expect(ents.z[e]).toBe(z);

  const thief = h.join("ada", {}, { key: testKey("thief") });
  h.run(300);
  expect(thief.state).toBe("closed");
  expect(thief.closeReason).toBe(REJECT_DENIED);

  const again = h.join("ada");
  h.run(500);
  expect(again.state).toBe("active");
  expect(again.ownHandle).toBe(handle);
  expect(again.own.z).toBe(z);
  expect(h.server.playerCount).toBe(1);
  expect(ents.count).toBe(1);
  expect(h.host.records.byPid.size).toBe(1);
  // And it can be walked again.
  h.pilots[2]!.moveZ = 1;
  h.run(1000);
  expect(ents.z[e]!).toBeGreaterThan(z + 2);
  h.pilots[2]!.moveZ = 0;
  h.run(500);

  // Left alone, the body goes after five seconds, and the record keeps its place.
  const rest = ents.z[e]!;
  again.close();
  h.run(4000);
  expect(ents.count).toBe(1);
  h.run(1500);
  expect(ents.count).toBe(0);
  expect([...h.host.records.byPid.values()][0]!.z).toBe(rest);
});

test("a name stays with its device key across a restart", () => {
  const db = join(dir, "keys.db");
  const h = new Harness({}, 1, 60, { dbPath: db });
  h.join("ada");
  h.run(300);
  h.host.shutdown();

  const h2 = new Harness({}, 1, 60, { dbPath: db });
  const thief = h2.join("ada", {}, { key: testKey("thief") });
  h2.run(300);
  expect(thief.state).toBe("closed");
  expect(thief.closeReason).toBe(REJECT_DENIED);
  const ada = h2.join("ada");
  h2.run(300);
  expect(ada.state).toBe("active");
  expect(h2.host.records.byPid.size).toBe(1);
  h2.host.shutdown();
});
