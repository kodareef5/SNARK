// Limits through a whole server and client: how many bodies each client is shown, what happens to a snapshot or a command
// that is too large, how long a chat line may be, and what a page of the wrong version is told.

import { expect, test } from "bun:test";
import { loadConfig } from "../../server/settings/config.ts";
import { App } from "../../client/core/app.ts";
import { CLOSED_BAD_VERSION, RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { SETTING_ROWS } from "../../client/core/settings.ts";
import { KEY_STATUS } from "../../client/core/ui/hud.ts";
import { chunkAt } from "../../shared/coords.ts";
import type { LoopbackEnd } from "../../shared/net/loopback.ts";
import { CMD_CHAT, CMD_SELECT, C_HELLO, MAX_CHAT_CHARS, PROTOCOL_VERSION, REJECT_VERSION, RESULT_DENIED, RESULT_OK, S_WELCOME, TEXT_GLOBAL } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

function seen(s: ClientSession): RemoteSample {
  const out = new RemoteSample();
  s.sampleRemote(out);
  return out;
}

function has(sample: RemoteSample, name: string): boolean {
  for (let i = 0; i < sample.count; i++) if (sample.name[i] === name) return true;
  return false;
}

test("a server shows no client more than its cap, and each client its own share of that: two around one place, one shown 32 bodies and one 96", () => {
  const h = new Harness({ viewCap: 96 }, 1, 30, { dev: true });
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(600);
  h.say(ada, "enablecheats");
  h.say(bob, "enablecheats");
  const g = flatGround(h, 12, 12);
  const here = chunkAt(h.world.dims, g.x + 6, g.z + 6);
  // Bob stands two metres from her on whichever side is in her chunk.
  const side = chunkAt(h.world.dims, g.x + 8, g.z + 6) === here ? 2 : -2;
  h.say(ada, `tp ${(g.x + 6).toFixed(3)} ${(g.z + 6).toFixed(3)}`);
  h.say(bob, `tp ${(g.x + 6 + side).toFixed(3)} ${(g.z + 6).toFixed(3)}`);
  const rng = new Rng(5);
  let crowd = 0;
  for (let i = 0; i < 2000 && crowd < 150; i++) {
    const [x, z] = [g.x + rng.range(0.5, 11.5), g.z + rng.range(0.5, 11.5)];
    if (chunkAt(h.world.dims, x, z) === here && h.host.spawnCreature("core:dummy", x, z, 1) >= 0) crowd++;
  }
  expect(crowd).toBe(150);
  // Bob never asks, and would be shown 512 if the server allowed that many.
  ada.view(32, 1100);
  h.run(3000);
  // Each one's own body is one of those it is allowed, and the other survivor comes before any of the crowd.
  const [hers, his] = [seen(ada), seen(bob)];
  expect([hers.count, his.count]).toEqual([31, 95]);
  expect([has(hers, "bob"), has(his, "ada")]).toEqual([true, true]);
  // One list was gathered for the place and both were sent from it.
  const c = h.client(ada)!;
  expect(c.chunk).toBe(h.client(bob)!.chunk);
  // More than the server allows is held to what it allows, of bodies and of bytes.
  ada.view(2048, 2200);
  h.run(200);
  expect([c.viewCap, c.snapshotBytes]).toEqual([96, 1100]);
  // Asked again within the second, she waits for the second to pass.
  ada.view(8, 600);
  h.run(500);
  expect([c.viewCap, c.snapshotBytes, seen(ada).count]).toEqual([96, 1100, 95]);
  h.run(2000);
  expect([c.viewCap, c.snapshotBytes, seen(ada).count, has(seen(ada), "bob")]).toEqual([8, 600, 7, true]);
  // Unconscious, she may do little else but may still ask.
  h.host.records.byPid.get(c.pid)!.out = true;
  const codes: number[] = [];
  ada.onResult = (_seq, code) => codes.push(code);
  ada.command(CMD_SELECT, (w) => w.u8(0));
  ada.view(16, 600);
  h.run(1500);
  expect(codes).toEqual([RESULT_DENIED, RESULT_OK]);
  expect([c.viewCap, seen(ada).count]).toEqual([16, 15]);
  expect(ada.stats.undecodable + bob.stats.undecodable).toBe(0);
});

test("a whole client asks for what its graphics and connection settings say, and again when they change", () => {
  const h = new Harness({ snapshotBytesMax: 2200 });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, corePack());
  const frame = (now: number): void => void app.frame(now, 1280, 720);
  h.run(600, frame);
  const c = h.client(app.session)!;
  expect([c.viewCap, c.snapshotBytes]).toEqual([512, 1100]);
  // Ultra asks for 2,048 bodies, and this server shows 1,024.
  app.ui.settings.tier = "ultra";
  const row = SETTING_ROWS.find((r) => r.label === "Connection")!;
  expect(row.value(app.ui.settings)).toBe("33 KB/s");
  row.step(app.ui.settings, 1);
  row.step(app.ui.settings, 1);
  expect(row.value(app.ui.settings)).toBe("66 KB/s");
  h.run(1500, frame);
  expect([c.viewCap, c.snapshotBytes]).toEqual([1024, 2200]);
  for (let k = 0; k < 3; k++) row.step(app.ui.settings, -1);
  expect(row.value(app.ui.settings)).toBe("18 KB/s");
  h.run(1500, frame);
  expect([c.viewCap, c.snapshotBytes]).toEqual([1024, 600]);
});

test("a chat line of 120 characters arrives whole in any script, and a command too long for a message is counted and not sent", () => {
  const h = new Harness();
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(600);
  const codes: number[] = [];
  ada.onResult = (_seq, code) => codes.push(code);
  const from = bob.log.length;
  const lines = ["ж".repeat(MAX_CHAT_CHARS), "龍".repeat(MAX_CHAT_CHARS), "🦖".repeat(MAX_CHAT_CHARS / 2), "龍".repeat(500)];
  expect(lines.map((l) => l.length)).toEqual([120, 120, 120, 500]);
  for (const line of lines) ada.chat(TEXT_GLOBAL, line);
  h.run(300);
  expect(codes).toEqual([RESULT_OK, RESULT_OK, RESULT_OK, RESULT_OK]);
  // The client cuts the fourth to 120, as the server would.
  expect(bob.log.slice(from).filter((l) => l.channel === TEXT_GLOBAL).map((l) => l.text)).toEqual([lines[0], lines[1], lines[2], lines[1]].map((l) => `ada: ${l}`));
  // Uncut it is 1,500 bytes. It uses no sequence number, so the next command is still in order.
  expect(ada.command(CMD_CHAT, (w) => (w.bits(TEXT_GLOBAL, 3), w.string(lines[3]!)))).toBe(0);
  expect(ada.stats.unsent).toBe(1);
  ada.chat(TEXT_GLOBAL, "still here");
  h.run(300);
  expect([codes.length, codes[4], bob.log[bob.log.length - 1]!.text, h.server.stats.malformed]).toEqual([5, RESULT_OK, "ada: still here", 0]);
});

test("a page of another version than the server is told to reload, whichever side notices", () => {
  const status = (tamper: (h: Harness) => void): [string, number, string] => {
    const h = new Harness();
    const session = h.join("ada", {}, { manual: true });
    tamper(h);
    const app = new App(session, h.reg, corePack());
    h.run(300, (now) => void app.frame(now, 1280, 720));
    return [session.state, session.closeReason, app.ui.frame.find(KEY_STATUS)!.text];
  };
  /** Rewrites the version, which follows the four bits of a message's type, in messages of that type to `end`. */
  const reversion = (end: LoopbackEnd, type: number, version: number): void => {
    const deliver = end.onMessage!;
    end.onMessage = (channel, data) => {
      if ((data[0]! & 15) === type) {
        data = data.slice();
        data[0] = type | ((version & 15) << 4);
      }
      deliver(channel, data);
    };
  };
  const sentence = "disconnected: this page is not the server's version; reload it";
  // Its hello says the version before, as a page loaded before the server was updated would.
  expect(status((h) => reversion(h.ends[0]!.peer, C_HELLO, PROTOCOL_VERSION - 1))).toEqual(["closed", REJECT_VERSION, sentence]);
  // A welcome of another version is not read past its version.
  expect(status((h) => reversion(h.ends[0]!, S_WELCOME, PROTOCOL_VERSION + 1))).toEqual(["closed", CLOSED_BAD_VERSION, sentence]);
});

test("a snapshot that outgrows the server's writer is counted and not sent, and the client is whole again once one fits", () => {
  const h = new Harness({}, 3, 30);
  const watcher = h.join("watcher");
  h.run(1500);
  // The writer is sized for the budgets the server was made with. This one is set behind its back.
  h.server.opts.snapshotBytes = 60000;
  const kind = h.reg.index.get("core:grazer")!;
  const ents = h.world.ents;
  for (let i = 0; i < 450; i++) {
    const e = ents.create(kind, 236 + (i % 30) * 1.3, 0, 222 + Math.floor(i / 30) * 2, 0);
    ents.setLook(e, 100 + i, [3, 5, 6, 7, 9, 12], `creature number ${String(i).padStart(3, "0")}`.padEnd(24, "x"));
  }
  const made = h.world.tick;
  h.run(500);
  expect(h.server.stats.overflows).toBeGreaterThan(10);
  // No snapshot since they were made has reached the client, whole or in part.
  expect([watcher.latestSnapshot <= made, watcher.stats.undecodable, seen(watcher).count]).toEqual([true, 0, 0]);
  h.server.opts.snapshotBytes = 1100;
  const over = h.server.stats.overflows;
  h.run(3000);
  const all = seen(watcher);
  expect([h.server.stats.overflows - over, watcher.stats.undecodable, all.count]).toEqual([0, 0, 450]);
  expect(new Set(all.name.slice(0, 450)).size).toBe(450);
});

test("an operator sets the two caps in the settings file, and a client's ask is held to them", () => {
  const made = loadConfig({ gus: "[SnarkSettings]\nViewCap=128\nSnapshotBytesMax=2200\n", game: "" });
  expect([made.report.refused, made.report.unknown]).toEqual([[], []]);
  const h = new Harness({}, 1, 30, { config: made.rules });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, corePack());
  app.ui.settings.tier = "ultra";
  const row = SETTING_ROWS.find((r) => r.label === "Connection")!;
  row.step(app.ui.settings, 1);
  row.step(app.ui.settings, 1);
  h.run(1500, (now) => void app.frame(now, 1280, 720));
  const c = h.client(app.session)!;
  expect([c.viewCap, c.snapshotBytes]).toEqual([128, 2200]);
});
